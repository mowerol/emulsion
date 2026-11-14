// SPDX-License-Identifier: GPL-3.0-or-later
//! The library catalog, `library.db` in the app's data folder: which folders are in the library,
//! which of their files were imported, every imported photo's catalogued state (edits, marks,
//! metadata, capture info) and the import sessions and collections. One SQLite database, as
//! darktable keeps `library.db` and Lightroom Classic its `.lrcat`; authoritative per-source edit envelopes and history live in the edits table. Portable sidecars
//! are optional exports; legacy files are imported once without deleting them.
//!
//! The interface keeps the whole catalog in memory and sends only what changed (`Change`), one
//! transaction per save. Photos are stored as the interface's JSON, one row per photo per folder
//! (nested folders list a photo under each), in the folder's order.
//!
//! Backups follow Lightroom Classic: on quitting, when one is due, the interface offers to back
//! the catalog up into a folder of the person's choosing, optionally testing its integrity first
//! and optimising it after. A backup is a consistent copy (`VACUUM INTO`) zipped as
//! `Emulsion Catalog <date> <time>.zip`; the newest `KEEP_BACKUPS` there are kept.

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;
use serde_json::Value;
use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const DB: &str = "library.db";
/// The schema this build writes (`PRAGMA user_version`).
const SCHEMA: i64 = 2;
/// Catalog backups kept in the backup folder (older ones of ours are deleted).
pub const KEEP_BACKUPS: usize = 10;
const BACKUP_PREFIX: &str = "Emulsion Catalog ";
const BACKUP_ENTRY: &str = "library.db";
/// A backup larger than this when unpacked is refused.
const MAX_UNPACKED: u64 = 16 * 1024 * 1024 * 1024;

/// The open catalog, shared by every command. Opened on first use.
pub struct CatalogDb {
    path: PathBuf,
    conn: Mutex<Option<Connection>>,
}

impl CatalogDb {
    pub fn new(data_dir: &Path) -> Self {
        CatalogDb { path: data_dir.join(DB), conn: Mutex::new(None) }
    }

    pub fn with<T>(&self, f: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.conn.lock().map_err(|_| "The catalog is unavailable".to_string())?;
        if guard.is_none() {
            *guard = Some(open(&self.path)?);
        }
        f(guard.as_mut().unwrap())
    }

    /// Swap in another database file (a restore): close ours, replace the file, reopen.
    fn replace_with(&self, file: &Path) -> Result<(), String> {
        let mut guard = self.conn.lock().map_err(|_| "The catalog is unavailable".to_string())?;
        if let Some(conn) = guard.take() {
            conn.close().map_err(|(_, e)| e.to_string())?;
        }
        for ext in ["-wal", "-shm"] {
            let _ = fs::remove_file(sibling(&self.path, ext));
        }
        fs::rename(file, &self.path).map_err(|e| e.to_string())?;
        *guard = Some(open(&self.path)?);
        Ok(())
    }
}

fn sibling(path: &Path, suffix: &str) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(suffix);
    PathBuf::from(s)
}

pub fn open(path: &Path) -> Result<Connection, String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "NORMAL").map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
    let v = version(&conn)?;
    if v == 1 {
        // A required snapshot before changing ownership of edits. Never overwrite an earlier
        // snapshot; interrupted VACUUM copies use a separate temporary name.
        let backup = path.parent().ok_or("The catalog has no parent folder")?.join("backups").join("before-catalog-edits").join(path.file_name().ok_or("The catalog has no file name")?);
        fs::create_dir_all(backup.parent().unwrap()).map_err(|e| e.to_string())?;
        if !backup.exists() {
            let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
            let partial = sibling(&backup, &format!(".partial-{}-{nonce}", std::process::id()));
            copy_to(&conn, &partial)?;
            // Publishing with a hard link never overwrites a snapshot another window made.
            let publish = fs::hard_link(&partial, &backup);
            let _ = fs::remove_file(&partial);
            if let Err(e) = publish { if e.kind() != io::ErrorKind::AlreadyExists { return Err(e.to_string()); } }
        }
        let snapshot = Connection::open_with_flags(&backup, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
        integrity(&snapshot)?;
        fs::File::open(&backup).and_then(|f| crate::durable::sync(&f)).map_err(|e| e.to_string())?;
    }
    migrate(&conn)?;
    conn.pragma_update(None, "synchronous", "FULL").map_err(|e| e.to_string())?;
    Ok(conn)
}

