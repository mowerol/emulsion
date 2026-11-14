// SPDX-License-Identifier: GPL-3.0-or-later
//! Folder scanning: find the photos in a folder (and its subfolders) that
//! Emulsion can open, with any saved edits from their sidecars. Stars, labels, keywords and
//! IPTC fields come from the photo's XMP sidecar instead when it changed after Emulsion's last
//! save (another app wrote it; `xmp.rs`).

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::{DirEntry, WalkDir};

use crate::{sidecar, xmp};

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
    /// Stars, 0 to 5, colour tag and cull flag (`pick` or `reject`), from the sidecar.
    pub rating: u8,
    pub label: Option<String>,
    pub flag: Option<String>,
    /// Keywords and IPTC fields.
    pub meta: xmp::Meta,
    /// A camera RAW, as opposed to an ordinary image.
    pub raw: bool,
    pub copies: Vec<sidecar::VirtualCopy>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub root: String,
    pub name: String,
    pub entries: Vec<Entry>,
    /// Directory entries that could not be read (permissions, broken links).
    pub unreadable: usize,
    /// When a file rather than a folder was opened, that file.
    pub focus: Option<String>,
    pub folders: Vec<FolderEntry>,
}

#[derive(Serialize, Debug)]
pub struct ScanProgress {
    #[serde(flatten)]
    pub batch: ScanResult,
    pub total: usize,
}

#[derive(Serialize, Debug, Clone)]
pub struct FolderEntry {
    pub path: String,
    pub name: String,
}

/// Directory navigation is independent of photo scanning and sidecar reads.
pub fn directories(root: &Path) -> std::io::Result<Vec<FolderEntry>> {
    let mut folders = Vec::new();
    for item in std::fs::read_dir(root)? {
        let Ok(item) = item else { continue };
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == EXPORT_DIR_NAME || !item.path().is_dir() { continue; }
        folders.push(FolderEntry { path: item.path().to_string_lossy().into_owned(), name });
    }
    folders.sort_by(|a, b| natord::compare_ignore_case(&a.name, &b.name));
    Ok(folders)
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

/// File identities only: no sidecars, EXIF, thumbnails or image decoding.
#[derive(Serialize, Debug)]
pub struct DiskEntry {
    pub path: String,
    pub modified: u64,
}
#[derive(Serialize, Debug)]
pub struct DiskListing {
    pub entries: Vec<DiskEntry>,
    pub folders: Vec<FolderEntry>,
    pub unreadable: usize,
}
pub fn list_photos(root: &Path, recursive: bool) -> std::io::Result<DiskListing> {
    // Fail an unavailable root instead of treating an unplugged drive as empty.
    std::fs::read_dir(root)?;
    let mut listing = DiskListing { entries: Vec::new(), folders: Vec::new(), unreadable: 0 };
    for item in WalkDir::new(root).follow_links(false)
        .max_depth(if recursive { usize::MAX } else { 1 }).into_iter().filter_entry(|e| !skip(e)) {
        let item = match item { Ok(item) => item, Err(_) => { listing.unreadable += 1; continue; } };
        if item.depth() > 0 && item.file_type().is_dir() {
            listing.folders.push(FolderEntry { path: item.path().to_string_lossy().into_owned(), name: item.file_name().to_string_lossy().into_owned() });
        }
        if !item.file_type().is_file() || classify(item.path()) == Kind::Other { continue; }
        match item.metadata() {
            Ok(meta) => listing.entries.push(DiskEntry {
                path: item.path().to_string_lossy().into_owned(),
                modified: meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64).unwrap_or(0),
            }),
            Err(_) => listing.unreadable += 1,
        }
    }
    listing.entries.sort_by(|a, b| natord::compare_ignore_case(&a.path, &b.path));
    Ok(listing)
}

/// Scan `target`. If it is a file, its parent folder is scanned and the file is
/// returned as `focus`.
#[cfg(test)]
pub fn scan(target: &Path, recursive: bool) -> std::io::Result<ScanResult> {
    scan_with_progress(target, recursive, None)
}

