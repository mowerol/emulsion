// SPDX-License-Identifier: GPL-3.0-or-later
//! Folder scanning: find the photos in a folder (and its subfolders) that
//! Emulsion can open, with any saved edits from their sidecars.

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::{DirEntry, WalkDir};

use crate::sidecar;

/// Formats decoded by the `image` crate today.
pub const RASTER_EXTS: &[&str] = &["jpg", "jpeg", "png", "tif", "tiff", "webp"];

/// Camera RAW formats, decoded by LibRaw (raw.rs).
pub const RAW_EXTS: &[&str] = &[
    "3fr", "arw", "cr2", "cr3", "crw", "dng", "erf", "iiq", "kdc", "mos", "mrw", "nef", "nrw",
    "orf", "ori", "pef", "raf", "rw2", "rwl", "sr2", "srf", "srw", "x3f",
];

/// Exports land in this subfolder by default, so scans skip it.
pub const EXPORT_DIR_NAME: &str = "Emulsion exports";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Raster,
    Raw,
    Other,
}

pub fn classify(path: &Path) -> Kind {
    let ext = match path.extension().and_then(|e| e.to_str()) {
        Some(e) => e.to_ascii_lowercase(),
        None => return Kind::Other,
    };
    if RASTER_EXTS.contains(&ext.as_str()) {
        Kind::Raster
    } else if RAW_EXTS.contains(&ext.as_str()) {
        Kind::Raw
    } else {
        Kind::Other
    }
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    /// Path relative to the scanned folder, with `/` separators.
    pub rel: String,
    pub name: String,
    pub size: u64,
    /// Modified time in milliseconds since the Unix epoch.
    pub modified: u64,
    /// The recipe saved in this photo's sidecar, if it has one.
    pub recipe: Option<serde_json::Value>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root: String,
    pub name: String,
    pub entries: Vec<Entry>,
    /// Directory entries that could not be read (permissions, broken links).
    pub unreadable: usize,
    /// When a file rather than a folder was opened, that file.
    pub focus: Option<String>,
}

fn is_hidden(entry: &DirEntry) -> bool {
    entry.file_name().to_str().map(|s| s.starts_with('.')).unwrap_or(false)
}

fn skip(entry: &DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    // Hidden files include macOS "._" resource forks on external drives.
    if is_hidden(entry) {
        return true;
    }
    entry.file_type().is_dir() && entry.file_name() == EXPORT_DIR_NAME
}

/// Scan `target`. If it is a file, its parent folder is scanned and the file is
/// returned as `focus`.
pub fn scan(target: &Path, recursive: bool) -> std::io::Result<ScanResult> {
    let (root, focus): (PathBuf, Option<String>) = if target.is_file() {
        let parent = target
            .parent()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "file has no parent folder"))?;
        (parent.to_path_buf(), Some(target.to_string_lossy().into_owned()))
    } else if target.is_dir() {
        (target.to_path_buf(), None)
    } else {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("{} is not a folder", target.display()),
        ));
    };

    let walker = WalkDir::new(&root)
        .follow_links(false)
        .max_depth(if recursive { usize::MAX } else { 1 });

    let mut entries = Vec::new();
    let mut unreadable = 0;

    for item in walker.into_iter().filter_entry(|e| !skip(e)) {
        let item = match item {
            Ok(i) => i,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        if !item.file_type().is_file() {
            continue;
        }
        if classify(item.path()) == Kind::Other {
            continue;
        }
        let meta = match item.metadata() {
            Ok(m) => m,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let rel = item
            .path()
            .strip_prefix(&root)
            .unwrap_or(item.path())
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect::<Vec<_>>()
            .join("/");
        entries.push(Entry {
            path: item.path().to_string_lossy().into_owned(),
            rel,
            name: item.file_name().to_string_lossy().into_owned(),
            size: meta.len(),
            modified,
            recipe: sidecar::read(item.path()),
        });
    }

    entries.sort_by(|a, b| natord::compare_ignore_case(&a.rel, &b.rel));

    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());

    Ok(ScanResult {
        root: root.to_string_lossy().into_owned(),
        name,
        entries,
        unreadable,
        focus,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn touch(p: &Path) {
        if let Some(d) = p.parent() {
            fs::create_dir_all(d).unwrap();
        }
        fs::write(p, b"x").unwrap();
    }

    #[test]
    fn classifies_extensions_case_insensitively() {
        assert_eq!(classify(Path::new("a/DSCF0001.JPG")), Kind::Raster);
        assert_eq!(classify(Path::new("a/scan.tiff")), Kind::Raster);
        assert_eq!(classify(Path::new("a/DSCF0001.RAF")), Kind::Raw);
        assert_eq!(classify(Path::new("a/P1010001.ORF")), Kind::Raw);
        assert_eq!(classify(Path::new("a/notes.txt")), Kind::Other);
        assert_eq!(classify(Path::new("a/IMG.JPG.emulsion.json")), Kind::Other);
        assert_eq!(classify(Path::new("a/noext")), Kind::Other);
    }

    #[test]
    fn scans_recursively_in_natural_order_and_skips_noise() {
        let dir = tempfile::tempdir().unwrap();
        let r = dir.path();
        touch(&r.join("IMG_10.jpg"));
        touch(&r.join("IMG_2.jpg"));
        touch(&r.join("img_1.JPG"));
        touch(&r.join("roll b/frame.tif"));
        touch(&r.join("DSCF0001.RAF"));
        touch(&r.join("._IMG_2.jpg"));
        touch(&r.join(".hidden/x.jpg"));
        touch(&r.join("Emulsion exports/IMG_2.jpg"));
        touch(&r.join("notes.txt"));

        let res = scan(r, true).unwrap();
        let rels: Vec<_> = res.entries.iter().map(|e| e.rel.as_str()).collect();
        assert_eq!(rels, vec!["DSCF0001.RAF", "img_1.JPG", "IMG_2.jpg", "IMG_10.jpg", "roll b/frame.tif"]);
        assert!(res.focus.is_none());

        let flat = scan(r, false).unwrap();
        assert_eq!(flat.entries.len(), 4);
    }

    #[test]
    fn opening_a_file_scans_its_folder_and_focuses_it() {
        let dir = tempfile::tempdir().unwrap();
        touch(&dir.path().join("a.jpg"));
        touch(&dir.path().join("b.jpg"));
        let res = scan(&dir.path().join("b.jpg"), true).unwrap();
        assert_eq!(res.entries.len(), 2);
        assert!(res.focus.unwrap().ends_with("b.jpg"));
    }

    #[test]
    fn reads_sidecars_during_scan() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.jpg");
        touch(&img);
        sidecar::write(&img, &serde_json::json!({ "stock": "portra400" })).unwrap();
        let res = scan(dir.path(), true).unwrap();
        assert_eq!(res.entries.len(), 1, "sidecar must not appear as a photo");
        assert_eq!(res.entries[0].recipe.as_ref().unwrap()["stock"], "portra400");
    }

    #[test]
    fn missing_folder_is_an_error() {
        assert!(scan(Path::new("/definitely/not/here"), true).is_err());
    }
}
