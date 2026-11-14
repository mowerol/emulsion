// SPDX-License-Identifier: GPL-3.0-or-later
//! The app's own data, kept in its data folder: custom looks, presets, camera profiles and
//! `settings.json` (what used to live in the webview's storage and matters beyond this session:
//! per-camera default profiles, favourites, collections). Photos' edits and history live in the catalog, with optional portable sidecars; this module
//! protects the catalog and the rest of the app data, the way darktable protects its
//! `data.db`: a snapshot on the first launch of each day under `backups/<date>/` (the last 15 kept)
//! plus one before each version upgrade (darktable's `data.db-pre-<version>`), an archive to move
//! everything to another computer, and a restore that merges a snapshot or archive back in.
//!
//! Snapshot layout = data layout: `backups/<name>/{looks,presets,settings.json,library.db}`.
//! Content-addressed files (LUTs) are hard-linked rather than copied; every writer replaces
//! files by renaming a temporary file over them, so a link never sees a later change.

use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// What a snapshot or archive holds, relative to the data folder.
pub const DIRS: [&str; 2] = ["looks", "presets"];
pub const SETTINGS: &str = "settings.json";
const BACKUPS: &str = "backups";
const VERSION_FILE: &str = "last-version";
/// Daily snapshots kept (darktable keeps 15 database snapshots).
pub const KEEP_DAILY: usize = 15;
/// Snapshots made before an upgrade or a restore, kept per kind.
const KEEP_EVENT: usize = 5;
/// Files an archive or snapshot may bring in.
const EXTENSIONS: [&str; 4] = ["json", "cube", "3dl", "png"];
/// An archive larger than this when unpacked is refused.
const MAX_ARCHIVE: u64 = 4 * 1024 * 1024 * 1024;
/// `settings.json` is small; anything larger is not ours.
const MAX_SETTINGS: u64 = 64 * 1024 * 1024;

// ---------------------------------------------------------------- settings

/// The saved settings, an object of keys to JSON values; `{}` when missing or unreadable.
pub fn read_settings(root: &Path) -> Value {
    fs::read(root.join(SETTINGS))
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| Value::Object(Map::new()))
}

pub fn write_settings(root: &Path, settings: &Value) -> Result<(), String> {
    if !settings.is_object() {
        return Err("Settings must be an object".into());
    }
    let bytes = serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_SETTINGS {
        return Err("Settings are too large".into());
    }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    write_atomic(&root.join(SETTINGS), &bytes).map_err(|e| e.to_string())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, bytes)?;
    fs::rename(&tmp, path)
}

// ---------------------------------------------------------------- snapshots

fn has_data(root: &Path) -> bool {
    root.join(SETTINGS).is_file() || root.join(crate::catalog::DB).is_file() || DIRS.iter().any(|d| fs::read_dir(root.join(d)).map(|mut r| r.next().is_some()).unwrap_or(false))
}

/// Content-addressed files never change once written, so snapshots share them.
fn immutable(rel: &Path) -> bool {
    rel.components().any(|c| c.as_os_str() == "luts")
}

fn allowed(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).map(|e| EXTENSIONS.contains(&e.to_ascii_lowercase().as_str())).unwrap_or(false)
}

/// Every regular file under `dir` (no symbolic links, no temporary files), relative to `dir`.
fn files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut stack = vec![PathBuf::new()];
    while let Some(rel) = stack.pop() {
        let Ok(entries) = fs::read_dir(dir.join(&rel)) else { continue };
        for e in entries.flatten() {
            let Ok(kind) = e.file_type() else { continue };
            let child = rel.join(e.file_name());
            if kind.is_dir() {
                stack.push(child);
            } else if kind.is_file() && allowed(&child) {
                out.push(child);
            }
        }
    }
    out.sort();
    out
}

