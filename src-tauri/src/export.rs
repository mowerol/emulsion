// SPDX-License-Identifier: GPL-3.0-or-later
//! Writing developed frames to disk. The GPU renders the final pixels; this
//! module encodes them and picks a file name that never overwrites anything.

use image::codecs::jpeg::JpegEncoder;
use image::RgbImage;
use std::fs;
use std::path::{Path, PathBuf};

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

pub fn write_jpeg(dir: &Path, stem: &str, rgba: &[u8], width: u32, height: u32, quality: u8) -> Result<PathBuf, String> {
    fs::create_dir_all(dir).map_err(|e| format!("Could not create {}: {e}", dir.display()))?;
    let bytes = encode_jpeg(rgba, width, height, quality)?;
    let path = unique_path(dir, &safe_stem(stem), "jpg");
    fs::write(&path, bytes).map_err(|e| format!("Could not write {}: {e}", path.display()))?;
    Ok(path)
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
        let path = write_jpeg(&dir.path().join("Minilab exports"), "frame", &rgba, 8, 4, 90).unwrap();
        let img = image::open(&path).unwrap();
        assert_eq!((img.width(), img.height()), (8, 4));
    }

    #[test]
    fn rejects_mismatched_buffers() {
        assert!(encode_jpeg(&[0; 10], 2, 2, 90).is_err());
        assert!(encode_jpeg(&[], 0, 0, 90).is_err());
    }
}