/// Discover and sort file identities first, then read sidecars in bounded batches. The first
/// screenful can start loading thumbnails while the rest of a slow drive is still being read.
#[cfg(test)]
pub fn scan_with_progress(target: &Path, recursive: bool, progress: Option<&mut dyn FnMut(ScanProgress)>) -> std::io::Result<ScanResult> {
    scan_with_reader(target, recursive, progress, &mut |path, owner| Ok(with_newer_xmp(sidecar::read_synced(path), xmp::read_sidecar(path, owner))))
}

pub fn scan_with_reader(target: &Path, recursive: bool, mut progress: Option<&mut dyn FnMut(ScanProgress)>, read: &mut dyn FnMut(&Path, bool) -> std::io::Result<sidecar::Saved>) -> std::io::Result<ScanResult> {
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

    let mut entries: Vec<Entry> = Vec::new();
    let mut folders = Vec::new();
    let mut unreadable = 0;

    for item in walker.into_iter().filter_entry(|e| !skip(e)) {
        let item = match item {
            Ok(i) => i,
            Err(_) => {
                unreadable += 1;
                continue;
            }
        };
        if item.file_type().is_dir() && item.depth() == 1 {
            folders.push(FolderEntry {
                path: item.path().to_string_lossy().into_owned(),
                name: item.file_name().to_string_lossy().into_owned(),
            });
        }
        if !item.file_type().is_file() {
            continue;
        }
        let kind = classify(item.path());
        if kind == Kind::Other {
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
            recipe: None,
            rating: 0,
            label: None,
            flag: None,
            meta: xmp::Meta::default(),
            raw: kind == Kind::Raw,
            copies: Vec::new(),
        });
    }

    entries.sort_by(|a, b| natord::compare_ignore_case(&a.rel, &b.rel));
    folders.sort_by(|a, b| natord::compare_ignore_case(&a.name, &b.name));
    // Only siblings with the same stem can claim an XMP. Comparing every photo to its whole
    // folder made this quadratic (millions of path/stem comparisons in a large shoot).
    let mut by_stem: std::collections::HashMap<(PathBuf, Option<String>), Vec<PathBuf>> = std::collections::HashMap::new();
    for e in &entries {
        let p = PathBuf::from(&e.path);
        let key = (p.parent().map(Path::to_path_buf).unwrap_or_default(), xmp::stem_key(&p));
        by_stem.entry(key).or_default().push(p);
    }

    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| root.to_string_lossy().into_owned());

    let mut result = ScanResult {
        root: root.to_string_lossy().into_owned(),
        name,
        entries,
        unreadable,
        focus,
        folders,
    };
    let total = result.entries.len();
    // A small first batch gets content on screen; subsequent batches amortize IPC and renders.
    let mut start = 0;
    while start < total {
        let end = (start + if start == 0 { 24 } else { 256 }).min(total);
        for e in &mut result.entries[start..end] {
            let path = PathBuf::from(&e.path);
            let key = (path.parent().map(Path::to_path_buf).unwrap_or_default(), xmp::stem_key(&path));
            let owner = xmp::owns(&path, by_stem[&key].iter().map(PathBuf::as_path));
            let saved = read(&path, owner)?;
            e.recipe = saved.recipe;
            e.rating = saved.rating;
            e.label = saved.label;
            e.flag = saved.flag;
            e.meta = saved.meta;
            e.copies = saved.copies;
        }
        if let Some(send) = progress.as_mut() {
            send(ScanProgress { batch: ScanResult {
                entries: result.entries[start..end].to_vec(),
                root: result.root.clone(), name: result.name.clone(), unreadable,
                focus: result.focus.clone(), folders: result.folders.clone(),
            }, total });
        }
        start = end;
    }
    Ok(result)
}

