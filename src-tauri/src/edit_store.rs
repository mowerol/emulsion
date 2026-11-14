// SPDX-License-Identifier: GPL-3.0-or-later
//! Authoritative photo edits. Legacy envelopes are imported once per source, in a transaction,
//! with their exact bytes and the old catalog rows retained for recovery. A catalog row remains
//! even after a reset. Reading old sidecars can therefore never resurrect a discarded edit.
//! All saves, scans, history and keyword operations cross this interface.

use rusqlite::{params, Connection, OptionalExtension};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::Path};
use crate::{catalog, library, sidecar::{self, Earlier, Saved, Sidecar, Sync}, xmp};

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String { e.to_string() }
fn key(image: &Path) -> Result<&str> { image.to_str().ok_or_else(|| "The photo path is not valid text".into()) }
fn digest(text: &str) -> String { blake3::hash(text.as_bytes()).to_hex().to_string() }

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct Options {
    pub write_sidecars: bool,
    pub write_xmp: bool,
    pub notice_seen: bool,
}

pub fn options(conn: &Connection) -> Result<Options> {
    let text: Option<String> = conn.query_row("SELECT value FROM kv WHERE key = 'editStorage'", [], |r| r.get(0)).optional().map_err(err)?;
    text.map(|t| serde_json::from_str(&t).map_err(err)).unwrap_or_else(|| Ok(Options::default()))
}

