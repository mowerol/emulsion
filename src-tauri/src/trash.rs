// SPDX-License-Identifier: GPL-3.0-or-later
//! Delete from Disk: photos and their sidecars go to the Trash, where Finder's Put Back can
//! restore them, as Lightroom Classic and darktable do. Nothing is ever removed outright.
//!
//! A photo takes with it its `.emulsion.json`, darktable's `<name>.<ext>.xmp`, and the
//! `<stem>.xmp` shared by its stem only when no other photo of that stem stays behind (deleting
//! the JPEG of a RAW+JPEG pair keeps the RAW's XMP).

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::{library, sidecar, xmp};

/// One photo's outcome. `error` is set when the photo itself could not be moved; its sidecars
/// are then left where they are.
#[derive(Debug, Serialize)]
pub struct Trashed {
    pub path: String,
    pub error: Option<String>,
}

/// The files that go with each photo, in the order they are moved (the photo first).
pub fn plan(paths: &[PathBuf]) -> Vec<Vec<PathBuf>> {
    let going: HashSet<&Path> = paths.iter().map(PathBuf::as_path).collect();
    let mut claimed = HashSet::new();
    paths
        .iter()
        .map(|photo| {
            let mut files = vec![photo.clone()];
            files.extend([sidecar::path_for(photo), darktable_path(photo)].into_iter().filter(|p| p.exists()));
            if let Some(stem) = stem_xmp(photo, &going) {
                if claimed.insert(stem.clone()) {
                    files.push(stem);
                }
            }
            files
        })
        .collect()
}

fn darktable_path(image: &Path) -> PathBuf {
    let mut s = image.as_os_str().to_owned();
    s.push(".xmp");
    PathBuf::from(s)
}

/// `<stem>.xmp` beside `photo`, when it exists and every photo file of that stem is going.
fn stem_xmp(photo: &Path, going: &HashSet<&Path>) -> Option<PathBuf> {
    let dir = photo.parent()?;
    let key = xmp::stem_key(photo)?;
    let mut xmp = None;
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if xmp::stem_key(&path).as_ref() != Some(&key) {
            continue;
        }
        if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("xmp")) {
            xmp = Some(path);
        } else if library::classify(&path) != library::Kind::Other && !going.contains(path.as_path()) {
            return None;
        }
    }
    xmp
}

/// Move each photo and its sidecars to the Trash. A photo already gone from disk counts as moved.
pub fn trash_photos(paths: &[PathBuf]) -> Vec<Trashed> {
    plan(paths)
        .into_iter()
        .map(|files| {
            let photo = &files[0];
            let error = if photo.exists() { move_to_trash(photo).err() } else { None };
            if error.is_none() {
                for file in &files[1..] {
                    // A sidecar left behind is harmless; the photo is what was asked for.
                    if let Err(e) = move_to_trash(file) {
                        eprintln!("Could not move {} to the Trash: {e}", file.display());
                    }
                }
            }
            Trashed { path: photo.to_string_lossy().into_owned(), error }
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn move_to_trash(path: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|e| e.localizedDescription().to_string())
}

#[cfg(not(target_os = "macos"))]
fn move_to_trash(_path: &Path) -> Result<(), String> {
    Err("Moving photos to the Trash is only available on macOS.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(dir: &Path, name: &str) -> PathBuf {
        let p = dir.join(name);
        fs::write(&p, b"x").unwrap();
        p
    }

    #[test]
    fn a_photo_takes_its_own_sidecars() {
        let dir = tempfile::tempdir().unwrap();
        let jpg = touch(dir.path(), "a.jpg");
        let json = touch(dir.path(), "a.jpg.emulsion.json");
        let dt = touch(dir.path(), "a.jpg.xmp");
        let xmp = touch(dir.path(), "a.xmp");
        touch(dir.path(), "b.jpg.emulsion.json");
        assert_eq!(plan(&[jpg.clone()]), vec![vec![jpg, json, dt, xmp]]);
    }

    #[test]
    fn the_shared_xmp_stays_while_another_photo_of_its_stem_does() {
        let dir = tempfile::tempdir().unwrap();
        let raf = touch(dir.path(), "DSCF1.RAF");
        let jpg = touch(dir.path(), "DSCF1.JPG");
        let xmp = touch(dir.path(), "DSCF1.xmp");
        assert_eq!(plan(&[jpg.clone()]), vec![vec![jpg.clone()]]);
        assert_eq!(plan(&[raf.clone()]), vec![vec![raf.clone()]]);
        // Both go: the XMP goes once, with the first.
        assert_eq!(plan(&[raf.clone(), jpg.clone()]), vec![vec![raf, xmp], vec![jpg]]);
    }

    #[test]
    fn a_missing_photo_counts_as_moved_and_its_sidecars_still_go() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone.jpg");
        let json = touch(dir.path(), "gone.jpg.emulsion.json");
        assert_eq!(plan(&[gone.clone()]), vec![vec![gone, json]]);
    }

    /// Puts a scratch file in the real Trash, so it only runs when asked.
    #[test]
    #[ignore]
    #[cfg(target_os = "macos")]
    fn moves_files_to_the_trash() {
        let dir = tempfile::tempdir().unwrap();
        let jpg = touch(dir.path(), "emulsion-trash-test.jpg");
        let json = touch(dir.path(), "emulsion-trash-test.jpg.emulsion.json");
        let done = trash_photos(&[jpg.clone()]);
        assert!(done[0].error.is_none(), "{:?}", done[0].error);
        assert!(!jpg.exists() && !json.exists());
    }
}