/// Copy the data folder's looks, presets, profiles and settings into `dest` (which must not exist).
/// The copy is made beside it and renamed into place, so a snapshot is either whole or absent.
pub fn snapshot(root: &Path, dest: &Path) -> io::Result<()> {
    let parent = dest.parent().ok_or_else(|| io::Error::other("snapshot needs a parent folder"))?;
    fs::create_dir_all(parent)?;
    let mut partial = dest.as_os_str().to_owned();
    partial.push(".partial");
    let partial = PathBuf::from(partial);
    let _ = fs::remove_dir_all(&partial);
    fs::create_dir_all(&partial)?;
    for dir in DIRS {
        for rel in files(&root.join(dir)) {
            let (from, to) = (root.join(dir).join(&rel), partial.join(dir).join(&rel));
            fs::create_dir_all(to.parent().unwrap())?;
            if !(immutable(&rel) && fs::hard_link(&from, &to).is_ok()) {
                fs::copy(&from, &to)?;
            }
        }
    }
    if root.join(SETTINGS).is_file() {
        fs::copy(root.join(SETTINGS), partial.join(SETTINGS))?;
    }
    // The library catalog, copied consistently even while the app writes to it. Restoring
    // settings leaves it alone (only json and LUT files come back); Restore Catalog brings it back.
    crate::catalog::snapshot_file(&root.join(crate::catalog::DB), &partial.join(crate::catalog::DB))?;
    fs::rename(&partial, dest)
}

/// Days since 1970-01-01 → (year, month, day), proleptic Gregorian (Howard Hinnant's civil_from_days).
fn civil(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// Seconds since the epoch, shifted to local time (so day boundaries are the user's midnight).
fn local_secs() -> i64 {
    let utc = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    #[cfg(unix)]
    {
        let t = utc as libc::time_t;
        let mut tm = std::mem::MaybeUninit::<libc::tm>::zeroed();
        // SAFETY: localtime_r only writes the tm we own.
        if !unsafe { libc::localtime_r(&t, tm.as_mut_ptr()) }.is_null() {
            return utc + unsafe { tm.assume_init() }.tm_gmtoff as i64;
        }
    }
    utc
}

/// Today's local date as `YYYY-MM-DD`, the name of a daily snapshot.
pub fn today() -> String {
    let (y, m, d) = civil(local_secs().div_euclid(86_400));
    format!("{y:04}-{m:02}-{d:02}")
}

/// Local date and time to the minute, `YYYY-MM-DD HHMM` (Lightroom's backup folder names).
pub fn minute_stamp() -> String {
    let s = local_secs();
    format!("{} {:02}{:02}", today(), s.rem_euclid(86_400) / 3600, s.rem_euclid(3600) / 60)
}

fn stamp() -> String {
    let s = local_secs();
    format!("{}-{:02}{:02}{:02}", today(), s.rem_euclid(86_400) / 3600, s.rem_euclid(3600) / 60, s.rem_euclid(60))
}

fn is_daily(name: &str) -> bool {
    let b = name.as_bytes();
    b.len() == 10 && b.iter().enumerate().all(|(i, c)| if i == 4 || i == 7 { *c == b'-' } else { c.is_ascii_digit() })
}

/// Snapshot names in `backups/` with `prefix`, oldest first.
fn snapshots_with(backups: &Path, keep: impl Fn(&str) -> bool) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(backups)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|n| !n.ends_with(".partial") && keep(n))
        .collect();
    names.sort();
    names
}

fn prune(backups: &Path, keep: usize, matches: impl Fn(&str) -> bool) {
    let names = snapshots_with(backups, matches);
    for name in names.iter().take(names.len().saturating_sub(keep)) {
        let _ = fs::remove_dir_all(backups.join(name));
    }
}

