// SPDX-License-Identifier: GPL-3.0-or-later
//! My looks: creative profiles kept in the app's data folder, by content hash, independently of
//! photo recipes. Either an imported LUT (.cube, .3dl or Hald PNG) or a saved profile: hidden
//! settings as JSON, which the webview validates and applies (src/film/creative.ts). A recipe names a
//! look by its hash, so a sidecar keeps working wherever the same look is installed.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};

/// A 4096 × 4096 16-bit Hald is about 100 MB raw; real files are compressed well under this.
pub const MAX_LOOK: usize = 64 * 1024 * 1024;
/// A saved profile's settings are a few kilobytes.
pub const MAX_SETTINGS: usize = 256 * 1024;
const EXTENSIONS: [&str; 3] = ["cube", "3dl", "png"];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LookEntry {
    pub id: String,
    pub name: String,
    /// An imported LUT's format: cube, 3dl or png. None for a saved profile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ext: Option<String>,
    /// A saved profile's hidden settings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub settings: Option<serde_json::Value>,
}

fn checked_id(id: &str) -> Result<(), String> {
    if id.len() == 64 && id.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) {
        Ok(())
    } else {
        Err("Invalid look ID".into())
    }
}

fn checked_ext(ext: &str) -> Result<(), String> {
    if EXTENSIONS.contains(&ext) {
        Ok(())
    } else {
        Err("Looks must be .cube, .3dl or Hald .png files".into())
    }
}

fn checked_size(len: u64) -> Result<(), String> {
    if len < 8 || len > MAX_LOOK as u64 {
        Err("A look file must be between 8 bytes and 64 MB".into())
    } else {
        Ok(())
    }
}

/// A LUT file chosen by the user, read so the webview can check it parses before installing it.
pub fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    checked_ext(&ext)?;
    checked_size(fs::metadata(path).map_err(|e| e.to_string())?.len())?;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    checked_size(bytes.len() as u64)?;
    Ok(bytes)
}

fn entry(root: &Path, id: &str) -> Result<LookEntry, String> {
    checked_id(id)?;
    let bytes = fs::read(root.join(format!("{id}.json"))).map_err(|_| "This look is not installed".to_string())?;
    let entry: LookEntry = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    match (&entry.ext, &entry.settings) {
        (Some(ext), None) => checked_ext(ext)?,
        (None, Some(_)) => {}
        _ => return Err("This look's record is damaged".into()),
    }
    if entry.id != id {
        return Err("This look's record is damaged".into());
    }
    Ok(entry)
}

/// An imported LUT's file; None for a saved profile.
fn file(root: &Path, entry: &LookEntry) -> Option<PathBuf> {
    entry.ext.as_ref().map(|ext| root.join(format!("{}.{ext}", entry.id)))
}

pub fn list(root: &Path) -> Vec<LookEntry> {
    let mut out: Vec<LookEntry> = fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .filter_map(|p| entry(root, p.file_stem()?.to_str()?).ok())
        .filter(|e| file(root, e).is_none_or(|f| f.is_file()))
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// An installed look's file.
pub fn read(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    let entry = entry(root, id)?;
    let path = file(root, &entry).ok_or("A saved profile has no LUT file")?;
    fs::read(path).map_err(|e| e.to_string())
}

/// Install a look; importing the same file again keeps its identity and takes the new name.
pub fn install(root: &Path, bytes: &[u8], name: String, ext: String) -> Result<LookEntry, String> {
    checked_size(bytes.len() as u64)?;
    checked_ext(&ext)?;
    let entry = LookEntry { id: blake3::hash(bytes).to_hex().to_string(), name: checked_name(name)?, ext: Some(ext), settings: None };
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    write_atomic(&file(root, &entry).unwrap(), bytes)?;
    write_entry(root, &entry)?;
    Ok(entry)
}

/// Save a profile's hidden settings; the same settings again keep their identity and take the new name.
pub fn save_profile(root: &Path, name: String, settings: serde_json::Value) -> Result<LookEntry, String> {
    if !settings.is_object() {
        return Err("A profile's settings must be an object".into());
    }
    let bytes = serde_json::to_vec(&settings).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_SETTINGS {
        return Err("A profile's settings are too large".into());
    }
    let entry = LookEntry { id: blake3::hash(&bytes).to_hex().to_string(), name: checked_name(name)?, ext: None, settings: Some(settings) };
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    write_entry(root, &entry)?;
    Ok(entry)
}

fn checked_name(name: String) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 200 {
        return Err("A look needs a name of up to 200 characters".into());
    }
    Ok(name)
}

fn write_entry(root: &Path, entry: &LookEntry) -> Result<(), String> {
    write_atomic(&root.join(format!("{}.json", entry.id)), &serde_json::to_vec(entry).map_err(|e| e.to_string())?)
}

pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    let entry = entry(root, id)?;
    fs::remove_file(root.join(format!("{id}.json"))).map_err(|e| e.to_string())?;
    if let Some(path) = file(root, &entry) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const CUBE: &[u8] = b"LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";

    #[test]
    fn install_list_read_delete() {
        let root = tempfile::tempdir().unwrap();
        let a = install(root.path(), CUBE, "Warm".into(), "cube".into()).unwrap();
        assert_eq!(list(root.path()), vec![a.clone()]);
        assert_eq!(read(root.path(), &a.id).unwrap(), CUBE);
        // The same file again keeps its identity and takes the new name.
        let b = install(root.path(), CUBE, "Warmer".into(), "cube".into()).unwrap();
        assert_eq!(a.id, b.id);
        assert_eq!(list(root.path())[0].name, "Warmer");
        assert!(!root.path().join(format!("{}.tmp", a.id)).exists());
        delete(root.path(), &a.id).unwrap();
        assert!(list(root.path()).is_empty());
        assert!(read(root.path(), &a.id).is_err());
    }

    #[test]
    fn saves_profiles_without_a_file() {
        let root = tempfile::tempdir().unwrap();
        let settings = serde_json::json!({ "colorBalance": { "contrast": 0.2 }, "look": { "pack": "t3mujinpack", "stock": "portra400" } });
        let p = save_profile(root.path(), "Moody".into(), settings.clone()).unwrap();
        assert_eq!(p.ext, None);
        assert_eq!(list(root.path()), vec![p.clone()]);
        assert_eq!(list(root.path())[0].settings, Some(settings.clone()));
        assert!(read(root.path(), &p.id).is_err());
        assert_eq!(save_profile(root.path(), "Moodier".into(), settings).unwrap().id, p.id);
        assert!(save_profile(root.path(), "x".into(), serde_json::json!([1])).is_err());
        delete(root.path(), &p.id).unwrap();
        assert!(list(root.path()).is_empty());
    }

    #[test]
    fn rejects_bad_input() {
        let root = tempfile::tempdir().unwrap();
        assert!(install(root.path(), CUBE, "x".into(), "exe".into()).is_err());
        assert!(install(root.path(), CUBE, "  ".into(), "cube".into()).is_err());
        assert!(install(root.path(), b"tiny", "x".into(), "cube".into()).is_err());
        assert!(read(root.path(), "../outside").is_err());
        assert!(delete(root.path(), &"A".repeat(64)).is_err());
        let path = root.path().join("look.txt");
        fs::write(&path, CUBE).unwrap();
        assert!(read_file(&path).is_err());
        let cube = root.path().join("Look.CUBE");
        fs::write(&cube, CUBE).unwrap();
        assert_eq!(read_file(&cube).unwrap(), CUBE);
    }
}
