// SPDX-License-Identifier: GPL-3.0-or-later
//! Writing developed frames to disk. The GPU renders the final pixels; this
//! module encodes them and picks a file name that never overwrites anything.
//! A frame is written in full under a hidden name, then moved to its own, so a crash or a full
//! disk never leaves a half-written JPEG behind.

use image::codecs::jpeg::JpegEncoder;
use image::RgbImage;
use serde::Serialize;
use std::fs;
use std::io::{self, ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// Why a frame was not written. `stop` means the destination itself failed (full, read-only,
/// gone, not allowed), so the frames after it would fail the same way.
#[derive(Debug, Serialize)]
pub struct WriteError {
    pub message: String,
    pub stop: bool,
}

impl From<String> for WriteError {
    fn from(message: String) -> Self {
        WriteError { message, stop: false }
    }
}

fn io_error(what: &str, path: &Path, e: &io::Error) -> WriteError {
    let (reason, stop) = match e.kind() {
        ErrorKind::StorageFull | ErrorKind::QuotaExceeded => ("the disk is full".to_string(), true),
        ErrorKind::ReadOnlyFilesystem => ("the disk is read-only".to_string(), true),
        ErrorKind::PermissionDenied => ("Emulsion is not allowed to write there".to_string(), true),
        ErrorKind::NotFound => ("the folder is no longer there".to_string(), true),
        _ => (e.to_string(), false),
    };
    WriteError { message: format!("Could not {what} {}: {reason}", path.display()), stop }
}

/// `<dir>/<stem>.<ext>`, or `<stem>-2.<ext>`, `<stem>-3.<ext>`... if taken.
pub fn unique_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.{ext}"));
    if !first.exists() {
        return first;
    }
    (2..)
        .map(|n| dir.join(format!("{stem}-{n}.{ext}")))
        .find(|p| !p.exists())
        .expect("an unused file name")
}

/// Strip characters that are unsafe in file names on any platform.
pub fn safe_stem(stem: &str) -> String {
    let cleaned: String = stem
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    if trimmed.is_empty() { "frame".into() } else { trimmed.into() }
}

pub fn encode_jpeg(rgba: &[u8], width: u32, height: u32, quality: u8) -> Result<Vec<u8>, String> {
    let expected = width as usize * height as usize * 4;
    if width == 0 || height == 0 || rgba.len() != expected {
        return Err(format!("Expected {expected} bytes for a {width}x{height} frame, got {}", rgba.len()));
    }
    let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
    let img = RgbImage::from_raw(width, height, rgb).ok_or("Frame size does not match its pixels")?;
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, quality.clamp(1, 100))
        .encode_image(&img)
        .map_err(|e| format!("Could not encode JPEG: {e}"))?;
    Ok(out)
}

/// Make the export folder and check a file can be written in it, before any frame is developed.
pub fn check_dir(dir: &Path) -> Result<(), WriteError> {
    fs::create_dir_all(dir).map_err(|e| io_error("create", dir, &e))?;
    let probe = temp_path(dir, "write-check");
    let written = fs::File::create_new(&probe).and_then(|mut f| f.write_all(b"emulsion"));
    let _ = fs::remove_file(&probe);
    written.map_err(|e| io_error("write to", dir, &e))
}

fn temp_path(dir: &Path, stem: &str) -> PathBuf {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let n = NEXT.fetch_add(1, Ordering::Relaxed);
    dir.join(format!(".{stem}.emulsion-{}-{n}.partial", std::process::id()))
}

