// SPDX-License-Identifier: GPL-3.0-or-later
//! User camera profiles, stored by content hash, independently of photo recipes.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub const MAX_PROFILE: usize = 16 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProfileEntry {
    pub id: String,
    pub name: String,
    pub camera: String,
    pub copyright: String,
}

fn checked_id(id: &str) -> Result<(), String> {
    if id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        Ok(())
    } else {
        Err("Invalid camera profile ID".into())
    }
}
pub fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size < 8 || size > MAX_PROFILE as u64 {
        return Err("Camera profile must be between 8 bytes and 16 MB".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() < 8 || bytes.len() > MAX_PROFILE {
        return Err("Camera profile must be between 8 bytes and 16 MB".into());
    }
    if !matches!(&bytes[..2], b"II" | b"MM") {
        return Err("Not a DCP camera profile".into());
    }
    Ok(bytes)
}
pub fn list(root: &Path) -> Vec<ProfileEntry> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for file in entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|e| e == "json"))
        {
            if let Ok(bytes) = fs::read(file) {
                if let Ok(entry) = serde_json::from_slice::<ProfileEntry>(&bytes) {
                    if checked_id(&entry.id).is_ok()
                        && root.join(format!("{}.dcp", entry.id)).is_file()
                    {
                        out.push(entry);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}
pub fn install(
    root: &Path,
    bytes: &[u8],
    name: String,
    camera: String,
    copyright: String,
) -> Result<ProfileEntry, String> {
    if bytes.len() < 8 || bytes.len() > MAX_PROFILE || !matches!(&bytes[..2], b"II" | b"MM") {
        return Err("Invalid DCP camera profile".into());
    }
    if name.is_empty()
        || name.len() > 512
        || camera.is_empty()
        || camera.len() > 512
        || copyright.len() > 8192
    {
        return Err("Invalid profile metadata".into());
    }
    let id = blake3::hash(bytes).to_hex().to_string();
    let entry = ProfileEntry {
        id: id.clone(),
        name,
        camera,
        copyright,
    };
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    // Identical imports reuse their content identity. Metadata can refine the display name/camera.
    fs::write(root.join(format!("{id}.dcp")), bytes).map_err(|e| e.to_string())?;
    fs::write(
        root.join(format!("{id}.json")),
        serde_json::to_vec(&entry).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(entry)
}
pub fn file(root: &Path, id: &str) -> Result<PathBuf, String> {
    checked_id(id)?;
    Ok(root.join(format!("{id}.dcp")))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn import_round_trip_and_path_rejection() {
        let root = tempfile::tempdir().unwrap();
        let bytes = b"II*\0\x08\0\0\0";
        let a = install(
            root.path(),
            bytes,
            "Camera Standard".into(),
            "Camera A".into(),
            "Author".into(),
        )
        .unwrap();
        assert_eq!(list(root.path()).len(), 1);
        assert_eq!(
            read_file(&file(root.path(), &a.id).unwrap()).unwrap(),
            bytes
        );
        assert!(file(root.path(), "../outside").is_err());
        let b = install(
            root.path(),
            bytes,
            "Renamed".into(),
            "Camera A".into(),
            "Author".into(),
        )
        .unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(list(root.path()).len(), 1);
        assert!(install(root.path(), b"bad", "x".into(), "x".into(), "".into()).is_err());
    }
}
