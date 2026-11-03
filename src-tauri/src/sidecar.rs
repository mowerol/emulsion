// SPDX-License-Identifier: GPL-3.0-or-later
//! Sidecars: each edited, rated, tagged or hearted photo gets `<file name>.emulsion.json`
//! next to it. Nothing is ever written into the photo itself.
//!
//! A sidecar also keeps earlier states of the photo's edits (`history`), as darktable keeps the
//! history stack in its XMP sidecars, so a reset or a batch paste can be taken back after the
//! session's undo is gone. A state is kept when it is replaced at a checkpoint: a reset, an edit
//! the webview marks (pasting or applying to several photos, restoring), or the first change
//! after `SESSION_MS` since the last checkpoint. Stars, tags and hearts are not edits and never
//! make history. A photo with history keeps its sidecar after a reset.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SUFFIX: &str = ".emulsion.json";
const FORMAT: &str = "emulsion";
const VERSION: u32 = 2;
/// Edits more than this long after the last checkpoint start a new one.
pub const SESSION_MS: u64 = 30 * 60 * 1000;
/// Earlier states kept per photo, and the most they may take in the file.
pub const KEEP: usize = 20;
const MAX_HISTORY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Sidecar {
    format: String,
    version: u32,
    /// Milliseconds since the Unix epoch.
    updated: u64,
    /// The look; `null` for a photo that is only rated or tagged.
    recipe: serde_json::Value,
    #[serde(default, skip_serializing_if = "is_zero")]
    rating: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    heart: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    copies: Vec<VirtualCopy>,
    /// When the last earlier state was kept (or the sidecar was first written), ms.
    #[serde(default)]
    checkpoint: u64,
    /// Earlier states of the edits, oldest first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    history: Vec<Earlier>,
}

/// An earlier state of a photo's edits: its own recipe and its virtual copies'.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Earlier {
    /// When this state was saved, ms since the Unix epoch.
    pub updated: u64,
    /// When it was replaced.
    pub replaced: u64,
    pub recipe: serde_json::Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub copies: Vec<VirtualCopy>,
}

fn is_false(b: &bool) -> bool {
    !*b
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
    #[serde(default)]
    pub heart: bool,
}

/// What a sidecar keeps for one photo.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Saved {
    pub recipe: Option<serde_json::Value>,
    /// Stars, 0 to 5; 0 is unrated.
    #[serde(default)]
    pub rating: u8,
    /// A colour tag: red, yellow, green or blue.
    #[serde(default)]
    pub label: Option<String>,
    /// A favourite.
    #[serde(default)]
    pub heart: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub copies: Vec<VirtualCopy>,
}

impl Saved {
    fn is_empty(&self) -> bool {
        self.recipe.is_none() && self.rating == 0 && self.label.is_none() && !self.heart && self.copies.is_empty()
    }
}

pub fn path_for(image: &Path) -> PathBuf {
    let mut s = image.as_os_str().to_owned();
    s.push(SUFFIX);
    PathBuf::from(s)
}

/// What is saved for `image`, or `None` when there is no readable sidecar.
fn read_car(image: &Path) -> Option<Sidecar> {
    let text = fs::read_to_string(path_for(image)).ok()?;
    let car: Sidecar = serde_json::from_str(&text).ok()?;
    (car.format == FORMAT).then_some(car)
}

pub fn read(image: &Path) -> Option<Saved> {
    let car = read_car(image)?;
    let saved = Saved {
        recipe: Some(car.recipe).filter(|r| !r.is_null()),
        rating: car.rating.min(5),
        label: car.label,
        heart: car.heart,
        copies: car.copies,
    };
    Some(saved).filter(|s| !s.is_empty())
}

/// Earlier states of `image`'s edits, newest first.
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

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Save `saved` for `image`; `checkpoint` keeps the edits it replaces in the history. With
/// no recipe, rating or label and no history the sidecar is removed, returning the photo to its
/// original state. Writes go to a temporary file first and are renamed into place so a crash
/// never leaves a half-written sidecar.
pub fn write(image: &Path, saved: &Saved, checkpoint: bool) -> io::Result<()> {
    write_at(image, saved, checkpoint, now_ms())
}

fn write_at(image: &Path, saved: &Saved, checkpoint: bool, now: u64) -> io::Result<()> {
    let target = path_for(image);
    let recipe = saved.recipe.clone().unwrap_or(serde_json::Value::Null);
    let old = read_car(image);
    let mut history = Vec::new();
    let mut last_checkpoint = now;
    if let Some(old) = old {
        history = old.history;
        last_checkpoint = old.checkpoint;
        let before = edits(&old.recipe, &old.copies);
        let resetting = !has_edits(&recipe, &saved.copies);
        let due = checkpoint || resetting || now.saturating_sub(old.checkpoint) >= SESSION_MS;
        if has_edits(&old.recipe, &old.copies) && before != edits(&recipe, &saved.copies) && due {
            if history.last().map(|l| edits(&l.recipe, &l.copies)) != Some(before) {
                history.push(Earlier { updated: old.updated, replaced: now, recipe: old.recipe, copies: old.copies });
            }
            last_checkpoint = now;
        }
    }
    let excess = history.len().saturating_sub(KEEP);
    history.drain(..excess);
    while history.len() > 1 && serde_json::to_vec(&history).map(|b| b.len()).unwrap_or(0) > MAX_HISTORY_BYTES {
        history.remove(0);
    }
    if saved.is_empty() && history.is_empty() {
        return match fs::remove_file(&target) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    let updated = now;
    let car = Sidecar {
        format: FORMAT.into(),
        version: VERSION,
        updated,
        recipe: saved.recipe.clone().unwrap_or(serde_json::Value::Null),
        rating: saved.rating.min(5),
        label: saved.label.clone(),
        heart: saved.heart,
        copies: saved.copies.clone(),
        checkpoint: last_checkpoint,
        history,
    };
    let text = serde_json::to_string_pretty(&car).map_err(io::Error::other)?;
    let mut tmp = target.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, text)?;
    fs::rename(&tmp, &target)
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
        let marked = Saved { recipe: None, rating: 4, label: Some("green".into()), heart: true, ..Saved::default() };
        write(&img, &marked, false).unwrap();
        assert_eq!(read(&img).unwrap(), marked);
        let text = fs::read_to_string(path_for(&img)).unwrap();
        assert!(text.contains("\"recipe\": null"), "{text}");
    }

    #[test]
    fn reads_sidecars_from_before_ratings() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        fs::write(path_for(&img), r#"{"format":"emulsion","version":1,"updated":0,"recipe":{"stock":"portra400"}}"#).unwrap();
        assert_eq!(read(&img).unwrap(), Saved { recipe: Some(json!({ "stock": "portra400" })), rating: 0, label: None, heart: false, ..Saved::default() });
    }

    #[test]
    fn keeps_versions_of_an_unedited_original_and_removes_only_the_last_copy() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        fs::write(&img, b"original bytes").unwrap();
        let copy = VirtualCopy { id: "stable-id".into(), name: "Black and white".into(),
            recipe: Some(json!({"exposure": 1.5})), rating: 5, label: Some("red".into()), heart: true };
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
        saved.copies[0].heart = false;
        write(&img, &saved, false).unwrap();
        assert_eq!(read(&img), Some(saved.clone()));

        // Removing the last copy keeps it in the history, and never touches the image.
        write(&img, &Saved::default(), false).unwrap();
        assert!(read(&img).is_none());
        assert_eq!(history(&img)[0].copies, saved.copies);
        assert_eq!(fs::read(&img).unwrap(), b"original bytes");
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