fn version(conn: &Connection) -> Result<i64, String> {
    conn.pragma_query_value(None, "user_version", |r| r.get(0)).map_err(|e| e.to_string())
}

fn migrate(conn: &Connection) -> Result<(), String> {
    // Another window may be opening the same catalog: serialize version checks and schema DDL.
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
    let v = version(&tx)?;
    if v > SCHEMA {
        return Err(format!("This catalog was made by a newer Emulsion (catalog version {v}). Update Emulsion to open it."));
    }
    if v < 1 {
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS roots (root TEXT PRIMARY KEY) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS photos (
               root TEXT NOT NULL, path TEXT NOT NULL, copy TEXT NOT NULL DEFAULT '',
               pos INTEGER NOT NULL, data TEXT NOT NULL);
             CREATE UNIQUE INDEX IF NOT EXISTS photos_key ON photos (root, path, copy);
             CREATE TABLE IF NOT EXISTS folder_imports (root TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
             CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
             PRAGMA user_version = 1;",
        )
        .map_err(|e| e.to_string())?;
    }
    if v < 2 {
        tx.execute_batch(
            "CREATE TABLE edits (path TEXT PRIMARY KEY, data TEXT NOT NULL, legacy TEXT,
                 legacy_digest TEXT, imported INTEGER NOT NULL) WITHOUT ROWID;
             CREATE TABLE edit_recovery (path TEXT NOT NULL, kind TEXT NOT NULL, digest TEXT NOT NULL,
                 data TEXT NOT NULL, UNIQUE(path,kind,digest));
             INSERT OR IGNORE INTO kv(key,value) SELECT 'editStorageUpgrade','true' WHERE EXISTS(SELECT 1 FROM photos);
             CREATE INDEX IF NOT EXISTS photos_path ON photos(path);
             PRAGMA user_version = 2;"
        ).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- load and save

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Loaded {
    /// Folder → its catalogued photos in order (each the interface's JSON, unparsed here).
    pub folders: BTreeMap<String, Vec<Box<RawValue>>>,
    pub folder_imports: BTreeMap<String, Value>,
    pub kv: BTreeMap<String, Value>,
}

pub fn load(conn: &Connection) -> Result<Loaded, String> {
    let e = |e: rusqlite::Error| e.to_string();
    let mut folders: BTreeMap<String, Vec<Box<RawValue>>> = BTreeMap::new();
    let mut roots = conn.prepare("SELECT root FROM roots").map_err(e)?;
    for root in roots.query_map([], |r| r.get::<_, String>(0)).map_err(e)? {
        folders.insert(root.map_err(e)?, Vec::new());
    }
    let mut photos = conn.prepare("SELECT root, data FROM photos ORDER BY root, pos").map_err(e)?;
    let rows = photos.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(e)?;
    for row in rows {
        let (root, data) = row.map_err(e)?;
        // A row that isn't JSON (never written by us) is skipped rather than failing the catalog.
        if let Ok(raw) = RawValue::from_string(data) {
            folders.entry(root).or_default().push(raw);
        }
    }
    let json_table = |sql: &str| -> Result<BTreeMap<String, Value>, String> {
        let mut st = conn.prepare(sql).map_err(e)?;
        let rows = st.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))).map_err(e)?;
        let mut out = BTreeMap::new();
        for row in rows {
            let (k, v) = row.map_err(e)?;
            if let Ok(v) = serde_json::from_str(&v) {
                out.insert(k, v);
            }
        }
        Ok(out)
    };
    Ok(Loaded {
        folders,
        folder_imports: json_table("SELECT root, value FROM folder_imports")?,
        kv: json_table("SELECT key, value FROM kv")?,
    })
}

#[derive(Deserialize)]
pub struct Row {
    pub root: String,
    pub path: String,
    #[serde(default)]
    pub copy: String,
    pub pos: i64,
    /// The photo as JSON text, stored as sent (checked to be JSON).
    pub data: String,
}