/// Write `bytes` as `<stem>.<ext>` (or the next free `-N` name) without overwriting anything,
/// even a file that appears meanwhile: the name is claimed with an exclusive create, then the
/// finished temporary file is renamed over that claim.
pub fn write_new(dir: &Path, stem: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf, WriteError> {
    let tmp = temp_path(dir, stem);
    let written = fs::File::create_new(&tmp).and_then(|mut f| {
        f.write_all(bytes)?;
        f.sync_all()
    });
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(io_error("write", &tmp.with_file_name(format!("{stem}.{ext}")), &e));
    }
    let mut path = unique_path(dir, stem, ext);
    let claimed = loop {
        match fs::File::create_new(&path) {
            Ok(_) => break Ok(()),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => path = unique_path(dir, stem, ext),
            Err(e) => break Err(e),
        }
    };
    if let Err(e) = claimed.and_then(|_| fs::rename(&tmp, &path)) {
        let _ = fs::remove_file(&tmp);
        // Only an empty claim of ours, never someone else's file.
        if fs::metadata(&path).map(|m| m.len() == 0).unwrap_or(false) {
            let _ = fs::remove_file(&path);
        }
        return Err(io_error("write", &path, &e));
    }
    Ok(path)
}

pub fn write_jpeg(dir: &Path, stem: &str, rgba: &[u8], width: u32, height: u32, quality: u8) -> Result<PathBuf, WriteError> {
    fs::create_dir_all(dir).map_err(|e| io_error("create", dir, &e))?;
    let bytes = encode_jpeg(rgba, width, height, quality)?;
    write_new(dir, &safe_stem(stem), "jpg", &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn never_overwrites() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        assert_eq!(unique_path(d, "a", "jpg"), d.join("a.jpg"));
        fs::write(d.join("a.jpg"), b"").unwrap();
        assert_eq!(unique_path(d, "a", "jpg"), d.join("a-2.jpg"));
        fs::write(d.join("a-2.jpg"), b"").unwrap();
        assert_eq!(unique_path(d, "a", "jpg"), d.join("a-3.jpg"));
    }

    #[test]
    fn cleans_stems() {
        assert_eq!(safe_stem("DSCF0001"), "DSCF0001");
        assert_eq!(safe_stem("a/b:c"), "a_b_c");
        assert_eq!(safe_stem(" .. "), "frame");
    }

    #[test]
    fn writes_a_valid_jpeg() {
        let dir = tempfile::tempdir().unwrap();
        let rgba: Vec<u8> = (0..(8 * 4)).flat_map(|i| [(i * 7) as u8, 100, 200, 255]).collect();
        let path = write_jpeg(&dir.path().join("Emulsion exports"), "frame", &rgba, 8, 4, 90).unwrap();
        let img = image::open(&path).unwrap();
        assert_eq!((img.width(), img.height()), (8, 4));
    }

    #[test]
    fn writes_leave_no_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path();
        fs::write(d.join("a.jpg"), b"theirs").unwrap();
        check_dir(d).unwrap();
        assert_eq!(write_new(d, "a", "jpg", b"ours").unwrap(), d.join("a-2.jpg"));
        assert_eq!(fs::read(d.join("a.jpg")).unwrap(), b"theirs");
        assert_eq!(fs::read(d.join("a-2.jpg")).unwrap(), b"ours");
        let mut names: Vec<_> = fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name()).collect();
        names.sort();
        assert_eq!(names, ["a-2.jpg", "a.jpg"]);
    }

    #[cfg(unix)]
    #[test]
    fn a_read_only_folder_stops_the_export() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let d = dir.path().join("locked");
        fs::create_dir(&d).unwrap();
        fs::set_permissions(&d, fs::Permissions::from_mode(0o555)).unwrap();
        let checked = check_dir(&d);
        let written = write_new(&d, "a", "jpg", b"x");
        fs::set_permissions(&d, fs::Permissions::from_mode(0o755)).unwrap();
        // Root can write anywhere, so there is nothing to check there.
        if checked.is_ok() { return; }
        assert!(checked.unwrap_err().stop);
        assert!(written.unwrap_err().stop);
    }

    #[test]
    fn rejects_mismatched_buffers() {
        assert!(encode_jpeg(&[0; 10], 2, 2, 90).is_err());
        assert!(encode_jpeg(&[], 0, 0, 90).is_err());
    }
}