/// Whether an XMP sidecar says something newer than Emulsion's own sidecar: it changed since
/// Emulsion last wrote it, or (never written by Emulsion) it is newer than the last save.
/// What a photo's sidecar says, with a newer XMP's stars, label, keywords and fields over it
/// (another app changed them since Emulsion's last save).
pub fn with_newer_xmp(saved: Option<(sidecar::Saved, sidecar::Sync)>, found: Option<xmp::Found>) -> sidecar::Saved {
    let (mut saved, sync) = saved.map_or((sidecar::Saved::default(), None), |(s, y)| (s, Some(y)));
    if let Some(found) = found {
        if xmp_is_newer(&found, sync) {
            // A reject (Rating -1) carries no stars: the sidecar's stay. A pick has no
            // XMP field and stays too, unless the other app rejected the photo.
            if found.values.reject {
                saved.flag = Some("reject".into());
            } else {
                saved.rating = found.values.rating;
                if saved.flag.as_deref() == Some("reject") {
                    saved.flag = None;
                }
            }
            saved.label = found.values.label;
            saved.meta = found.values.meta;
        }
    }
    saved
}

fn xmp_is_newer(found: &xmp::Found, sync: Option<sidecar::Sync>) -> bool {
    match sync {
        None => true,
        Some(sidecar::Sync { xmp: Some(t), .. }) if found.own => found.mtime != t,
        Some(sidecar::Sync { updated, .. }) => found.mtime > updated,
    }
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
        assert_eq!(flat.folders.len(), 1);
        assert_eq!(flat.folders[0].name, "roll b");
        assert_eq!(flat.folders[0].path, r.join("roll b").to_string_lossy());
    }

    #[test]
    fn cheap_listing_uses_file_identities_and_skips_hidden_exports_and_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        touch(&root.join("a.ORF"));
        touch(&root.join("nested/b.jpg"));
        touch(&root.join("nested/deep/c.jpg"));
        touch(&root.join(".hidden/x.jpg"));
        touch(&root.join("._a.ORF"));
        touch(&root.join("Emulsion exports/a.jpg"));
        touch(&root.join("notes.txt"));
        let flat = list_photos(root, false).unwrap();
        assert_eq!(flat.entries.len(), 1);
        assert!(flat.entries[0].path.ends_with("a.ORF"));
        assert!(flat.entries[0].modified > 0);
        let recursive = list_photos(root, true).unwrap();
        assert_eq!(recursive.entries.len(), 3);
        assert_eq!(recursive.folders.len(), 2);
        assert_eq!(recursive.unreadable, 0);
        assert!(list_photos(&root.join("disconnected"), true).is_err());
        #[cfg(unix)] {
            std::os::unix::fs::symlink(root.join("nested"), root.join("linked")).unwrap();
            std::os::unix::fs::symlink(root.join("a.ORF"), root.join("linked.ORF")).unwrap();
            assert_eq!(list_photos(root, true).unwrap().entries.len(), 3);
        }
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
        let look = sidecar::Saved { recipe: Some(serde_json::json!({ "stock": "portra400" })), rating: 3, label: None, flag: None, meta: xmp::Meta::default(),
            copies: vec![sidecar::VirtualCopy { id: "one".into(), name: "Warm".into(), recipe: None, rating: 5, label: None, flag: None, heart: false }] };
        sidecar::write(&img, &look, false).unwrap();
        let res = scan(dir.path(), true).unwrap();
        assert_eq!(res.entries.len(), 1, "sidecar must not appear as a photo");
        assert_eq!(res.entries[0].recipe.as_ref().unwrap()["stock"], "portra400");
        assert_eq!(res.entries[0].rating, 3);
        assert_eq!(res.entries[0].copies, look.copies);
        assert!(!res.entries[0].raw);
    }

    #[test]
    fn a_newer_xmp_from_another_app_wins_and_emulsions_own_write_does_not() {
        let dir = tempfile::tempdir().unwrap();
        let raw = dir.path().join("X.RAF");
        let jpg = dir.path().join("X.JPG");
        touch(&raw);
        touch(&jpg);
        // Emulsion rates the RAW: its XMP gets the stars, the JPEG twin none.
        let saved = sidecar::Saved { rating: 2, flag: Some("pick".into()), ..Default::default() };
        sidecar::write(&raw, &saved, false).unwrap();
        sidecar::write(&jpg, &sidecar::Saved { rating: 1, ..Default::default() }, false).unwrap();
        let rated = |res: &ScanResult, name: &str| res.entries.iter().find(|e| e.name == name).map(|e| (e.rating, e.flag.is_some(), e.meta.keywords.clone())).unwrap();
        let res = scan(dir.path(), false).unwrap();
        assert_eq!(rated(&res, "X.RAF"), (2, true, vec![]));
        assert_eq!(rated(&res, "X.JPG"), (1, false, vec![]));
        // Another app rewrites the XMP: its stars and keywords come in, the pick stays.
        std::thread::sleep(std::time::Duration::from_millis(20));
        let text = std::fs::read_to_string(dir.path().join("X.xmp")).unwrap();
        let text = text.replace("<xmp:Rating>2</xmp:Rating>", "<xmp:Rating>5</xmp:Rating>").replace("<rdf:Description rdf:about=\"\"", "<rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"");
        let text = text.replace("</rdf:Description>", "<dc:subject><rdf:Bag><rdf:li>Sea</rdf:li></rdf:Bag></dc:subject></rdf:Description>");
        assert!(text.contains("<xmp:Rating>5<"), "{text}");
        std::fs::write(dir.path().join("X.xmp"), text).unwrap();
        let res = scan(dir.path(), false).unwrap();
        assert_eq!(rated(&res, "X.RAF"), (5, true, vec!["Sea".to_string()]));
        assert_eq!(rated(&res, "X.JPG"), (1, false, vec![]));
    }

    #[test]
    fn another_apps_reject_keeps_the_stars_and_its_unreject_clears_the_flag() {
        let dir = tempfile::tempdir().unwrap();
        let raw = dir.path().join("R.NEF");
        touch(&raw);
        sidecar::write(&raw, &sidecar::Saved { rating: 4, ..Default::default() }, false).unwrap();
        let xmp_path = dir.path().join("R.xmp");
        let flagged = |res: &ScanResult| (res.entries[0].rating, res.entries[0].flag.clone());
        std::thread::sleep(std::time::Duration::from_millis(20));
        let text = std::fs::read_to_string(&xmp_path).unwrap();
        std::fs::write(&xmp_path, text.replace("<xmp:Rating>4</xmp:Rating>", "<xmp:Rating>-1</xmp:Rating>")).unwrap();
        assert_eq!(flagged(&scan(dir.path(), false).unwrap()), (4, Some("reject".into())));
        // Saved as rejected, then the other app gives it two stars.
        sidecar::write(&raw, &sidecar::Saved { rating: 4, flag: Some("reject".into()), ..Default::default() }, false).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let text = std::fs::read_to_string(&xmp_path).unwrap();
        assert!(text.contains("<xmp:Rating>-1<"), "{text}");
        std::fs::write(&xmp_path, text.replace("<xmp:Rating>-1</xmp:Rating>", "<xmp:Rating>2</xmp:Rating>")).unwrap();
        assert_eq!(flagged(&scan(dir.path(), false).unwrap()), (2, None));
    }

    #[test]
    fn an_xmp_older_than_emulsions_edits_is_not_taken() {
        let dir = tempfile::tempdir().unwrap();
        let img = dir.path().join("a.CR3");
        touch(&img);
        std::fs::write(dir.path().join("a.xmp"), r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:Rating="1"/></rdf:RDF></x:xmpmeta>"#).unwrap();
        // A sidecar from before XMP support, saved after the XMP was written.
        let later = xmp::mtime_ms(&dir.path().join("a.xmp")).unwrap() + 1000;
        std::fs::write(sidecar::path_for(&img), format!(r#"{{"format":"emulsion","version":2,"updated":{later},"recipe":null,"rating":4}}"#)).unwrap();
        assert_eq!(scan(dir.path(), false).unwrap().entries[0].rating, 4);
        // With no sidecar of Emulsion's, the XMP is all there is.
        std::fs::remove_file(sidecar::path_for(&img)).unwrap();
        assert_eq!(scan(dir.path(), false).unwrap().entries[0].rating, 1);
    }

    #[test]
    fn missing_folder_is_an_error() {
        assert!(scan(Path::new("/definitely/not/here"), true).is_err());
    }

    #[test]
    #[ignore = "manual folder scan timing"]
    fn scan_timing() {
        // Optional real-folder measurement is read-only; the default fixture is synthetic.
        let requested = std::env::var_os("EMULSION_SCAN_FOLDER").map(PathBuf::from);
        let dir = tempfile::tempdir().unwrap();
        if requested.is_none() {
            for i in 0..2000 { touch(&dir.path().join(format!("IMG_{i}.RAF"))); }
        }
        let started = std::time::Instant::now();
        let mut first = None;
        let res = scan_with_progress(requested.as_deref().unwrap_or(dir.path()), false, Some(&mut |_| {
            if first.is_none() { first = Some(started.elapsed()); }
        })).unwrap();
        println!("scan: {} photos, first={:?}, complete={:?}", res.entries.len(), first, started.elapsed());
    }

    #[test]
    fn streams_complete_sidecars_before_reading_the_rest_and_keeps_xmp_ownership_across_batches() {
        let dir = tempfile::tempdir().unwrap();
        for i in 0..23 { touch(&dir.path().join(format!("A_{i}.jpg"))); }
        for name in ["X.DNG", "X.RAF", "Z.jpg"] { touch(&dir.path().join(name)); }
        sidecar::write(&dir.path().join("A_0.jpg"), &sidecar::Saved { rating: 3, ..Default::default() }, false).unwrap();
        sidecar::write(&dir.path().join("X.RAF"), &sidecar::Saved { rating: 4, ..Default::default() }, false).unwrap();
        let mut batches = Vec::new();
        let result = scan_with_progress(dir.path(), false, Some(&mut |progress| {
            assert_eq!(progress.total, 26);
            if batches.is_empty() {
                assert_eq!(progress.batch.entries.len(), 24);
                assert_eq!(progress.batch.entries[0].rating, 3);
                assert_eq!(progress.batch.entries[23].name, "X.DNG");
                assert_eq!(progress.batch.entries[23].rating, 0, "the RAF in the next batch owns X.xmp");
                // Changing a later sidecar here proves it hasn't been read before the first batch.
                sidecar::write(&dir.path().join("Z.jpg"), &sidecar::Saved { rating: 5, ..Default::default() }, false).unwrap();
            }
            batches.push(progress.batch.entries);
        })).unwrap();
        assert_eq!(batches.len(), 2);
        assert_eq!(result.entries[24].rating, 4);
        assert_eq!(result.entries[25].rating, 5);
        assert_eq!(serde_json::to_value(batches.into_iter().flatten().collect::<Vec<_>>()).unwrap(), serde_json::to_value(result.entries).unwrap());
    }

    #[test]
    fn browsing_directories_lists_only_visible_immediate_folders_in_natural_order() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["Roll 10", "Roll 2", ".hidden", EXPORT_DIR_NAME] {
            fs::create_dir(dir.path().join(name)).unwrap();
        }
        touch(&dir.path().join("frame.jpg"));
        fs::create_dir(dir.path().join("Roll 2/nested")).unwrap();
        let folders = directories(dir.path()).unwrap();
        assert_eq!(folders.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["Roll 2", "Roll 10"]);
        assert!(directories(&dir.path().join("missing")).is_err());
    }
}
