// SPDX-License-Identifier: GPL-3.0-or-later
//! Portable edit envelopes: legacy `<file name>.emulsion.json` files and the optional export
//! of authoritative catalog edits. Nothing is ever written into the photo itself.
//!
//! A sidecar also keeps earlier states of the photo's edits (`history`), as darktable keeps the
//! history stack in its XMP sidecars, so a reset or a batch paste can be taken back after the
//! session's undo is gone. A state is kept when it is replaced at a checkpoint: a reset, an edit
//! the webview marks (pasting or applying to several photos, restoring), or the first change
//! after `SESSION_MS` since the last checkpoint. Stars, tags and flags are not edits and never
//! make history. A photo with history keeps its sidecar after a reset.
//!
//! The original frame's stars, colour label, keywords and IPTC fields are also shared through an
//! XMP sidecar (`xmp.rs`): a save that changes them writes the XMP too, and `xmp` records the XMP's
//! modified time after that write, so a scan can tell when another app changed it since.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::xmp::{Interchange, Meta};
#[cfg(test)]
use crate::xmp;

pub const SUFFIX: &str = ".emulsion.json";
const FORMAT: &str = "emulsion";
const VERSION: u32 = 2;
/// Edits more than this long after the last checkpoint start a new one.
pub const SESSION_MS: u64 = 30 * 60 * 1000;
/// Earlier states kept per photo, and the most they may take in the file.
pub const KEEP: usize = 20;
const MAX_HISTORY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub(crate) struct Sidecar {
    pub(crate) format: String,
    pub(crate) version: u32,
    /// Milliseconds since the Unix epoch.
    pub(crate) updated: u64,
    /// The look; `null` for a photo that is only rated or tagged.
    pub(crate) recipe: serde_json::Value,
    #[serde(default, skip_serializing_if = "is_zero")]
    pub(crate) rating: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) flag: Option<String>,
    /// Hearts, before pick and reject flags replaced them (2026-11-11): read as a pick, never written.
    #[serde(default, skip_serializing)]
    pub(crate) heart: bool,
    #[serde(default, skip_serializing_if = "Meta::is_empty")]
    pub(crate) meta: Meta,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) copies: Vec<VirtualCopy>,
    /// The XMP sidecar's modified time after Emulsion last wrote it, ms.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) xmp: Option<u64>,
    /// When the last earlier state was kept (or the sidecar was first written), ms.
    #[serde(default)]
    pub(crate) checkpoint: u64,
    /// Earlier states of the edits, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) history: Vec<Earlier>,
}

/// An earlier state of a photo's edits: its own recipe and its virtual copies'.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Earlier {
    /// When this state was saved, ms since the Unix epoch.
    pub updated: u64,
    /// When it was replaced.
    pub replaced: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recovered: Option<Saved>,
    pub recipe: serde_json::Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub copies: Vec<VirtualCopy>,
}

fn is_zero(n: &u8) -> bool {
    *n == 0
}

/// An independent edit of the same source file, stored in its source's sidecar.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VirtualCopy {
    pub id: String,
    pub name: String,
    pub recipe: Option<serde_json::Value>,
    #[serde(default)]
    pub rating: u8,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flag: Option<String>,
    /// A heart from before flags, read as a pick by `read_synced`; never written.
    #[serde(default, skip_serializing)]
    pub heart: bool,
}

/// The cull flags: a pick or a reject, independent of stars and labels.
pub const FLAGS: &[&str] = &["pick", "reject"];

/// A flag as saved, with a heart from before flags read as a pick.
fn flag_of(flag: Option<String>, heart: bool) -> Option<String> {
    flag.filter(|f| FLAGS.contains(&f.as_str())).or_else(|| heart.then(|| "pick".to_string()))
}