#[derive(Deserialize)]
pub struct Key {
    pub root: String,
    pub path: String,
    #[serde(default)]
    pub copy: String,
}

/// What changed since the last save. `None` in a map deletes that entry.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Change {
    pub roots_added: Vec<String>,
    /// Removing a folder removes its photos too.
    pub roots_removed: Vec<String>,
    pub upserts: Vec<Row>,
    pub deletes: Vec<Key>,
    pub folder_imports: BTreeMap<String, Option<Value>>,
    pub kv: BTreeMap<String, Option<Value>>,
}

pub fn write(conn: &mut Connection, change: &Change) -> Result<(), String> {
    let e = |e: rusqlite::Error| e.to_string();
    let tx = conn.transaction().map_err(e)?;
    {
        let mut del_root = tx.prepare_cached("DELETE FROM roots WHERE root = ?1").map_err(e)?;
        let mut del_root_photos = tx.prepare_cached("DELETE FROM photos WHERE root = ?1").map_err(e)?;
        for root in &change.roots_removed {
            del_root.execute([root]).map_err(e)?;
            del_root_photos.execute([root]).map_err(e)?;
        }
        let mut add_root = tx.prepare_cached("INSERT OR IGNORE INTO roots (root) VALUES (?1)").map_err(e)?;
        for root in &change.roots_added {
            add_root.execute([root]).map_err(e)?;
        }
        let mut del = tx.prepare_cached("DELETE FROM photos WHERE root = ?1 AND path = ?2 AND copy = ?3").map_err(e)?;
        for k in &change.deletes {
            del.execute(params![k.root, k.path, k.copy]).map_err(e)?;
        }
        let mut up = tx
            .prepare_cached(
                "INSERT INTO photos (root, path, copy, pos, data) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT (root, path, copy) DO UPDATE SET pos = excluded.pos, data = excluded.data",
            )
            .map_err(e)?;
        for r in &change.upserts {
            if serde_json::from_str::<serde::de::IgnoredAny>(&r.data).is_err() {
                return Err(format!("Not saved: the catalog entry for {} isn't valid", r.path));
            }
            // A photo is always listed under a folder the catalog knows.
            add_root.execute([&r.root]).map_err(e)?;
            up.execute(params![r.root, r.path, r.copy, r.pos, r.data]).map_err(e)?;
        }
        let mut set_import = tx.prepare_cached("INSERT OR REPLACE INTO folder_imports (root, value) VALUES (?1, ?2)").map_err(e)?;
        let mut del_import = tx.prepare_cached("DELETE FROM folder_imports WHERE root = ?1").map_err(e)?;
        for (root, value) in &change.folder_imports {
            match value {
                Some(v) => set_import.execute(params![root, v.to_string()]).map_err(e)?,
                None => del_import.execute([root]).map_err(e)?,
            };
        }
        let mut set_kv = tx.prepare_cached("INSERT OR REPLACE INTO kv (key, value) VALUES (?1, ?2)").map_err(e)?;
        let mut del_kv = tx.prepare_cached("DELETE FROM kv WHERE key = ?1").map_err(e)?;
        for (key, value) in &change.kv {
            match value {
                Some(v) => set_kv.execute(params![key, v.to_string()]).map_err(e)?,
                None => del_kv.execute([key]).map_err(e)?,
            };
        }
    }
    tx.commit().map_err(e)
}

// ---------------------------------------------------------------- integrity, copies, backups

