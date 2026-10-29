// SPDX-License-Identifier: GPL-3.0-or-later
//! Sidecars: each edited photo gets `<file name>.emulsion.json` next to it.
//! Edits are never written into the photo itself.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SUFFIX: &str = ".emulsion.json";
const FORMAT: &str = "emulsion";
const VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct Sidecar {
    format: String,
    version: u32,
    /// Milliseconds since the Unix epoch.
    updated: u64,
    recipe: serde_json::Value,
}

pub fn path_for(image: &Path) -> PathBuf {
    let mut s = image.as_os_str().to_owned();
    s.push(SUFFIX);
    PathBuf::from(s)
}

/// The recipe saved for `image`, or `None` when there is no readable sidecar.
pub fn read(image: &Path) -> Option<serde_json::Value> {
    let text = fs::read_to_string(path_for(image)).ok()?;
    let car: Sidecar = serde_json::from_str(&text).ok()?;
    if car.format != FORMAT || car.recipe.is_null() {
        return None;
    }
    Some(car.recipe)
}

/// Save `recipe` for `image`. A `null` recipe removes the sidecar, returning the
/// photo to its original state. Writes go to a temporary file first and are
/// renamed into place so a crash never leaves a half-written sidecar.
pub fn write(image: &Path, recipe: &serde_json::Value) -> io::Result<()> {
    let target = path_for(image);
    if recipe.is_null() {
        return match fs::remove_file(&target) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        };
    }
    let updated = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let car = Sidecar { format: FORMAT.into(), version: VERSION, updated, recipe: recipe.clone() };
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

        let recipe = json!({ "stock": "gold200", "exposure": 0.5 });
        write(&img, &recipe).unwrap();
        assert_eq!(read(&img).unwrap(), recipe);
        assert!(!dir.path().join("a.jpg.emulsion.json.tmp").exists());

        write(&img, &serde_json::Value::Null).unwrap();
        assert!(read(&img).is_none());
        assert!(!path_for(&img).exists());
        // Removing again is not an error.
        write(&img, &serde_json::Value::Null).unwrap();
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