/// Run at launch: a snapshot before a version upgrade (once per upgrade), and one per day.
/// Returns the snapshots made.
pub fn launch_snapshots(root: &Path, version: &str, date: &str) -> io::Result<Vec<String>> {
    let backups = root.join(BACKUPS);
    let mut made = Vec::new();
    let last = fs::read_to_string(backups.join(VERSION_FILE)).ok().map(|s| s.trim().to_owned());
    if !has_data(root) {
        return Ok(made);
    }
    if let Some(last) = last.filter(|l| l != version && !l.is_empty()) {
        let name = format!("before-{version}-from-{last}");
        if !backups.join(&name).exists() {
            snapshot(root, &backups.join(&name))?;
            made.push(name);
        }
        prune(&backups, KEEP_EVENT, |n| n.starts_with("before-") && !n.starts_with("before-restore-"));
    }
    if !backups.join(date).exists() {
        snapshot(root, &backups.join(date))?;
        made.push(date.to_owned());
    }
    prune(&backups, KEEP_DAILY, is_daily);
    fs::write(backups.join(VERSION_FILE), version)?;
    Ok(made)
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Snapshot {
    pub name: String,
    pub path: String,
}

/// Every snapshot, newest first.
pub fn list(root: &Path) -> Vec<Snapshot> {
    let backups = root.join(BACKUPS);
    let mut names = snapshots_with(&backups, |_| true);
    names.sort_by(|a, b| b.cmp(a));
    names.into_iter().map(|name| Snapshot { path: backups.join(&name).to_string_lossy().into_owned(), name }).collect()
}

pub fn backups_dir(root: &Path) -> PathBuf {
    root.join(BACKUPS)
}

// ---------------------------------------------------------------- restore

#[derive(Serialize, Debug, Default, PartialEq)]
pub struct Restored {
    pub files: usize,
    pub settings: usize,
    /// The snapshot of what was there before, so a restore can itself be undone.
    pub before: Option<String>,
}

/// Bring a snapshot or an unpacked archive (`from`, laid out like the data folder) back in.
/// Files are added or replaced, never deleted; settings are merged key by key, `from` winning.
/// What was there is snapshotted first.
pub fn restore(root: &Path, from: &Path) -> Result<Restored, String> {
    let incoming: Vec<(&str, PathBuf)> = DIRS.iter().flat_map(|d| files(&from.join(d)).into_iter().map(move |f| (*d, f))).collect();
    let settings = from.join(SETTINGS);
    let settings = if settings.is_file() {
        if fs::metadata(&settings).map(|m| m.len()).unwrap_or(0) > MAX_SETTINGS {
            return Err("The settings file in this backup is too large".into());
        }
        Some(
            serde_json::from_slice::<Value>(&fs::read(&settings).map_err(|e| e.to_string())?)
                .ok()
                .filter(Value::is_object)
                .ok_or("The settings file in this backup is damaged")?,
        )
    } else {
        None
    };
    if incoming.is_empty() && settings.is_none() {
        return Err("This folder holds no Emulsion looks, presets, profiles or settings".into());
    }
    let mut out = Restored::default();
    if has_data(root) {
        let name = format!("before-restore-{}", stamp());
        snapshot(root, &backups_dir(root).join(&name)).map_err(|e| format!("Could not back up the current settings first: {e}"))?;
        prune(&backups_dir(root), KEEP_EVENT, |n| n.starts_with("before-restore-"));
        out.before = Some(name);
    }
    for (dir, rel) in incoming {
        let to = root.join(dir).join(&rel);
        fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
        let bytes = fs::read(from.join(dir).join(&rel)).map_err(|e| e.to_string())?;
        write_atomic(&to, &bytes).map_err(|e| e.to_string())?;
        out.files += 1;
    }
    if let Some(Value::Object(theirs)) = settings {
        let mut ours = read_settings(root);
        let map = ours.as_object_mut().unwrap();
        out.settings = theirs.len();
        map.extend(theirs);
        write_settings(root, &ours)?;
    }
    Ok(out)
}

// ---------------------------------------------------------------- archives

const MARKER: &str = "emulsion-settings.json";

/// Write the looks, presets, camera profiles and settings into one zip file at `dest`.
pub fn export(root: &Path, dest: &Path, version: &str) -> Result<usize, String> {
    let mut tmp = dest.as_os_str().to_owned();
    tmp.push(".partial");
    let tmp = PathBuf::from(tmp);
    let result = (|| -> Result<usize, String> {
        let file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let opts = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let marker = serde_json::json!({ "format": "emulsion-settings", "version": 1, "app": version, "created": stamp() });
        zip.start_file(MARKER, opts).map_err(|e| e.to_string())?;
        zip.write_all(marker.to_string().as_bytes()).map_err(|e| e.to_string())?;
        let mut count = 0;
        let mut add = |zip: &mut zip::ZipWriter<fs::File>, name: String, path: &Path| -> Result<(), String> {
            zip.start_file(name, opts).map_err(|e| e.to_string())?;
            io::copy(&mut fs::File::open(path).map_err(|e| e.to_string())?, zip).map_err(|e| e.to_string())?;
            count += 1;
            Ok(())
        };
        for dir in DIRS {
            for rel in files(&root.join(dir)) {
                let name = format!("{dir}/{}", rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"));
                add(&mut zip, name, &root.join(dir).join(&rel))?;
            }
        }
        if root.join(SETTINGS).is_file() {
            add(&mut zip, SETTINGS.into(), &root.join(SETTINGS))?;
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(count)
    })();
    match result {
        Ok(n) => fs::rename(&tmp, dest).map(|_| n).map_err(|e| e.to_string()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            Err(e)
        }
    }
}

/// Unpack an archive made by `export` into `into` (an empty folder), checking every name.
pub fn unpack(archive: &Path, into: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|_| "This is not an Emulsion settings file".to_string())?;
    if zip.by_name(MARKER).is_err() {
        return Err("This is not an Emulsion settings file".into());
    }
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() || entry.name() == MARKER {
            continue;
        }
        let Some(rel) = entry.enclosed_name() else { continue };
        let top = rel.components().next().map(|c| c.as_os_str().to_string_lossy().into_owned()).unwrap_or_default();
        if !(top == SETTINGS && rel.components().count() == 1 || DIRS.contains(&top.as_str())) || !allowed(&rel) {
            continue;
        }
        total += entry.size();
        if total > MAX_ARCHIVE {
            return Err("This settings file is too large".into());
        }
        let to = into.join(&rel);
        fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry.by_ref().take(MAX_ARCHIVE).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        fs::write(&to, bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn data(root: &Path) {
        fs::create_dir_all(root.join("looks/luts")).unwrap();
        fs::create_dir_all(root.join("presets")).unwrap();
        fs::write(root.join("looks/a.json"), r#"{"id":"a"}"#).unwrap();
        fs::write(root.join("looks/luts/abc.cube"), "LUT").unwrap();
        fs::write(root.join("presets/p.json"), r#"{"id":"p"}"#).unwrap();
        fs::write(root.join("presets/p.tmp"), "half written").unwrap();
        write_settings(root, &json!({ "emulsion.theme": "dark" })).unwrap();
    }

    #[test]
    fn dates() {
        assert_eq!(civil(0), (1970, 1, 1));
        assert_eq!(civil(20_759), (2026, 11, 02));
        assert_eq!(civil(11_016), (2000, 2, 29));
        assert!(is_daily("2026-11-02") && !is_daily("before-0.2.0-from-0.1.0") && !is_daily("2026-11-2"));
    }

    #[test]
    fn settings_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(read_settings(dir.path()), json!({}));
        write_settings(dir.path(), &json!({ "a": [1, 2] })).unwrap();
        assert_eq!(read_settings(dir.path()), json!({ "a": [1, 2] }));
        assert!(write_settings(dir.path(), &json!([1])).is_err());
        fs::write(dir.path().join(SETTINGS), "{ broken").unwrap();
        assert_eq!(read_settings(dir.path()), json!({}));
    }

    #[test]
    fn daily_snapshots_keep_fifteen_and_share_luts() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // Nothing to protect yet: no snapshot, no version recorded.
        assert!(launch_snapshots(root, "0.1.0", "2026-01-01").unwrap().is_empty());
        data(root);
        assert_eq!(launch_snapshots(root, "0.1.0", "2026-01-01").unwrap(), vec!["2026-01-01"]);
        // Once a day.
        assert!(launch_snapshots(root, "0.1.0", "2026-01-01").unwrap().is_empty());
        let snap = root.join("backups/2026-01-01");
        assert_eq!(fs::read_to_string(snap.join("looks/luts/abc.cube")).unwrap(), "LUT");
        assert!(snap.join("settings.json").is_file());
        assert!(!snap.join("presets/p.tmp").exists());
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            assert_eq!(fs::metadata(snap.join("looks/luts/abc.cube")).unwrap().ino(), fs::metadata(root.join("looks/luts/abc.cube")).unwrap().ino());
            assert_ne!(fs::metadata(snap.join("looks/a.json")).unwrap().ino(), fs::metadata(root.join("looks/a.json")).unwrap().ino());
        }
        for day in 2..=20 {
            launch_snapshots(root, "0.1.0", &format!("2026-01-{day:02}")).unwrap();
        }
        let daily = snapshots_with(&root.join("backups"), is_daily);
        assert_eq!(daily.len(), KEEP_DAILY);
        assert_eq!(daily[0], "2026-01-06");
        // An upgrade snapshots before the day's.
        assert_eq!(launch_snapshots(root, "0.2.0", "2026-01-21").unwrap(), vec!["before-0.2.0-from-0.1.0", "2026-01-21"]);
        assert_eq!(list(root)[0].name, "before-0.2.0-from-0.1.0");
    }

    #[test]
    fn restore_merges_and_backs_up_first() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        data(root);
        snapshot(root, &root.join("backups/2026-01-01")).unwrap();
        // Later: a look is deleted, another edited, a setting changed and one added.
        fs::remove_file(root.join("looks/a.json")).unwrap();
        fs::write(root.join("presets/p.json"), r#"{"id":"p","edited":true}"#).unwrap();
        fs::write(root.join("presets/q.json"), r#"{"id":"q"}"#).unwrap();
        write_settings(root, &json!({ "emulsion.theme": "light", "emulsion.lookBrowser": { "favourites": ["x"] } })).unwrap();

        let r = restore(root, &root.join("backups/2026-01-01")).unwrap();
        assert_eq!(r.files, 3);
        assert_eq!(r.settings, 1);
        assert_eq!(fs::read_to_string(root.join("looks/a.json")).unwrap(), r#"{"id":"a"}"#);
        assert_eq!(fs::read_to_string(root.join("presets/p.json")).unwrap(), r#"{"id":"p"}"#);
        assert!(root.join("presets/q.json").is_file(), "a restore never deletes");
        assert_eq!(read_settings(root), json!({ "emulsion.theme": "dark", "emulsion.lookBrowser": { "favourites": ["x"] } }));
        let before = root.join("backups").join(r.before.unwrap());
        assert!(before.join("presets/q.json").is_file() && !before.join("looks/a.json").exists());
        assert!(restore(root, &root.join("presets")).is_err());
    }

    #[test]
    fn archives_round_trip_and_refuse_strangers() {
        let dir = tempfile::tempdir().unwrap();
        let (a, b) = (dir.path().join("a"), dir.path().join("b"));
        data(&a);
        let archive = dir.path().join("mine.emulsion-settings");
        assert_eq!(export(&a, &archive, "0.1.0").unwrap(), 4);
        let unpacked = dir.path().join("unpacked");
        fs::create_dir_all(&unpacked).unwrap();
        unpack(&archive, &unpacked).unwrap();
        let r = restore(&b, &unpacked).unwrap();
        assert_eq!((r.files, r.settings, r.before), (3, 1, None));
        assert_eq!(fs::read_to_string(b.join("looks/luts/abc.cube")).unwrap(), "LUT");
        assert_eq!(read_settings(&b), read_settings(&a));

        // A zip that isn't ours, and names that would escape the folder, are refused or skipped.
        let other = dir.path().join("other.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&other).unwrap());
        let opts = zip::write::SimpleFileOptions::default();
        zip.start_file("looks/x.json", opts).unwrap();
        zip.write_all(b"{}").unwrap();
        zip.finish().unwrap();
        assert!(unpack(&other, &unpacked).is_err());
        let evil = dir.path().join("evil.zip");
        let mut zip = zip::ZipWriter::new(fs::File::create(&evil).unwrap());
        for name in [MARKER, "../escape.json", "looks/run.sh", "elsewhere/x.json"] {
            zip.start_file(name, opts).unwrap();
            zip.write_all(b"{}").unwrap();
        }
        zip.finish().unwrap();
        let into = dir.path().join("into");
        fs::create_dir_all(&into).unwrap();
        unpack(&evil, &into).unwrap();
        assert!(files(&into).is_empty() && !dir.path().join("escape.json").exists());
    }
}