pub fn set_options(conn: &Connection, opts: &Options) -> Result<()> {
    conn.execute("INSERT INTO kv (key,value) VALUES ('editStorage',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [serde_json::to_string(opts).map_err(err)?]).map_err(err)?;
    Ok(())
}

fn stored(conn: &Connection, image: &Path) -> Result<Option<Sidecar>> {
    let text: Option<String> = conn.query_row("SELECT data FROM edits WHERE path=?1", [key(image)?], |r| r.get(0)).optional().map_err(err)?;
    text.map(|t| sidecar::decode_document(&t).map_err(err)).transpose()
}

fn put(conn: &Connection, image: &Path, doc: &Sidecar) -> Result<()> {
    let updated = conn.execute("UPDATE edits SET data=?2 WHERE path=?1", params![key(image)?, serde_json::to_string(doc).map_err(err)?]).map_err(err)?;
    if updated != 1 { return Err("The photo edit record could not be updated; retry saving".into()); }
    Ok(())
}

/// An unavailable photo is not evidence that it has no sidecar. Only commit an import after
/// the original and legacy envelope can be read; corrupt/future files are left untouched.
fn ensure(conn: &mut Connection, image: &Path) -> Result<Sidecar> {
    if let Some(doc) = stored(conn, image)? { return Ok(doc); }
    let meta = fs::metadata(image).map_err(|e| format!("Reconnect or locate {} before migrating its saved edits: {e}", image.display()))?;
    if !meta.is_file() { return Err("The photo is not a file".into()); }
    let legacy = match fs::read_to_string(sidecar::path_for(image)) {
        Ok(text) => Some(text),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Could not read the saved edits for {}: {e}", image.display())),
    };
    let doc = match &legacy {
        Some(text) => sidecar::decode_document(text).map_err(|e| format!("Could not migrate {}: {e}. Its edit file has been left untouched.", image.display()))?,
        None => sidecar::next_document(&Saved::default(), None, false, 0),
    };
    let cached: Vec<(String, String)> = {
        let mut st = conn.prepare("SELECT root,data FROM photos WHERE path=?1").map_err(err)?;
        let rows = st.query_map([key(image)?], |r| Ok((r.get(0)?, r.get(1)?))).map_err(err)?.collect::<std::result::Result<_,_>>().map_err(err)?;
        rows
    };
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(err)?;
    if let Some(doc) = stored(&tx, image)? { tx.commit().map_err(err)?; return Ok(doc); }
    // Keep each distinct former cache state too: it may contain a save which never reached
    // the legacy file. It does not override that file, the previous authoritative store.
    for (root, text) in cached {
        tx.execute("INSERT OR IGNORE INTO edit_recovery (path,kind,digest,data) VALUES (?1,?2,?3,?4)", params![key(image)?, format!("catalog:{root}"), digest(&text), text]).map_err(err)?;
    }
    tx.execute("INSERT INTO edits (path,data,legacy,legacy_digest,imported) VALUES (?1,?2,?3,?4,?5)",
        params![key(image)?, serde_json::to_string(&doc).map_err(err)?, legacy, legacy.as_ref().map(|s| digest(s)), sidecar::now_ms() as i64]).map_err(err)?;
    let check = stored(&tx, image)?.ok_or("The imported edit could not be verified")?;
    if check != doc { return Err("The imported edit did not match its source".into()); }
    tx.commit().map_err(err)?;
    Ok(doc)
}

/// Read authoritative edits, incorporating newer shared metadata without changing the recipe.
pub fn read(conn: &mut Connection, image: &Path, xmp_owner: bool) -> Result<Saved> {
    let mut doc = ensure(conn, image)?;
    let found = xmp::read_sidecar(image, xmp_owner);
    let seen = found.as_ref().filter(|f| f.own).map(|f| f.mtime);
    let saved = library::with_newer_xmp(Some((doc.saved(), Sync { updated: doc.updated, xmp: doc.xmp })), found);
    if saved != doc.saved() || seen.is_some() && seen != doc.xmp {
        doc = sidecar::next_document(&saved, Some(&doc), false, sidecar::now_ms());
        if seen.is_some() { doc.xmp = seen; }
        put(conn, image, &doc)?;
    }
    Ok(saved)
}

/// Commit the authoritative state first. Optional exports can fail independently; the error
/// explicitly says the catalog save succeeded. Repeating a save does not duplicate history.
pub fn save(conn: &mut Connection, image: &Path, saved: &Saved, checkpoint: bool) -> Result<()> {
    let old = ensure(conn, image)?;
    let mut doc = sidecar::next_document(saved, Some(&old), checkpoint, sidecar::now_ms());
    put(conn, image, &doc)?;
    let opts = options(conn)?;
    if opts.write_xmp && (saved.interchange() != old.saved().interchange() || old.xmp.is_none()) {
        match xmp::write(image, &saved.interchange()) {
            Ok(Some(t)) => { doc.xmp = Some(t); put(conn, image, &doc)?; }
            Ok(None) => {},
            Err(e) => return Err(format!("Edits are saved in the catalog, but shared metadata could not be written: {e}")),
        }
    }
    if opts.write_sidecars {
        // Preserve independently changed portable files instead of overwriting an edit made
        // in another app version/computer. The user can inspect these recovery envelopes.
        if let Ok(text) = fs::read_to_string(sidecar::path_for(image)) {
            let imported: Option<String> = conn.query_row("SELECT legacy_digest FROM edits WHERE path=?1", [key(image)?], |r| r.get(0)).map_err(err)?;
            if imported.as_deref() != Some(digest(&text).as_str()) {
                conn.execute("INSERT OR IGNORE INTO edit_recovery (path,kind,digest,data) VALUES (?1,'sidecar',?2,?3)", params![key(image)?, digest(&text), text]).map_err(err)?;
                if sidecar::decode_document(&text).map(|d| d.saved()).ok().as_ref() != Some(saved) {
                    return Err("Edits are saved in the catalog. This portable sidecar changed elsewhere and was left untouched. Recover its edits through Earlier edits, or turn off portable sidecar writing in Settings and retry saving.".into());
                }
            }
        }
        sidecar::export_document(image, &doc).map_err(|e| format!("Edits are saved in the catalog, but their portable sidecar could not be written: {e}"))?;
        let text = fs::read_to_string(sidecar::path_for(image)).map_err(err)?;
        conn.execute("UPDATE edits SET legacy_digest=?2 WHERE path=?1", params![key(image)?, digest(&text)]).map_err(err)?;
    }
    Ok(())
}

pub fn history(conn: &mut Connection, image: &Path) -> Result<Vec<Earlier>> {
    let doc = ensure(conn, image)?;
    let mut history = doc.history.clone();
    // Reconstruct archived cache families so marks, metadata and missing copies can also be
    // restored through Earlier edits, rather than requiring a person to inspect SQLite.
    let mut st = conn.prepare("SELECT kind,data FROM edit_recovery WHERE path=?1 ORDER BY rowid").map_err(err)?;
    let rows = st.query_map([key(image)?], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(err)?;
    let mut families: BTreeMap<String, Vec<Value>> = BTreeMap::new();
    let mut recovered = Vec::new();
    for row in rows {
        let (kind, text) = row.map_err(err)?;
        if kind == "sidecar" {
            if let Ok(d) = sidecar::decode_document(&text) { recovered.push(d.saved()); }
        } else if kind.starts_with("catalog:") {
            if let Ok(v) = serde_json::from_str(&text) { families.entry(kind).or_default().push(v); }
        }
    }
    for values in families.values() {
        let Some(original) = values.iter().find(|v| v["copyId"].is_null()) else { continue; };
        let Ok(mut saved) = serde_json::from_value::<Saved>(original.clone()) else { continue; };
        if saved.flag.is_none() && original["heart"].as_bool() == Some(true) { saved.flag = Some("pick".into()); }
        saved.copies = values.iter().filter_map(|v| {
            let id = v["copyId"].as_str()?;
            serde_json::from_value::<sidecar::VirtualCopy>(json!({
                "id": id, "name": v["copyName"].as_str().unwrap_or("Virtual copy"),
                "recipe": v["recipe"], "rating": v["rating"].as_u64().unwrap_or(0).min(5),
                "label": v["label"], "flag": v["flag"], "heart": v["heart"].as_bool().unwrap_or(false),
            })).ok().map(|mut c| { if c.flag.is_none() && c.heart { c.flag = Some("pick".into()); } c.heart = false; c })
        }).collect();
        recovered.push(saved);
    }
    for saved in recovered {
        if saved == doc.saved() || history.iter().any(|h| h.recovered.as_ref() == Some(&saved)) { continue; }
        history.push(Earlier {
            updated: doc.updated, replaced: doc.updated, recipe: saved.recipe.clone().unwrap_or(Value::Null),
            copies: saved.copies.clone(), note: Some("Recovered edits and versions".into()), recovered: Some(saved),
        });
    }
    history.reverse();
    Ok(history)
}

/// Only eligibility checks hold the database lock; decoding embedded metadata remains parallel.
pub fn embedded(db: &catalog::CatalogDb, paths: &[String]) -> Result<Vec<Option<xmp::Interchange>>> {
    paths.par_iter().map(|path| {
        let image = Path::new(path);
        let eligible = db.with(|conn| Ok(ensure(conn, image)?.saved().interchange().is_empty() && !xmp::has_sidecar(image)))?;
        Ok(if eligible { xmp::read_embedded(image).filter(|v| !v.is_empty()) } else { None })
    }).collect()
}

pub fn retag(conn: &mut Connection, image: &Path, from: &str, to: Option<&str>) -> Result<Option<xmp::Meta>> {
    let mut saved = read(conn, image, xmp::sidecar_for(image).is_some())?;
    let from = xmp::tidy_path(from);
    let to = to.map(xmp::tidy_path).filter(|v| !v.is_empty());
    let keywords: Vec<String> = saved.meta.keywords.iter().filter_map(|k| crate::keywords::moved(k, &from, to.as_deref())).collect();
    if keywords == saved.meta.keywords { return Ok(None); }
    saved.meta = xmp::Meta { keywords, ..saved.meta }.tidy();
    save(conn, image, &saved, false)?;
    Ok(Some(saved.meta))
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Migration {
    pub migrated: usize,
    pub pending: usize,
    pub issues: Vec<String>,
    pub existing_user: bool,
    pub options: Options,
}

/// Runs before the UI restores cached photos, and again on later launches for offline folders.
/// Each source commits separately: interruption never marks the remaining sources as imported.
#[cfg(test)]
pub fn prepare(conn: &mut Connection) -> Result<Migration> {
    prepare_with_progress(conn, &mut |_, _| {})
}

pub fn prepare_with_progress(conn: &mut Connection, progress: &mut dyn FnMut(usize, usize)) -> Result<Migration> {
    let paths: Vec<String> = {
        let mut st = conn.prepare("SELECT DISTINCT p.path FROM photos p LEFT JOIN edits e ON e.path=p.path WHERE e.path IS NULL").map_err(err)?;
        let rows = st.query_map([], |r| r.get(0)).map_err(err)?.collect::<std::result::Result<_,_>>().map_err(err)?;
        rows
    };
    if !paths.is_empty() {
        conn.execute("INSERT OR IGNORE INTO kv (key,value) VALUES ('editStorageUpgrade','true')", []).map_err(err)?;
    }
    let existing_user = conn.query_row("SELECT value FROM kv WHERE key='editStorageUpgrade'", [], |r| r.get::<_,String>(0)).optional().map_err(err)?.is_some();
    let mut report = Migration { options: options(conn)?, existing_user, ..Migration::default() };
    let total = paths.len();
    progress(0, total);
    for (i, path) in paths.into_iter().enumerate() {
        if !Path::new(&path).is_file() { report.pending += 1; }
        else {
            match ensure(conn, Path::new(&path)) {
                Ok(_) => report.migrated += 1,
                Err(e) => { report.pending += 1; report.issues.push(e); },
            }
        }
        if (i + 1) % 64 == 0 || i + 1 == total { progress(i + 1, total); }
    }
    Ok(report)
}

/// Catalog photo rows are an index, never a second authority for the edits. Rebuild each
/// source family from its authoritative envelope, including copies added/removed since backup.
pub fn overlay(conn: &Connection, loaded: &mut catalog::Loaded) -> Result<()> {
    let mut states = BTreeMap::new();
    let mut st = conn.prepare("SELECT path,data FROM edits").map_err(err)?;
    for row in st.query_map([], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?))).map_err(err)? {
        let (path, data) = row.map_err(err)?;
        states.insert(path, sidecar::decode_document(&data).map_err(err)?.saved());
    }
    for rows in loaded.folders.values_mut() {
        let mut next = Vec::new();
        for raw in rows.iter() {
            let mut photo: Value = serde_json::from_str(raw.get()).map_err(err)?;
            let path = photo["path"].as_str().unwrap_or_default();
            let Some(saved) = states.get(path) else { next.push(raw.clone()); continue; };
            if !photo["copyId"].is_null() { continue; }
            photo["recipe"] = json!(saved.recipe); photo["rating"] = json!(saved.rating);
            photo["label"] = json!(saved.label); photo["flag"] = json!(saved.flag); photo["meta"] = json!(saved.meta);
            next.push(serde_json::value::RawValue::from_string(photo.to_string()).map_err(err)?);
            for copy in &saved.copies {
                let mut p = photo.clone();
                p["copyId"] = json!(copy.id); p["copyName"] = json!(copy.name); p["recipe"] = json!(copy.recipe);
                p["rating"] = json!(copy.rating); p["label"] = json!(copy.label); p["flag"] = json!(copy.flag);
                next.push(serde_json::value::RawValue::from_string(p.to_string()).map_err(err)?);
            }
        }
        *rows = next;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::{Change, Row};

    fn photo(dir: &Path, name: &str) -> std::path::PathBuf {
        let p = dir.join(name); fs::write(&p, b"original photo").unwrap(); p
    }
    fn edit(ev: f64) -> Saved { Saved { recipe: Some(json!({"exposure":ev})), ..Saved::default() } }
    fn cache(conn: &mut Connection, root: &str, path: &Path, copy: &str, value: Value) {
        catalog::write(conn, &Change { upserts: vec![Row { root: root.into(), path: key(path).unwrap().into(), copy: copy.into(), pos: if copy.is_empty() {0} else {1}, data: value.to_string() }], ..Change::default() }).unwrap();
    }

    #[test]
    fn imports_complete_legacy_state_and_keeps_original_bytes_and_conflicting_cache() {
        let dir = tempfile::tempdir().unwrap();
        let p = photo(dir.path(), "old.RAF");
        let mut conn = catalog::open(&dir.path().join("library.db")).unwrap();
        let mut a = edit(1.0); a.rating = 4; a.flag = Some("pick".into());
        a.copies.push(sidecar::VirtualCopy { id: "copy".into(), name: "Warm".into(), recipe: edit(2.0).recipe, rating: 5, label: None, flag: None, heart: false });
        sidecar::write(&p, &a, false).unwrap();
        sidecar::write(&p, &edit(3.0), true).unwrap();
        let bytes = fs::read_to_string(sidecar::path_for(&p)).unwrap();
        let before = sidecar::decode_document(&bytes).unwrap();
        cache(&mut conn, "/root", &p, "", json!({"path":p,"recipe":{"exposure":99},"rating":2}));
        let report = prepare(&mut conn).unwrap();
        assert_eq!((report.migrated, report.pending), (1,0));
        assert_eq!(stored(&conn, &p).unwrap().unwrap(), before);
        assert_eq!(fs::read_to_string(sidecar::path_for(&p)).unwrap(), bytes);
        assert_eq!(conn.query_row("SELECT legacy FROM edits", [], |r| r.get::<_,String>(0)).unwrap(), bytes);
        let h = history(&mut conn, &p).unwrap();
        assert!(h.iter().any(|h| h.recipe == json!({"exposure":1.0}) && h.copies.len()==1));
        assert!(h.iter().any(|h| h.recipe == json!({"exposure":99}) && h.note.is_some()));
        assert_eq!(prepare(&mut conn).unwrap().migrated, 0);
    }

    #[test]
    fn interruption_rolls_back_the_import_and_recovery_together_then_resumes() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(), "a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        sidecar::write(&p, &edit(1.0), false).unwrap();
        cache(&mut conn,"/root",&p,"",json!({"path":p,"recipe":{"exposure":2}}));
        conn.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON edits BEGIN SELECT RAISE(ABORT,'disk full'); END;").unwrap();
        assert!(ensure(&mut conn,&p).unwrap_err().contains("disk full"));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM edit_recovery",[],|r|r.get::<_,i64>(0)).unwrap(),0);
        assert!(stored(&conn,&p).unwrap().is_none());
        conn.execute_batch("DROP TRIGGER fail_import;").unwrap();
        assert_eq!(prepare(&mut conn).unwrap().migrated,1);
        assert_eq!(read(&mut conn,&p,true).unwrap().recipe,edit(1.0).recipe);
    }

    #[test]
    fn offline_and_corrupt_and_future_sidecars_remain_pending_until_readable() {
        let dir = tempfile::tempdir().unwrap(); let p = dir.path().join("offline.RAF");
        let bad = photo(dir.path(), "broken.RAF"); let future = photo(dir.path(), "future.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        for p in [&p,&bad,&future] { cache(&mut conn,"/root",p,"",json!({"path":p,"recipe":{"exposure":5}})); }
        fs::write(sidecar::path_for(&bad),"broken JSON").unwrap();
        fs::write(sidecar::path_for(&future),r#"{"format":"emulsion","version":100,"updated":3,"recipe":null}"#).unwrap();
        let report = prepare(&mut conn).unwrap();
        assert_eq!((report.migrated,report.pending,report.issues.len()),(0,3,2));
        assert!(save(&mut conn,&bad,&edit(9.0),false).is_err());
        assert!(save(&mut conn,&p,&edit(9.0),false).is_err());
        assert_eq!(fs::read_to_string(sidecar::path_for(&bad)).unwrap(),"broken JSON");
        fs::write(&p,b"reconnected").unwrap();
        sidecar::write(&p,&edit(2.0),false).unwrap();
        assert_eq!(prepare(&mut conn).unwrap().migrated,1);
        assert_eq!(read(&mut conn,&p,true).unwrap().recipe,edit(2.0).recipe);
    }

    #[test]
    fn catalog_is_authoritative_after_reset_and_new_saves_create_no_sidecars() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        sidecar::write(&p,&edit(1.0),false).unwrap();
        let original = fs::read(sidecar::path_for(&p)).unwrap();
        read(&mut conn,&p,true).unwrap();
        save(&mut conn,&p,&edit(2.0),true).unwrap();
        save(&mut conn,&p,&Saved::default(),false).unwrap();
        assert_eq!(read(&mut conn,&p,true).unwrap(),Saved::default());
        assert_eq!(fs::read(sidecar::path_for(&p)).unwrap(),original);
        assert!(history(&mut conn,&p).unwrap().iter().any(|h|h.recipe==json!({"exposure":2.0})));
        // A stale sidecar from an old build cannot bring the discarded recipe back.
        sidecar::write(&p,&edit(99.0),false).unwrap();
        assert!(read(&mut conn,&p,true).unwrap().recipe.is_none());
        let fresh = photo(dir.path(),"fresh.RAF");
        let marked = Saved {rating:5,..edit(1.0)};
        save(&mut conn,&fresh,&marked,false).unwrap();
        assert!(!sidecar::path_for(&fresh).exists());
        assert!(!fresh.with_extension("xmp").exists());
        assert_eq!(read(&mut conn,&fresh,true).unwrap(),marked);
        // Once migrated, edits remain saveable if the original goes offline.
        fs::remove_file(&fresh).unwrap();
        save(&mut conn,&fresh,&edit(4.0),true).unwrap();
        assert_eq!(read(&mut conn,&fresh,true).unwrap().recipe,edit(4.0).recipe);
    }

    #[test]
    fn migrated_hearts_and_history_copy_flags_survive_roundtrip() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"old.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        fs::write(sidecar::path_for(&p),r#"{"format":"emulsion","version":1,"updated":10,"recipe":null,"heart":true,"copies":[{"id":"a","name":"A","recipe":null,"rating":3,"label":null,"heart":true}],"history":[{"updated":1,"replaced":2,"recipe":null,"copies":[{"id":"a","name":"A","recipe":null,"rating":3,"label":null,"heart":true}]}]}"#).unwrap();
        let s = read(&mut conn,&p,true).unwrap();
        assert_eq!(s.flag.as_deref(),Some("pick"));
        assert_eq!(s.copies[0].flag.as_deref(),Some("pick"));
        assert_eq!(history(&mut conn,&p).unwrap()[0].copies[0].flag.as_deref(),Some("pick"));
    }

    #[test]
    fn xmp_is_read_on_first_import_and_newer_metadata_never_replaces_the_recipe() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        xmp::write(&p,&xmp::Interchange {rating:3,..Default::default()}).unwrap();
        assert_eq!(read(&mut conn,&p,true).unwrap().rating,3);
        save(&mut conn,&p,&Saved {rating:3,..edit(1.0)},false).unwrap();
        // Ensure an observable filesystem timestamp change (some filesystems have ms precision).
        std::thread::sleep(std::time::Duration::from_millis(5));
        xmp::write(&p,&xmp::Interchange {rating:5,..Default::default()}).unwrap();
        let s = read(&mut conn,&p,true).unwrap();
        assert_eq!(s.rating,5); assert_eq!(s.recipe,edit(1.0).recipe);
    }

    #[test]
    fn optional_portable_exports_preserve_history_and_can_seed_another_catalog() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        set_options(&conn,&Options {write_sidecars:true,write_xmp:true,..Default::default()}).unwrap();
        save(&mut conn,&p,&Saved {rating:4,..edit(1.0)},false).unwrap();
        save(&mut conn,&p,&edit(2.0),true).unwrap();
        let mut other = catalog::open(&dir.path().join("other-db")).unwrap();
        assert_eq!(read(&mut other,&p,true).unwrap().recipe,edit(2.0).recipe);
        assert_eq!(history(&mut other,&p).unwrap()[0].recipe,json!({"exposure":1.0}));
        assert!(p.with_extension("xmp").exists());
        // Turn exports off: neither old JSON nor metadata is touched by later edits.
        set_options(&conn,&Options::default()).unwrap();
        let portable = fs::read(sidecar::path_for(&p)).unwrap();
        let xmp = fs::read(p.with_extension("xmp")).unwrap();
        save(&mut conn,&p,&edit(3.0),true).unwrap();
        assert_eq!(fs::read(sidecar::path_for(&p)).unwrap(),portable);
        assert_eq!(fs::read(p.with_extension("xmp")).unwrap(),xmp);
    }

    #[test]
    fn changed_portable_files_are_preserved_and_available_for_recovery() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        set_options(&conn,&Options {write_sidecars:true,..Default::default()}).unwrap();
        save(&mut conn,&p,&edit(1.0),false).unwrap();
        sidecar::write(&p,&edit(5.0),false).unwrap();
        let external = fs::read(sidecar::path_for(&p)).unwrap();
        assert!(save(&mut conn,&p,&edit(2.0),true).unwrap_err().contains("changed elsewhere"));
        assert_eq!(fs::read(sidecar::path_for(&p)).unwrap(),external);
        assert_eq!(read(&mut conn,&p,true).unwrap().recipe,edit(2.0).recipe);
        let recovered = history(&mut conn,&p).unwrap().into_iter().find_map(|h|h.recovered).unwrap();
        assert_eq!(recovered.recipe,edit(5.0).recipe);
        save(&mut conn,&p,&recovered,true).unwrap();
        assert_eq!(sidecar::read(&p).unwrap().recipe,edit(5.0).recipe);
    }

    #[test]
    fn overlay_uses_one_authority_for_nested_roots_and_rebuilds_virtual_copies() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        for root in ["/root","/root/nested"] {
            cache(&mut conn,root,&p,"",json!({"path":p,"recipe":null,"rating":0}));
            cache(&mut conn,root,&p,"old",json!({"path":p,"copyId":"old","recipe":null}));
        }
        let saved = Saved {copies:vec![sidecar::VirtualCopy {id:"new".into(),name:"New".into(),recipe:edit(2.0).recipe,rating:4,label:None,flag:None,heart:false}],..edit(1.0)};
        save(&mut conn,&p,&saved,false).unwrap();
        let mut loaded = catalog::load(&conn).unwrap(); overlay(&conn,&mut loaded).unwrap();
        for rows in loaded.folders.values() {
            assert_eq!(rows.len(),2);
            let p: Value = serde_json::from_str(rows[0].get()).unwrap();
            let copy: Value = serde_json::from_str(rows[1].get()).unwrap();
            assert_eq!(p["recipe"],json!({"exposure":1.0}));
            assert_eq!(copy["copyId"],"new"); assert_eq!(copy["rating"],4);
        }
    }

    #[test]
    fn conflicting_cached_families_keep_marks_metadata_and_copy_recipes_for_recovery() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        sidecar::write(&p,&edit(1.0),false).unwrap();
        cache(&mut conn,"/root",&p,"",json!({"path":p,"recipe":{"exposure":2},"rating":4,"flag":"pick","meta":{"keywords":["Places|UK"],"title":"Harbour"}}));
        cache(&mut conn,"/root",&p,"print",json!({"path":p,"copyId":"print","copyName":"Print","recipe":{"exposure":3},"rating":5,"label":"green"}));
        prepare(&mut conn).unwrap();
        let states = history(&mut conn,&p).unwrap();
        let recovered = states.iter().find_map(|h|h.recovered.as_ref()).unwrap();
        assert_eq!(recovered.rating,4); assert_eq!(recovered.flag.as_deref(),Some("pick"));
        assert_eq!(recovered.meta.get("title"),"Harbour");
        assert_eq!(recovered.copies[0].id,"print"); assert_eq!(recovered.copies[0].rating,5);
        assert_eq!(recovered.copies[0].recipe,Some(json!({"exposure":3})));
    }

    #[test]
    fn failed_catalog_save_keeps_the_last_committed_state_and_can_retry() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        save(&mut conn,&p,&edit(1.0),false).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_save BEFORE UPDATE ON edits BEGIN SELECT RAISE(ABORT,'disk full'); END;").unwrap();
        assert!(save(&mut conn,&p,&edit(2.0),true).unwrap_err().contains("disk full"));
        assert_eq!(read(&mut conn,&p,true).unwrap().recipe,edit(1.0).recipe);
        conn.execute_batch("DROP TRIGGER fail_save;").unwrap();
        save(&mut conn,&p,&edit(2.0),true).unwrap();
        assert_eq!(history(&mut conn,&p).unwrap().len(),1);
    }

    #[test]
    fn global_keyword_edits_and_scan_use_catalog_state_without_creating_files() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let mut conn = catalog::open(&dir.path().join("db")).unwrap();
        let s = Saved { meta:xmp::Meta {keywords:vec!["Places|UK".into()],..Default::default()},..edit(1.0)};
        save(&mut conn,&p,&s,false).unwrap();
        retag(&mut conn,&p,"Places",Some("Locations")).unwrap();
        let scan = library::scan_with_reader(dir.path(),false,None,&mut |p,owner|read(&mut conn,p,owner).map_err(std::io::Error::other)).unwrap();
        assert_eq!(scan.entries[0].meta.keywords,vec!["Locations|UK"]);
        assert_eq!(scan.entries[0].recipe,edit(1.0).recipe);
        assert!(!sidecar::path_for(&p).exists()); assert!(!p.with_extension("xmp").exists());
    }

    #[test]
    #[ignore]
    fn migration_scale() {
        let count = 2000;
        let dir = tempfile::tempdir().unwrap();
        let mut conn = catalog::open(&dir.path().join("library.db")).unwrap();
        let mut rows = Vec::new();
        for i in 0..count {
            let p = photo(dir.path(),&format!("{i}.RAF"));
            if i % 2 == 0 { sidecar::write(&p,&edit(1.0),false).unwrap(); }
            for root in ["/shoot", "/shoot/nested"] {
                rows.push(Row {root:root.into(),path:key(&p).unwrap().into(),copy:String::new(),pos:i as i64,data:json!({"path":p,"recipe":{"exposure":1},"rating":0}).to_string()});
            }
        }
        catalog::write(&mut conn,&Change {upserts:rows,..Default::default()}).unwrap();
        let started = std::time::Instant::now();
        let mut progress = Vec::new();
        let report = prepare_with_progress(&mut conn,&mut |checked,total|progress.push((checked,total))).unwrap();
        println!("{} source photos, {} cached rows: migration {:?}",count,count*2,started.elapsed());
        assert_eq!(report.migrated,count); assert_eq!(report.pending,0);
        assert_eq!(progress.last(),Some(&(count,count)));
        assert_eq!(prepare(&mut conn).unwrap().migrated,0);
    }

    #[test]
    fn catalog_backup_restores_edits_history_and_reset_without_stale_sidecar_override() {
        let dir = tempfile::tempdir().unwrap(); let p = photo(dir.path(),"a.RAF");
        let db = catalog::CatalogDb::new(&dir.path().join("data"));
        sidecar::write(&p,&edit(1.0),false).unwrap();
        db.with(|c| {save(c,&p,&edit(2.0),true)?;save(c,&p,&Saved::default(),false)}).unwrap();
        let folder = dir.path().join("backups");
        let backup = db.with(|c|catalog::backup(c,&folder,"2026-11-13 2100",true,false)).unwrap();
        db.with(|c|save(c,&p,&edit(3.0),false)).unwrap();
        catalog::restore(&db,Path::new(&backup.path),&folder,"2026-11-13 2101").unwrap();
        assert!(db.with(|c|read(c,&p,true)).unwrap().recipe.is_none());
        assert_eq!(db.with(|c|history(c,&p)).unwrap().len(),2);
    }
}
