// SPDX-License-Identifier: GPL-3.0-or-later
//! Thumbnail cache. Thumbnails are small oriented JPEGs of the original photo,
//! keyed by path, size and modified time so edits to the file invalidate them.

use image::codecs::jpeg::JpegEncoder;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::decode;

/// Bump when the thumbnail recipe changes, to invalidate old cache entries.
const VERSION: u32 = 1;
const QUALITY: u8 = 85;

pub fn cache_key(path: &Path, size: u64, modified_ms: u64, max_edge: u32) -> String {
    let id = format!("{VERSION}|{}|{size}|{modified_ms}|{max_edge}", path.to_string_lossy());
    blake3::hash(id.as_bytes()).to_hex()[..32].to_string()
}

fn cache_file(cache_dir: &Path, key: &str) -> PathBuf {
    cache_dir.join(&key[..2]).join(format!("{key}.jpg"))
}

/// JPEG bytes for a thumbnail of `path`, from the cache when possible.
pub fn get_or_create(cache_dir: &Path, path: &Path, max_edge: u32) -> Result<Vec<u8>, String> {
    let meta = fs::metadata(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let file = cache_file(cache_dir, &cache_key(path, meta.len(), modified, max_edge));
    if let Ok(bytes) = fs::read(&file) {
        return Ok(bytes);
    }

    let img = decode::open_oriented(path)?;
    let thumb = img.thumbnail(max_edge, max_edge).to_rgb8();
    let mut bytes = Vec::new();
    JpegEncoder::new_with_quality(&mut bytes, QUALITY)
        .encode_image(&thumb)
        .map_err(|e| format!("Could not encode thumbnail: {e}"))?;

    // A failed cache write only costs a re-decode next time.
    if let Some(parent) = file.parent()
        && fs::create_dir_all(parent).is_ok()
    {
        let _ = fs::write(&file, &bytes);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgb};

    #[test]
    fn key_changes_with_file_identity() {
        let p = Path::new("/a/b.jpg");
        let k = cache_key(p, 10, 1, 512);
        assert_eq!(k.len(), 32);
        assert_eq!(k, cache_key(p, 10, 1, 512));
        assert_ne!(k, cache_key(p, 11, 1, 512));
        assert_ne!(k, cache_key(p, 10, 2, 512));
        assert_ne!(k, cache_key(p, 10, 1, 256));
    }

    #[test]
    fn creates_then_reuses_cached_thumbnail() {
        let dir = tempfile::tempdir().unwrap();
        let cache = dir.path().join("cache");
        let img = dir.path().join("photo.png");
        ImageBuffer::from_fn(1200, 800, |x, _| Rgb([(x % 255) as u8, 90, 160])).save(&img).unwrap();

        let a = get_or_create(&cache, &img, 256).unwrap();
        let decoded = image::load_from_memory(&a).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (256, 171));

        let cached: Vec<_> = walkdir::WalkDir::new(&cache).into_iter().filter_map(|e| e.ok()).filter(|e| e.file_type().is_file()).collect();
        assert_eq!(cached.len(), 1);
        let b = get_or_create(&cache, &img, 256).unwrap();
        assert_eq!(a, b);
    }
}