/// What a sidecar keeps for one photo.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub recipe: Option<serde_json::Value>,
    /// Stars, 0 to 5; 0 is unrated.
    #[serde(default)]
    pub rating: u8,
    /// A colour tag: red, yellow, green, blue or purple.
    #[serde(default)]
    pub label: Option<String>,
    /// The cull flag, `pick` or `reject`; a reject is shared through XMP as Rating -1.
    #[serde(default)]
    pub flag: Option<String>,
    /// Keywords and IPTC fields of the source file (its copies share them).
    #[serde(default)]
    pub meta: Meta,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub copies: Vec<VirtualCopy>,
}

impl Saved {
    #[cfg(test)]
    fn is_empty(&self) -> bool {
        self.recipe.is_none() && self.rating == 0 && self.label.is_none() && self.flag.is_none() && self.meta.is_empty() && self.copies.is_empty()
    }

    /// What the XMP sidecar shares of it.
    pub fn interchange(&self) -> Interchange {
        Interchange { rating: self.rating.min(5), label: self.label.clone(), reject: self.flag.as_deref() == Some("reject"), meta: self.meta.tidy() }
    }
}

/// How a sidecar last stood against the XMP: when it was written, and the XMP's modified time
/// after Emulsion's last write of it.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Sync {
    pub updated: u64,
    pub xmp: Option<u64>,
}

pub fn path_for(image: &Path) -> PathBuf {
    let mut s = image.as_os_str().to_owned();
    s.push(SUFFIX);
    PathBuf::from(s)
}

/// What is saved for `image`, or `None` when there is no readable sidecar.
#[cfg(test)]
fn read_car(image: &Path) -> Option<Sidecar> {
    let text = fs::read_to_string(path_for(image)).ok()?;
    let car: Sidecar = serde_json::from_str(&text).ok()?;
    (car.format == FORMAT).then_some(car)
}

#[cfg(test)]
pub fn read(image: &Path) -> Option<Saved> {
    read_synced(image).map(|(saved, _)| saved)
}

/// What is saved for `image`, and how it stood against the XMP.
#[cfg(test)]
pub fn read_synced(image: &Path) -> Option<(Saved, Sync)> {
    let car = read_car(image)?;
    Some((car.saved(), Sync { updated: car.updated, xmp: car.xmp })).filter(|(s, _)| !s.is_empty())
}

/// Earlier states of `image`'s edits, newest first.
#[cfg(test)]
pub fn history(image: &Path) -> Vec<Earlier> {
    let mut h = read_car(image).map(|c| c.history).unwrap_or_default();
    h.reverse();
    h
}

/// The parts of a state that are edits: recipes and copies, not marks.
fn edits(recipe: &serde_json::Value, copies: &[VirtualCopy]) -> (serde_json::Value, Vec<(String, String, Option<serde_json::Value>)>) {
    (recipe.clone(), copies.iter().map(|c| (c.id.clone(), c.name.clone(), c.recipe.clone())).collect())
}

fn has_edits(recipe: &serde_json::Value, copies: &[VirtualCopy]) -> bool {
    !recipe.is_null() || !copies.is_empty()
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Save `saved` for `image`; `checkpoint` keeps the edits it replaces in the history. With
/// no recipe, rating or label and no history the sidecar is removed, returning the photo to its
/// original state. Writes go to a temporary file first and are renamed into place so a crash
/// never leaves a half-written sidecar.
///
/// When the stars, label, keywords or IPTC fields differ from the last save, the XMP sidecar is
/// updated first. If that fails the edits are still saved and the error is returned.
#[cfg(test)]
pub fn write(image: &Path, saved: &Saved, checkpoint: bool) -> io::Result<()> {
    write_at(image, saved, checkpoint, now_ms())
}

#[cfg(test)]
fn write_at(image: &Path, saved: &Saved, checkpoint: bool, now: u64) -> io::Result<()> {
    let target = path_for(image);
    let old = read_car(image);
    let before = old.as_ref().map(|o| Interchange { rating: o.rating.min(5), label: o.label.clone(), reject: flag_of(o.flag.clone(), o.heart).as_deref() == Some("reject"), meta: o.meta.tidy() }).unwrap_or_default();
    let mut xmp_time = old.as_ref().and_then(|o| o.xmp);
    let mut xmp_error = None;
    let interchange = saved.interchange();
    if interchange != before {
        match xmp::write(image, &interchange) {
            Ok(Some(t)) => xmp_time = Some(t),
            Ok(None) => {}
            Err(e) => xmp_error = Some(e),
        }
    }
    let mut car = next_document(saved, old.as_ref(), checkpoint, now);
    car.xmp = xmp_time;
    if saved.is_empty() && car.history.is_empty() {
        return match fs::remove_file(&target) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => xmp_error.map_or(Ok(()), Err),
        };
    }
    let text = serde_json::to_string_pretty(&car).map_err(io::Error::other)?;
    let mut tmp = target.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &target)?;
    xmp_error.map_or(Ok(()), |e| Err(io::Error::new(e.kind(), format!("edits saved, but the XMP sidecar was not updated: {e}"))))
}

