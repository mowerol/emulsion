// SPDX-License-Identifier: GPL-3.0-or-later
//! Rebuildable, bounded Remove patches. Cache hits need neither model nor runtime.
use crate::inpaint::{MODEL_SHA256, PIXELS};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const HEADER: &[u8; 8] = b"EMREMOV1";
const RECORD_SIZE: usize = 8 + 32 + PIXELS * 4;
pub const DISK_LIMIT: u64 = 512 * 1024 * 1024;

pub fn validate_key(key: &str) -> Result<(), String> {
    if key.len() != 28
        || !key
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("Invalid Remove patch key".into());
    }
    Ok(())
}

pub struct Cache {
    root: PathBuf,
    limit: u64,
}

impl Cache {
    pub fn new(root: &Path, limit: u64) -> Self {
        Self {
            root: root.join(MODEL_SHA256),
            limit,
        }
    }

    fn path(&self, key: &str) -> Result<PathBuf, String> {
        validate_key(key)?;
        Ok(self.root.join(format!("{key}.patch")))
    }

    pub fn get(&self, key: &str) -> Result<Option<Vec<u8>>, String> {
        let path = self.path(key)?;
        // Check length before allocating, then validate integrity before returning pixels.
        if !path.metadata().is_ok_and(|m| m.len() == RECORD_SIZE as u64) {
            return Ok(None);
        }
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() != RECORD_SIZE
            || &bytes[..8] != HEADER
            || bytes[8..40] != *blake3::hash(&bytes[40..]).as_bytes()
        {
            let _ = fs::remove_file(path);
            return Ok(None);
        }
        let _ = fs::File::open(path).and_then(|f| f.set_modified(SystemTime::now()));
        Ok(Some(bytes[40..].to_vec()))
    }

    pub fn put(&self, key: &str, pixels: &[u8]) -> Result<(), String> {
        let path = self.path(key)?;
        if pixels.len() != PIXELS * 4 {
            return Err("Invalid Remove patch size".into());
        }
        if RECORD_SIZE as u64 > self.limit {
            return Ok(());
        }
        fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let part = path.with_extension("part");
        let result = (|| {
            let mut f = fs::File::create(&part).map_err(|e| e.to_string())?;
            f.write_all(HEADER)
                .and_then(|_| f.write_all(blake3::hash(pixels).as_bytes()))
                .and_then(|_| f.write_all(pixels))
                .and_then(|_| f.flush())
                .map_err(|e| e.to_string())?;
            fs::rename(&part, &path).map_err(|e| e.to_string())?;
            self.trim(key)
        })();
        if result.is_err() {
            let _ = fs::remove_file(part);
        }
        result
    }

    fn trim(&self, keep: &str) -> Result<(), String> {
        let mut entries = Vec::new();
        for entry in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path.extension().is_none_or(|e| e != "patch") {
                continue;
            }
            let meta = entry.metadata().map_err(|e| e.to_string())?;
            entries.push((path, meta.len(), meta.modified().unwrap_or(UNIX_EPOCH)));
        }
        entries.sort_by_key(|e| e.2);
        let mut total: u64 = entries.iter().map(|e| e.1).sum();
        for (path, size, _) in entries {
            if total <= self.limit {
                break;
            }
            if path.file_stem().is_some_and(|s| s == keep) {
                continue;
            }
            fs::remove_file(path).map_err(|e| e.to_string())?;
            total = total.saturating_sub(size);
        }
        Ok(())
    }
}

/// The caller serializes jobs; a hit skips the supplied inference closure entirely.
pub fn resolve(
    cache: &Cache,
    key: &str,
    infer: impl FnOnce() -> Result<Vec<u8>, String>,
) -> Result<Vec<u8>, String> {
    if let Some(pixels) = cache.get(key)? {
        return Ok(pixels);
    }
    let pixels = infer()?;
    if let Err(e) = cache.put(key, &pixels) {
        eprintln!("[remove] patch cache: {e}");
    }
    Ok(pixels)
}

#[cfg(test)]
mod tests {
    use super::*;
    const A: &str = "000000000000000000000000000a";
    const B: &str = "000000000000000000000000000b";
    const C: &str = "000000000000000000000000000c";

    #[test]
    fn hits_survive_restart_and_skip_inference() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path(), DISK_LIMIT);
        let pixels = vec![81; PIXELS * 4];
        assert_eq!(resolve(&cache, A, || Ok(pixels.clone())).unwrap(), pixels);
        let reopened = Cache::new(dir.path(), DISK_LIMIT);
        assert_eq!(
            resolve(&reopened, A, || panic!(
                "must not load a model on a cache hit"
            ))
            .unwrap(),
            pixels
        );
    }

    #[test]
    fn lru_evicts_at_limit_and_hits_refresh_usage() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path(), RECORD_SIZE as u64 * 2);
        let pixels = vec![15; PIXELS * 4];
        cache.put(A, &pixels).unwrap();
        cache.put(B, &pixels).unwrap();
        fs::File::open(cache.path(A).unwrap())
            .unwrap()
            .set_modified(UNIX_EPOCH)
            .unwrap();
        fs::File::open(cache.path(B).unwrap())
            .unwrap()
            .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1))
            .unwrap();
        cache.get(A).unwrap();
        cache.put(C, &pixels).unwrap();
        assert!(cache.get(A).unwrap().is_some());
        assert!(cache.get(B).unwrap().is_none());
        assert!(cache.get(C).unwrap().is_some());
    }

    #[test]
    fn corrupt_truncated_and_oversized_entries_are_misses() {
        let dir = tempfile::tempdir().unwrap();
        let cache = Cache::new(dir.path(), DISK_LIMIT);
        cache.put(A, &vec![0; PIXELS * 4]).unwrap();
        let path = cache.path(A).unwrap();
        let mut corrupted = fs::read(&path).unwrap();
        corrupted[41] = 1;
        fs::write(&path, corrupted).unwrap();
        assert!(cache.get(A).unwrap().is_none());
        fs::write(&path, b"short").unwrap();
        assert!(cache.get(A).unwrap().is_none());
        fs::File::create(&path)
            .unwrap()
            .set_len(RECORD_SIZE as u64 + 1)
            .unwrap();
        assert!(cache.get(A).unwrap().is_none());
        assert!(cache.put("../outside", &vec![0; PIXELS * 4]).is_err());
        assert!(cache.put(B, &[0]).is_err());
        let tiny = Cache::new(dir.path(), 1);
        tiny.put(B, &vec![0; PIXELS * 4]).unwrap();
        assert!(tiny.get(B).unwrap().is_none());
    }
}
