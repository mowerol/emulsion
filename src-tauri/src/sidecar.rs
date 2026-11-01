// SPDX-License-Identifier: GPL-3.0-or-later
//! Sidecars: each edited, rated, tagged or hearted photo gets `<file name>.emulsion.json`
//! next to it. Nothing is ever written into the photo itself.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SUFFIX: &str = ".emulsion.json";
const FORMAT: &str = "emulsion";
const VERSION: u32 = 2;

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
pub fn read(image: &Path) -> Option<Saved> {
    let text = fs::read_to_string(path_for(image)).ok()?;
    let car: Sidecar = serde_json::from_str(&text).ok()?;
    if car.format != FORMAT {
        return None;
    }
    let saved = Saved {
        recipe: Some(car.recipe).filter(|r| !r.is_null()),
        rating: car.rating.min(5),
        label: car.label,
        heart: car.heart,
        copies: car.copies,
    };
    Some(saved).filter(|s| !s.is_empty())
}

/// Save `saved` for `image`. With no recipe, rating or label the sidecar is
/// removed, returning the photo to its original state. Writes go to a temporary
/// file first and are renamed into place so a crash never leaves a half-written sidecar.
pub fn write(image: &Path, saved: &Saved) -> io::Result<()> {
    let target = path_for(image);
    if saved.is_empty() {
        return match fs::remove_file(&target) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    let updated = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let car = Sidecar {
        format: FORMAT.into(),
        version: VERSION,
        updated,
        recipe: saved.recipe.clone().unwrap_or(serde_json::Value::Null),
        rating: saved.rating.min(5),
        label: saved.label.clone(),
        heart: saved.heart,
        copies: saved.copies.clone(),
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
        write(&img, &look).unwrap();
        assert_eq!(read(&img).unwrap(), look);
        assert!(!dir.path().join("a.jpg.emulsion.json.tmp").exists());

        write(&img, &Saved::default()).unwrap();
        assert!(read(&img).is_none());
        assert!(!path_for(&img).exists());
        // Removing again is not an error.
        write(&img, &Saved::default()).unwrap();
    }

    #[test]
    fn keeps_a_rating_or_label_without_a_look() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        let marked = Saved { recipe: None, rating: 4, label: Some("green".into()), heart: true, ..Saved::default() };
        write(&img, &marked).unwrap();
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
        write(&img, &saved).unwrap();
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
        write(&img, &saved).unwrap();
        assert_eq!(read(&img), Some(saved));

        // Removing the last copy can remove the sidecar, never the image.
        write(&img, &Saved::default()).unwrap();
        assert!(!path_for(&img).exists());
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