/// Decode a legacy envelope strictly: corruption and newer versions must never become defaults.
pub(crate) fn decode_document(text: &str) -> io::Result<Sidecar> {
    let mut car: Sidecar = serde_json::from_str(text).map_err(io::Error::other)?;
    if car.format != FORMAT || !(1..=VERSION).contains(&car.version) {
        return Err(io::Error::other("This sidecar is not a supported Emulsion edit file"));
    }
    car.flag = flag_of(car.flag.take(), car.heart); car.heart = false;
    let normalize = |c: &mut VirtualCopy| { c.flag = flag_of(c.flag.take(), c.heart); c.heart = false; };
    car.copies.iter_mut().for_each(normalize);
    for h in &mut car.history { h.copies.iter_mut().for_each(normalize); }
    Ok(car)
}

impl Sidecar {
    pub(crate) fn saved(&self) -> Saved {
        Saved {
            recipe: Some(self.recipe.clone()).filter(|r| !r.is_null()), rating: self.rating.min(5),
            label: self.label.clone(), flag: flag_of(self.flag.clone(), self.heart), meta: self.meta.clone(),
            copies: self.copies.iter().cloned().map(|c| VirtualCopy { flag: flag_of(c.flag, c.heart), heart: false, ..c }).collect(),
        }
    }
}

/// Preserve the same checkpoint/history rules in the catalog and optional portable files.
pub(crate) fn next_document(saved: &Saved, old: Option<&Sidecar>, checkpoint: bool, now: u64) -> Sidecar {
    let recipe = saved.recipe.clone().unwrap_or(serde_json::Value::Null);
    let interchange = saved.interchange();
    let mut history = Vec::new();
    let mut last_checkpoint = now;
    if let Some(old) = old.cloned() {
        history = old.history;
        last_checkpoint = old.checkpoint;
        let before = edits(&old.recipe, &old.copies);
        let resetting = !has_edits(&recipe, &saved.copies);
        let due = checkpoint || resetting || now.saturating_sub(old.checkpoint) >= SESSION_MS;
        if has_edits(&old.recipe, &old.copies) && before != edits(&recipe, &saved.copies) && due {
            if history.last().map(|l| edits(&l.recipe, &l.copies)) != Some(before) {
                history.push(Earlier { updated: old.updated, replaced: now, recipe: old.recipe, copies: old.copies, note: None, recovered: None });
            }
            last_checkpoint = now;
        }
    }
    let excess = history.len().saturating_sub(KEEP);
    history.drain(..excess);
    while history.len() > 1 && serde_json::to_vec(&history).map(|b| b.len()).unwrap_or(0) > MAX_HISTORY_BYTES {
        history.remove(0);
    }
    let updated = now;
    Sidecar {
        format: FORMAT.into(),
        version: VERSION,
        updated,
        recipe: saved.recipe.clone().unwrap_or(serde_json::Value::Null),
        rating: saved.rating.min(5),
        label: saved.label.clone(),
        flag: flag_of(saved.flag.clone(), false),
        heart: false,
        meta: interchange.meta,
        copies: saved.copies.iter().map(|c| VirtualCopy { flag: flag_of(c.flag.clone(), c.heart), heart: false, ..c.clone() }).collect(),
        xmp: old.and_then(|o| o.xmp),
        checkpoint: last_checkpoint,
        history,
    }
}