/// SQLite's integrity check (Lightroom's "Test integrity"): `Ok` when it reports "ok".
pub fn integrity(conn: &Connection) -> Result<(), String> {
    let mut st = conn.prepare("PRAGMA integrity_check").map_err(|e| e.to_string())?;
    let problems: Vec<String> = st
        .query_map([], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?
        .into_iter().filter(|s| s != "ok")
        .collect();
    if problems.is_empty() { Ok(()) } else { Err(format!("The catalog failed its integrity check: {}", problems.join("; "))) }
}

/// A consistent copy of the open database at `dest` (which must not exist), safe while it is in use.
pub fn copy_to(conn: &Connection, dest: &Path) -> Result<(), String> {
    let dest = dest.to_str().ok_or("The backup folder's path isn't valid text")?;
    conn.execute("VACUUM INTO ?1", [dest]).map(|_| ()).map_err(|e| e.to_string())
}

/// Copy the catalog at `db` (if there is one) to `dest`, for the app data snapshots.
pub fn snapshot_file(db: &Path, dest: &Path) -> io::Result<()> {
    if !db.is_file() {
        return Ok(());
    }
    let conn = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(io::Error::other)?;
    copy_to(&conn, dest).map_err(io::Error::other)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Backup {
    pub path: String,
    pub bytes: u64,
}

fn is_backup(name: &str) -> bool {
    name.starts_with(BACKUP_PREFIX) && name.ends_with(".zip")
}

/// Back the catalog up into `folder` as a zip named for `stamp` (local "YYYY-MM-DD HHMM"),
/// optionally testing integrity first and optimising after, then keep the newest `KEEP_BACKUPS`.
pub fn backup(conn: &Connection, folder: &Path, stamp: &str, test_integrity: bool, optimize: bool) -> Result<Backup, String> {
    if test_integrity {
        integrity(conn)?;
    }
    fs::create_dir_all(folder).map_err(|e| format!("Could not use the backup folder: {e}"))?;
    let mut name = format!("{BACKUP_PREFIX}{stamp}.zip");
    let mut n = 2;
    while folder.join(&name).exists() {
        name = format!("{BACKUP_PREFIX}{stamp} {n}.zip");
        n += 1;
    }
    let dest = folder.join(&name);
    let work = folder.join(format!(".{name}.partial"));
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let result = (|| -> Result<u64, String> {
        let copy = work.join(BACKUP_ENTRY);
        copy_to(conn, &copy)?;
        let zip_tmp = work.join("backup.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&zip_tmp).map_err(|e| e.to_string())?);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).large_file(true);
        zip.start_file(BACKUP_ENTRY, opts).map_err(|e| e.to_string())?;
        io::copy(&mut fs::File::open(&copy).map_err(|e| e.to_string())?, &mut zip).map_err(|e| e.to_string())?;
        crate::durable::sync(&zip.finish().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        fs::rename(&zip_tmp, &dest).map_err(|e| e.to_string())?;
        Ok(fs::metadata(&dest).map(|m| m.len()).unwrap_or(0))
    })();
    let _ = fs::remove_dir_all(&work);
    let bytes = result?;
    prune_backups(folder, KEEP_BACKUPS);
    if optimize {
        // Lightroom's "Optimize catalog after backing up". A failure here leaves a good backup.
        let _ = conn.execute_batch("PRAGMA optimize; VACUUM;");
    }
    Ok(Backup { path: dest.to_string_lossy().into_owned(), bytes })
}

/// Our backups in `folder`, newest first.
pub fn backups(folder: &Path) -> Vec<PathBuf> {
    let mut names: Vec<String> = fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| is_backup(n))
        .collect();
    // The stamp sorts by time; a same-minute " 2" sorts after its first.
    names.sort_by(|a, b| natord::compare(b, a));
    names.into_iter().map(|n| folder.join(n)).collect()
}

fn prune_backups(folder: &Path, keep: usize) {
    for old in backups(folder).into_iter().skip(keep) {
        let _ = fs::remove_file(old);
    }
}

/// Unpack a catalog backup to `to`, checking it is one of ours and sound.
fn unpack_backup(archive: &Path, to: &Path) -> Result<(), String> {
    let not_ours = || "This is not an Emulsion catalog backup".to_string();
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| not_ours())?;
    let mut entry = zip.by_name(BACKUP_ENTRY).map_err(|_| not_ours())?;
    if entry.size() > MAX_UNPACKED {
        return Err("This catalog backup is too large".into());
    }
    let mut out = fs::File::create(to).map_err(|e| e.to_string())?;
    let copied = io::copy(&mut (&mut entry).take(MAX_UNPACKED + 1), &mut out).map_err(|e| e.to_string())?;
    if copied > MAX_UNPACKED {
        return Err("This catalog backup is too large".into());
    }
    out.flush().map_err(|e| e.to_string())?;
    drop(out);
    let conn = Connection::open_with_flags(to, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| not_ours())?;
    let v = version(&conn).map_err(|_| not_ours())?;
    if v > SCHEMA {
        return Err(format!("This backup was made by a newer Emulsion (catalog version {v}). Update Emulsion to restore it."));
    }
    let has_photos: Option<String> = conn
        .query_row("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'photos'", [], |r| r.get(0))
        .optional()
        .map_err(|_| not_ours())?;
    if has_photos.is_none() {
        return Err(not_ours());
    }
    integrity(&conn).map_err(|e| format!("This backup is damaged. {e}"))
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Restored {
    /// A copy of the catalog as it was before, so the restore can itself be undone.
    pub before: String,
}

/// Replace the catalog with a backup. The current one is first copied to `before` (a zip in the
/// same form, named for `stamp`) so nothing is lost.
pub fn restore(db: &CatalogDb, archive: &Path, before_folder: &Path, stamp: &str) -> Result<Restored, String> {
    let incoming = sibling(&db.path, ".restore");
    let _ = fs::remove_file(&incoming);
    if let Err(e) = unpack_backup(archive, &incoming) {
        let _ = fs::remove_file(&incoming);
        return Err(e);
    }
    let before = match db.with(|conn| backup(conn, before_folder, &format!("{stamp} before restore"), false, false)) {
        Ok(b) => b,
        Err(e) => {
            let _ = fs::remove_file(&incoming);
            return Err(format!("Could not keep a copy of the current catalog, so nothing was restored: {e}"));
        }
    };
    db.replace_with(&incoming)?;
    Ok(Restored { before: before.path })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("emulsion-catalog-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }
    fn row(root: &str, path: &str, copy: &str, pos: i64, data: &str) -> Row {
        Row { root: root.into(), path: path.into(), copy: copy.into(), pos, data: data.into() }
    }
    fn paths(l: &Loaded, root: &str) -> Vec<String> {
        l.folders[root].iter().map(|r| serde_json::from_str::<Value>(r.get()).unwrap()["path"].as_str().unwrap().to_owned()).collect()
    }

    #[test]
    fn writes_load_back_in_folder_order() {
        let dir = tmp("order");
        let mut conn = open(&dir.join(DB)).unwrap();
        let change = Change {
            roots_added: vec!["/empty".into()],
            upserts: vec![row("/a", "/a/2.raf", "", 1, r#"{"path":"/a/2.raf"}"#), row("/a", "/a/1.raf", "", 0, r#"{"path":"/a/1.raf"}"#)],
            folder_imports: [("/a".to_owned(), Some(serde_json::json!({ "mode": "selected", "paths": ["/a/1.raf"] })))].into(),
            kv: [("collections".to_owned(), Some(serde_json::json!([])))].into(),
            ..Default::default()
        };
        write(&mut conn, &change).unwrap();
        let l = load(&conn).unwrap();
        assert_eq!(paths(&l, "/a"), ["/a/1.raf", "/a/2.raf"]);
        assert!(l.folders["/empty"].is_empty());
        assert_eq!(l.folder_imports["/a"]["mode"], "selected");
        assert_eq!(l.kv["collections"], serde_json::json!([]));
    }

    #[test]
    fn upserts_replace_deletes_remove_and_copies_are_separate() {
        let dir = tmp("upsert");
        let mut conn = open(&dir.join(DB)).unwrap();
        write(&mut conn, &Change { upserts: vec![row("/a", "/a/1", "", 0, r#"{"path":"/a/1","rating":1}"#), row("/a", "/a/1", "c1", 1, r#"{"path":"/a/1","copyId":"c1"}"#)], ..Default::default() }).unwrap();
        write(&mut conn, &Change { upserts: vec![row("/a", "/a/1", "", 0, r#"{"path":"/a/1","rating":5}"#)], ..Default::default() }).unwrap();
        let l = load(&conn).unwrap();
        assert_eq!(l.folders["/a"].len(), 2);
        assert!(l.folders["/a"][0].get().contains("\"rating\":5"));
        write(&mut conn, &Change { deletes: vec![Key { root: "/a".into(), path: "/a/1".into(), copy: "c1".into() }], folder_imports: [("/a".to_owned(), None)].into(), ..Default::default() }).unwrap();
        let l = load(&conn).unwrap();
        assert_eq!(l.folders["/a"].len(), 1);
        write(&mut conn, &Change { roots_removed: vec!["/a".into()], ..Default::default() }).unwrap();
        assert!(load(&conn).unwrap().folders.is_empty());
    }

    #[test]
    fn refuses_rows_that_are_not_json() {
        let dir = tmp("badrow");
        let mut conn = open(&dir.join(DB)).unwrap();
        assert!(write(&mut conn, &Change { upserts: vec![row("/a", "/a/1", "", 0, r#"{"path":"/a/1"}"#), row("/a", "/a/2", "", 1, "{oops")], ..Default::default() }).is_err());
        // The transaction rolled back: nothing from it was kept.
        assert!(load(&conn).unwrap().folders.is_empty());
    }

    #[test]
    fn schema_upgrade_snapshots_v1_before_edit_storage_and_does_not_repeat_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(DB);
        let old = Connection::open(&path).unwrap();
        old.execute_batch("CREATE TABLE roots(root TEXT PRIMARY KEY); CREATE TABLE photos(root TEXT,path TEXT,copy TEXT,pos INTEGER,data TEXT); CREATE TABLE folder_imports(root TEXT PRIMARY KEY,value TEXT); CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT); INSERT INTO photos VALUES('/a','/a/1','',0,'{}'); PRAGMA user_version=1;").unwrap();
        drop(old);
        let conn = open(&path).unwrap();
        assert_eq!(version(&conn).unwrap(),2);
        let snapshot = dir.path().join("backups/before-catalog-edits").join(DB);
        let before = Connection::open(&snapshot).unwrap();
        assert_eq!(version(&before).unwrap(),1);
        assert_eq!(before.query_row("SELECT COUNT(*) FROM photos",[],|r|r.get::<_,i64>(0)).unwrap(),1);
        drop(before); drop(conn);
        let bytes = fs::read(&snapshot).unwrap();
        drop(open(&path).unwrap());
        assert_eq!(fs::read(&snapshot).unwrap(),bytes);
    }

    #[test]
    fn refuses_a_newer_catalog() {
        let dir = tmp("newer");
        let path = dir.join(DB);
        Connection::open(&path).unwrap().pragma_update(None, "user_version", 99).unwrap();
        assert!(open(&path).unwrap_err().contains("newer Emulsion"));
    }

    #[test]
    fn backup_restores_and_keeps_the_newest() {
        let dir = tmp("backup");
        let db = CatalogDb::new(&dir.join("data"));
        db.with(|c| write(c, &Change { upserts: vec![row("/a", "/a/1", "", 0, r#"{"path":"/a/1"}"#)], ..Default::default() })).unwrap();
        let folder = dir.join("Backups");
        let first = db.with(|c| backup(c, &folder, "2026-11-11 1500", true, true)).unwrap();
        assert!(first.bytes > 0);
        // A later change, then restore the earlier backup.
        db.with(|c| write(c, &Change { upserts: vec![row("/a", "/a/2", "", 1, r#"{"path":"/a/2"}"#)], ..Default::default() })).unwrap();
        let r = restore(&db, Path::new(&first.path), &folder, "2026-11-11 1510").unwrap();
        assert_eq!(db.with(|c| load(c)).unwrap().folders["/a"].len(), 1);
        // What was there before the restore is itself a backup with both photos.
        let before = tmp("backup-before").join(DB);
        unpack_backup(Path::new(&r.before), &before).unwrap();
        assert_eq!(load(&Connection::open(&before).unwrap()).unwrap().folders["/a"].len(), 2);
        // Same-minute names don't collide; only the newest KEEP_BACKUPS stay.
        for i in 0..KEEP_BACKUPS + 2 {
            db.with(|c| backup(c, &folder, &format!("2026-11-12 {:04}", 1000 + i), false, false)).unwrap();
        }
        db.with(|c| backup(c, &folder, "2026-11-12 1011", false, false)).unwrap();
        let kept = backups(&folder);
        assert_eq!(kept.len(), KEEP_BACKUPS);
        assert!(kept[0].ends_with("Emulsion Catalog 2026-11-12 1011 2.zip"), "{:?}", kept[0]);
        assert!(!folder.join(&first.path).exists());
    }

    #[test]
    fn restore_refuses_what_is_not_a_backup() {
        let dir = tmp("notours");
        let db = CatalogDb::new(&dir.join("data"));
        let junk = dir.join("junk.zip");
        fs::write(&junk, b"not a zip").unwrap();
        assert!(restore(&db, &junk, &dir, "x").unwrap_err().contains("not an Emulsion catalog backup"));
        let mut zip = zip::ZipWriter::new(fs::File::create(&junk).unwrap());
        zip.start_file(BACKUP_ENTRY, zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(b"also not sqlite").unwrap();
        zip.finish().unwrap();
        assert!(restore(&db, &junk, &dir, "x").is_err());
        assert!(!sibling(&db.path, ".restore").exists(), "no stray restore file");
    }

    /// Timing on a real index: `EMULSION_CATALOG_INDEX=<libraryIndex.json> [EMULSION_CATALOG_SCALE=n]
    /// cargo test --release catalog_scale -- --ignored --nocapture` (the JSON the webview kept,
    /// root → photos; scale repeats it under n roots).
    #[test]
    #[ignore]
    fn catalog_scale() {
        use std::time::Instant;
        let index: BTreeMap<String, Vec<Value>> = serde_json::from_slice(&fs::read(std::env::var("EMULSION_CATALOG_INDEX").unwrap()).unwrap()).unwrap();
        let scale: usize = std::env::var("EMULSION_CATALOG_SCALE").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
        let dir = tmp("scale");
        let mut conn = open(&dir.join(DB)).unwrap();
        let mut upserts = Vec::new();
        for n in 0..scale {
            for (root, photos) in &index {
                for (pos, p) in photos.iter().enumerate() {
                    let path = format!("{}#{n}", p["path"].as_str().unwrap());
                    upserts.push(Row { root: format!("{root}#{n}"), path, copy: p["copyId"].as_str().unwrap_or("").into(), pos: pos as i64, data: p.to_string() });
                }
            }
        }
        let count = upserts.len();
        let t = Instant::now();
        write(&mut conn, &Change { upserts, ..Default::default() }).unwrap();
        println!("{count} photos: first write {:?}", t.elapsed());
        let t = Instant::now();
        let loaded = load(&conn).unwrap();
        let json = serde_json::to_vec(&loaded).unwrap();
        println!("load + serialise {:?} ({} MB)", t.elapsed(), json.len() / 1_000_000);
        let one = index.iter().find(|(_, p)| !p.is_empty()).unwrap();
        let t = Instant::now();
        let edit = Row { root: format!("{}#0", one.0), path: format!("{}#0", one.1[0]["path"].as_str().unwrap()), copy: String::new(), pos: 0, data: one.1[0].to_string() };
        write(&mut conn, &Change { upserts: vec![edit], ..Default::default() }).unwrap();
        println!("one-photo edit {:?}", t.elapsed());
        let t = Instant::now();
        let b = backup(&conn, &dir.join("Backups"), "2026-01-01 0000", true, false).unwrap();
        println!("backup with integrity test {:?} ({} MB zip, db {} MB)", t.elapsed(), b.bytes / 1_000_000, fs::metadata(dir.join(DB)).unwrap().len() / 1_000_000);
    }

    #[test]
    fn snapshot_copies_a_live_catalog() {
        let dir = tmp("snapshot");
        let db = CatalogDb::new(&dir);
        db.with(|c| write(c, &Change { upserts: vec![row("/a", "/a/1", "", 0, r#"{"path":"/a/1"}"#)], ..Default::default() })).unwrap();
        let dest = dir.join("copy.db");
        snapshot_file(&dir.join(DB), &dest).unwrap();
        assert_eq!(load(&Connection::open(&dest).unwrap()).unwrap().folders["/a"].len(), 1);
        snapshot_file(&dir.join("missing.db"), &dir.join("none.db")).unwrap();
        assert!(!dir.join("none.db").exists());
    }
}