/// Export a complete catalog state, including an explicit reset and its history.
pub(crate) fn export_document(image: &Path, car: &Sidecar) -> io::Result<()> {
    let target = path_for(image);
    match fs::read_to_string(&target) {
        Ok(text) => { decode_document(&text)?; }
        Err(e) if e.kind() == io::ErrorKind::NotFound => {},
        Err(e) => return Err(e),
    }
    let text = serde_json::to_vec_pretty(car).map_err(io::Error::other)?;
    let tmp = target.with_extension("json.tmp");
    let mut file = fs::File::create(&tmp)?;
    use std::io::Write;
    file.write_all(&text)?;
    crate::durable::sync(&file)?;
    fs::rename(tmp, target)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sidecar_sits_next_to_the_photo() {
        assert_eq!(path_for(Path::new("/a/DSCF0001.JPG")), PathBuf::from("/a/DSCF0001.JPG.emulsion.json"));
    }

    #[test]
    fn round_trips_and_removes() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        assert!(read(&img).is_none());

        let look = Saved { recipe: Some(json!({ "stock": "gold200", "exposure": 0.5 })), ..Saved::default() };
        write(&img, &look, false).unwrap();
        assert_eq!(read(&img).unwrap(), look);
        assert!(!dir.path().join("a.jpg.emulsion.json.tmp").exists());

        // A reset returns the photo to its original state but keeps what it replaced.
        write(&img, &Saved::default(), false).unwrap();
        assert!(read(&img).is_none());
        assert_eq!(history(&img).len(), 1);
        assert_eq!(history(&img)[0].recipe, look.recipe.clone().unwrap());

        // Marks alone never make history, and their sidecar goes when they are cleared.
        let other = dir.path().join("b.jpg");
        write(&other, &Saved { rating: 3, ..Saved::default() }, false).unwrap();
        write(&other, &Saved::default(), false).unwrap();
        assert!(!path_for(&other).exists());
        // Removing again is not an error.
        write(&other, &Saved::default(), false).unwrap();
    }

    #[test]
    fn keeps_earlier_edits_at_checkpoints() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        let look = |e: f64| Saved { recipe: Some(json!({ "exposure": e })), ..Saved::default() };
        let t0 = 1_000_000_000_000;
        write_at(&img, &look(0.1), false, t0).unwrap();
        // Dragging a slider within a session keeps no history.
        for (n, e) in [0.2, 0.3, 0.4].into_iter().enumerate() {
            write_at(&img, &look(e), false, t0 + 1000 * (n as u64 + 1)).unwrap();
        }
        assert!(history(&img).is_empty());
        // A marked edit (a paste) keeps the state it replaces.
        write_at(&img, &look(1.0), true, t0 + 5000).unwrap();
        assert_eq!(history(&img)[0].recipe, json!({ "exposure": 0.4 }));
        // Marks don't count.
        write_at(&img, &Saved { rating: 4, ..look(1.0) }, true, t0 + 6000).unwrap();
        assert_eq!(history(&img).len(), 1);
        // The first edit of a later session keeps where the last one ended.
        write_at(&img, &Saved { rating: 4, ..look(1.1) }, false, t0 + 6000 + SESSION_MS).unwrap();
        let h = history(&img);
        assert_eq!(h.len(), 2);
        assert_eq!((h[0].recipe.clone(), h[0].updated), (json!({ "exposure": 1.0 }), t0 + 6000));
        assert_eq!(read(&img).unwrap().rating, 4);
        // Each marked edit keeps the state it replaced.
        write_at(&img, &look(1.0), true, t0 + 7000 + SESSION_MS).unwrap();
        write_at(&img, &look(1.1), true, t0 + 8000 + SESSION_MS).unwrap();
        write_at(&img, &look(1.0), true, t0 + 9000 + SESSION_MS).unwrap();
        assert_eq!(history(&img).iter().map(|e| e.recipe["exposure"].as_f64().unwrap()).collect::<Vec<_>>(), vec![1.1, 1.0, 1.1, 1.0, 0.4]);
        // At most KEEP states.
        for n in 0..30 {
            write_at(&img, &look(n as f64), true, t0 + 20_000 + n).unwrap();
        }
        assert_eq!(history(&img).len(), KEEP);
    }

    #[test]
    fn sidecars_without_history_read_as_before() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        fs::write(path_for(&img), r#"{"format":"emulsion","version":2,"updated":5,"recipe":{"stock":"portra400"}}"#).unwrap();
        assert!(history(&img).is_empty());
        // Its first change is the start of a session: the old edit is kept.
        write(&img, &Saved { recipe: Some(json!({ "stock": "gold200" })), ..Saved::default() }, false).unwrap();
        assert_eq!(history(&img)[0].updated, 5);
    }

    #[test]
    fn keeps_a_rating_or_label_without_a_look() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        let marked = Saved { recipe: None, rating: 4, label: Some("green".into()), flag: Some("pick".into()), ..Saved::default() };
        write(&img, &marked, false).unwrap();
        assert_eq!(read(&img).unwrap(), marked);
        let text = fs::read_to_string(path_for(&img)).unwrap();
        assert!(text.contains("\"recipe\": null"), "{text}");
    }

    #[test]
    fn a_heart_from_before_flags_reads_as_a_pick_and_is_written_as_one() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        fs::write(path_for(&img), r#"{"format":"emulsion","version":2,"updated":0,"recipe":null,"rating":2,"heart":true,
            "copies":[{"id":"c","name":"Copy","recipe":null,"rating":0,"label":null,"heart":true}]}"#).unwrap();
        let saved = read(&img).unwrap();
        assert_eq!((saved.rating, saved.flag.as_deref(), saved.copies[0].flag.as_deref()), (2, Some("pick"), Some("pick")));
        write(&img, &saved, false).unwrap();
        let text = fs::read_to_string(path_for(&img)).unwrap();
        assert!(!text.contains("heart") && text.matches("\"flag\": \"pick\"").count() == 2, "{text}");
        assert_eq!(read(&img).unwrap(), saved);
    }

    #[test]
    fn a_reject_is_rating_minus_one_in_the_xmp_and_keeps_its_stars_here() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("DSCF2.RAF");
        fs::write(&img, b"x").unwrap();
        let rejected = Saved { rating: 3, flag: Some("reject".into()), ..Saved::default() };
        write(&img, &rejected, false).unwrap();
        assert_eq!(read(&img).unwrap(), rejected);
        let found = xmp::read_sidecar(&img, true).unwrap().values;
        assert_eq!((found.rating, found.reject), (0, true));
        let text = fs::read_to_string(dir.path().join("DSCF2.xmp")).unwrap();
        assert!(text.contains("-1"), "{text}");
        // Un-rejecting gives the XMP its stars back; a pick says nothing to other apps.
        write(&img, &Saved { flag: Some("pick".into()), ..rejected }, false).unwrap();
        let found = xmp::read_sidecar(&img, true).unwrap().values;
        assert_eq!((found.rating, found.reject), (3, false));
    }

    #[test]
    fn reads_sidecars_from_before_ratings() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        fs::write(path_for(&img), r#"{"format":"emulsion","version":1,"updated":0,"recipe":{"stock":"portra400"}}"#).unwrap();
        assert_eq!(read(&img).unwrap(), Saved { recipe: Some(json!({ "stock": "portra400" })), rating: 0, label: None, flag: None, ..Saved::default() });
    }

    #[test]
    fn keeps_versions_of_an_unedited_original_and_removes_only_the_last_copy() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        fs::write(&img, b"original bytes").unwrap();
        let copy = VirtualCopy { id: "stable-id".into(), name: "Black and white".into(),
            recipe: Some(json!({"exposure": 1.5})), rating: 5, label: Some("red".into()), flag: Some("reject".into()), heart: false };
        let mut saved = Saved { copies: vec![copy], ..Saved::default() };
        write(&img, &saved, false).unwrap();
        assert_eq!(read(&img), Some(saved.clone()));
        assert_eq!(fs::read(&img).unwrap(), b"original bytes");
        let text: serde_json::Value = serde_json::from_str(&fs::read_to_string(path_for(&img)).unwrap()).unwrap();
        assert_eq!(text["version"], 2);
        assert!(text["recipe"].is_null());

        // Resetting a copy does not delete it, even when it has no marks.
        saved.copies[0].recipe = None;
        saved.copies[0].rating = 0;
        saved.copies[0].label = None;
        saved.copies[0].flag = None;
        write(&img, &saved, false).unwrap();
        assert_eq!(read(&img), Some(saved.clone()));

        // Removing the last copy keeps it in the history, and never touches the image.
        write(&img, &Saved::default(), false).unwrap();
        assert!(read(&img).is_none());
        assert_eq!(history(&img)[0].copies, saved.copies);
        assert_eq!(fs::read(&img).unwrap(), b"original bytes");
    }

    #[test]
    fn shares_marks_and_metadata_through_the_xmp_and_records_when() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("DSCF1.RAF");
        fs::write(&img, b"x").unwrap();
        let xmp_path = dir.path().join("DSCF1.xmp");
        // A look alone says nothing to other apps.
        write(&img, &Saved { recipe: Some(json!({ "exposure": 1 })), ..Saved::default() }, false).unwrap();
        assert!(!xmp_path.exists());
        let mut meta = Meta { keywords: vec!["Sea".into()], ..Meta::default() };
        meta.set("title", "Harbour");
        let saved = Saved { recipe: Some(json!({ "exposure": 1 })), rating: 3, label: Some("blue".into()), flag: Some("pick".into()), meta: meta.clone(), ..Saved::default() };
        write(&img, &saved, false).unwrap();
        let (back, sync) = read_synced(&img).unwrap();
        assert_eq!(back, saved);
        assert_eq!(sync.xmp, xmp::mtime_ms(&xmp_path));
        let found = xmp::read_sidecar(&img, true).unwrap();
        assert_eq!(found.values, Interchange { rating: 3, label: Some("blue".into()), reject: false, meta });
        // A recipe change leaves the XMP alone.
        let before = fs::read_to_string(&xmp_path).unwrap();
        write(&img, &Saved { recipe: Some(json!({ "exposure": 2 })), ..saved.clone() }, false).unwrap();
        assert_eq!(fs::read_to_string(&xmp_path).unwrap(), before);
        // Clearing the marks clears them in the XMP, which stays for other apps' fields.
        write(&img, &Saved::default(), false).unwrap();
        assert!(xmp::read_sidecar(&img, true).unwrap().values.is_empty());
    }

    #[test]
    fn a_broken_xmp_still_saves_the_edits() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.nef");
        fs::write(&img, b"x").unwrap();
        fs::write(dir.path().join("a.xmp"), "garbage").unwrap();
        let saved = Saved { rating: 2, ..Saved::default() };
        let e = write(&img, &saved, false).unwrap_err();
        assert!(e.to_string().contains("XMP"), "{e}");
        assert_eq!(read(&img).unwrap(), saved);
    }

    #[test]
    fn ignores_foreign_or_broken_files() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        fs::write(path_for(&img), "{ not json").unwrap();
        assert!(read(&img).is_none());
        fs::write(path_for(&img), r#"{"format":"other","version":1,"updated":0,"recipe":{}}"#).unwrap();
        assert!(read(&img).is_none());
    }
}
