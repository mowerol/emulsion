// SPDX-License-Identifier: GPL-3.0-or-later
//! Custom looks, kept in the app's data folder independently of photo recipes. A look is a name,
//! hidden settings (JSON the webview validates and applies: src/film/creative.ts) and optionally a
//! LUT file of the user's own. Looks have permanent ids, so editing one keeps every photo that uses
//! it; LUT files are stored once by content hash under `luts/` and shared between looks.
//!
//! Layout: `<root>/<id>.json` per look, `<root>/luts/<blake3>.<ext>` per LUT file. Looks saved before
//! this layout (`<hash>.json` with an `ext`, or with `settings` only) are migrated on listing.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

/// A 4096 × 4096 16-bit Hald is about 100 MB raw; real files are compressed well under this.
pub const MAX_LUT: usize = 64 * 1024 * 1024;
/// A look's settings are a few kilobytes.
pub const MAX_SETTINGS: usize = 256 * 1024;
const EXTENSIONS: [&str; 3] = ["cube", "3dl", "png"];
const VERSION: u32 = 2;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CustomLook {
    pub version: u32,
    pub id: String,
    pub name: String,
    /// The look's hidden settings, as the webview writes them.
    pub settings: serde_json::Value,
    /// The content hash of the user's own LUT file the look uses, if any (kept so files in use are
    /// never removed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub lut: Option<String>,
}

/// The first layout: one record per imported LUT (`ext`) or saved profile (`settings`).
#[derive(Deserialize)]
struct OldEntry {
    id: String,
    name: String,
    ext: Option<String>,
    settings: Option<serde_json::Value>,
}

/// A look id: a UUID (new looks) or a 64-digit hash (looks from the first layout), lower case.
fn checked_id(id: &str) -> Result<(), String> {
    let hex = |b: u8| b.is_ascii_digit() || (b'a'..=b'f').contains(&b);
    let hash = id.len() == 64 && id.bytes().all(hex);
    let uuid = id.len() == 36
        && id.bytes().enumerate().all(|(i, b)| if [8, 13, 18, 23].contains(&i) { b == b'-' } else { hex(b) });
    if hash || uuid {
        Ok(())
    } else {
        Err("Invalid look ID".into())
    }
}

fn checked_hash(hash: &str) -> Result<(), String> {
    if hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        Ok(())
    } else {
        Err("Invalid LUT ID".into())
    }
}

fn checked_ext(ext: &str) -> Result<(), String> {
    if EXTENSIONS.contains(&ext) {
        Ok(())
    } else {
        Err("LUTs must be .cube, .3dl or Hald .png files".into())
    }
}

fn checked_size(len: u64) -> Result<(), String> {
    if len < 8 || len > MAX_LUT as u64 {
        Err("A LUT file must be between 8 bytes and 64 MB".into())
    } else {
        Ok(())
    }
}

fn checked_name(name: &str) -> Result<String, String> {
    let name = name.trim().to_string();
    if name.is_empty() || name.len() > 200 {
        return Err("A look needs a name of up to 200 characters".into());
    }
    Ok(name)
}

fn luts(root: &Path) -> PathBuf {
    root.join("luts")
}

/// The stored file for a LUT hash, whatever its format.
fn lut_path(root: &Path, hash: &str) -> Option<PathBuf> {
    EXTENSIONS.iter().map(|ext| luts(root).join(format!("{hash}.{ext}"))).find(|p| p.is_file())
}

/// A LUT file chosen by the user, read so the webview can check it parses before storing it.
pub fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let ext = path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    checked_ext(&ext)?;
    checked_size(fs::metadata(path).map_err(|e| e.to_string())?.len())?;
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    checked_size(bytes.len() as u64)?;
    Ok(bytes)
}

/// Keep a LUT file; the same file again keeps its hash. Returns the hash.
pub fn store_lut(root: &Path, bytes: &[u8], ext: &str) -> Result<String, String> {
    checked_size(bytes.len() as u64)?;
    checked_ext(ext)?;
    let hash = blake3::hash(bytes).to_hex().to_string();
    if lut_path(root, &hash).is_none() {
        fs::create_dir_all(luts(root)).map_err(|e| e.to_string())?;
        write_atomic(&luts(root).join(format!("{hash}.{ext}")), bytes)?;
    }
    Ok(hash)
}

pub fn read_lut(root: &Path, hash: &str) -> Result<Vec<u8>, String> {
    checked_hash(hash)?;
    let path = lut_path(root, hash).ok_or("This look's LUT file is not installed")?;
    fs::read(path).map_err(|e| e.to_string())
}

/// Create or replace a look.
pub fn save(root: &Path, look: CustomLook) -> Result<CustomLook, String> {
    checked_id(&look.id)?;
    if !look.settings.is_object() {
        return Err("A look's settings must be an object".into());
    }
    if serde_json::to_vec(&look.settings).map_err(|e| e.to_string())?.len() > MAX_SETTINGS {
        return Err("A look's settings are too large".into());
    }
    if let Some(hash) = &look.lut {
        checked_hash(hash)?;
        if lut_path(root, hash).is_none() {
            return Err("This look's LUT file is not installed".into());
        }
    }
    let look = CustomLook { version: VERSION, name: checked_name(&look.name)?, ..look };
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    write_atomic(&root.join(format!("{}.json", look.id)), &serde_json::to_vec(&look).map_err(|e| e.to_string())?)?;
    Ok(look)
}

fn read_look(path: &Path) -> Option<CustomLook> {
    let look: CustomLook = serde_json::from_slice(&fs::read(path).ok()?).ok()?;
    let stem = path.file_stem()?.to_str()?;
    (look.version == VERSION && look.id == stem && checked_id(stem).is_ok()).then_some(look)
}

/// Every look, by name. Records from the first layout are migrated first.
pub fn list(root: &Path) -> Vec<CustomLook> {
    migrate(root);
    let mut out: Vec<CustomLook> = json_files(root).filter_map(|p| read_look(&p)).collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Remove a look, and any of the user's LUT files no remaining look uses.
pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    checked_id(id)?;
    fs::remove_file(root.join(format!("{id}.json"))).map_err(|_| "This look is not installed".to_string())?;
    let used: HashSet<String> = list(root).into_iter().filter_map(|l| l.lut).collect();
    for path in fs::read_dir(luts(root)).into_iter().flatten().flatten().map(|e| e.path()) {
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or_default().to_string();
        if !used.contains(&stem) {
            let _ = fs::remove_file(path);
        }
    }
    Ok(())
}

fn json_files(root: &Path) -> impl Iterator<Item = PathBuf> {
    fs::read_dir(root)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
}

/// Rewrite first-layout records as looks: an imported LUT becomes a look using that file (its id
/// stays the hash, so photos keep it); a saved profile keeps its settings.
fn migrate(root: &Path) {
    for path in json_files(root).collect::<Vec<_>>() {
        if read_look(&path).is_some() {
            continue;
        }
        let Some(old) = fs::read(&path).ok().and_then(|b| serde_json::from_slice::<OldEntry>(&b).ok()) else { continue };
        if checked_id(&old.id).is_err() || path.file_stem().and_then(|s| s.to_str()) != Some(old.id.as_str()) {
            continue;
        }
        let look = match (old.ext, old.settings) {
            (Some(ext), None) if checked_ext(&ext).is_ok() => {
                let file = root.join(format!("{}.{ext}", old.id));
                if fs::create_dir_all(luts(root)).is_err() || fs::rename(&file, luts(root).join(format!("{}.{ext}", old.id))).is_err() {
                    continue;
                }
                CustomLook {
                    version: VERSION,
                    lut: Some(old.id.clone()),
                    settings: serde_json::json!({ "lut": { "kind": "file", "hash": old.id, "amount": 1 } }),
                    id: old.id,
                    name: old.name,
                }
            }
            (None, Some(settings)) => CustomLook { version: VERSION, lut: None, settings, id: old.id, name: old.name },
            _ => continue,
        };
        if let Ok(bytes) = serde_json::to_vec(&look) {
            let _ = write_atomic(&path, &bytes);
        }
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const CUBE: &[u8] = b"LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";
    const ID: &str = "0f4b2c1a-7d3e-4a91-9b2f-5c6d8e0a1b23";

    fn look(id: &str, lut: Option<String>) -> CustomLook {
        CustomLook { version: VERSION, id: id.into(), name: "Warm".into(), settings: json!({ "curve": null }), lut }
    }

    #[test]
    fn saves_edits_and_deletes_looks_keeping_shared_files() {
        let root = tempfile::tempdir().unwrap();
        let hash = store_lut(root.path(), CUBE, "cube").unwrap();
        assert_eq!(store_lut(root.path(), CUBE, "cube").unwrap(), hash);
        assert_eq!(read_lut(root.path(), &hash).unwrap(), CUBE);
        let a = save(root.path(), look(ID, Some(hash.clone()))).unwrap();
        let b = save(root.path(), look(&"a".repeat(64), Some(hash.clone()))).unwrap();
        assert_eq!(list(root.path()).len(), 2);
        // Editing keeps the id.
        save(root.path(), CustomLook { name: "Warmer".into(), ..a.clone() }).unwrap();
        assert!(list(root.path()).iter().any(|l| l.id == ID && l.name == "Warmer"));
        // A file stays while any look uses it.
        delete(root.path(), &a.id).unwrap();
        assert!(read_lut(root.path(), &hash).is_ok());
        delete(root.path(), &b.id).unwrap();
        assert!(read_lut(root.path(), &hash).is_err());
        assert!(list(root.path()).is_empty());
    }

    #[test]
    fn migrates_the_first_layout() {
        let root = tempfile::tempdir().unwrap();
        let hash = blake3::hash(CUBE).to_hex().to_string();
        fs::write(root.path().join(format!("{hash}.cube")), CUBE).unwrap();
        fs::write(root.path().join(format!("{hash}.json")), json!({ "id": hash, "name": "Imported", "ext": "cube" }).to_string()).unwrap();
        let profile = "b".repeat(64);
        let settings = json!({ "colorBalance": { "contrast": 0.2 }, "look": { "pack": "t3mujinpack", "stock": "portra400", "amount": 0.7 } });
        fs::write(root.path().join(format!("{profile}.json")), json!({ "id": profile, "name": "Moody", "settings": settings }).to_string()).unwrap();
        let looks = list(root.path());
        assert_eq!(looks.len(), 2);
        let imported = looks.iter().find(|l| l.id == hash).unwrap();
        assert_eq!(imported.lut.as_deref(), Some(hash.as_str()));
        assert_eq!(imported.settings["lut"]["hash"], json!(hash));
        assert_eq!(read_lut(root.path(), &hash).unwrap(), CUBE);
        assert_eq!(looks.iter().find(|l| l.id == profile).unwrap().settings, settings);
        // Idempotent.
        assert_eq!(list(root.path()), looks);
    }

    #[test]
    fn rejects_bad_input() {
        let root = tempfile::tempdir().unwrap();
        assert!(store_lut(root.path(), CUBE, "exe").is_err());
        assert!(store_lut(root.path(), b"tiny", "cube").is_err());
        assert!(save(root.path(), look("../outside", None)).is_err());
        assert!(save(root.path(), CustomLook { name: "  ".into(), ..look(ID, None) }).is_err());
        assert!(save(root.path(), CustomLook { settings: json!([1]), ..look(ID, None) }).is_err());
        assert!(save(root.path(), look(ID, Some("c".repeat(64)))).is_err());
        assert!(read_lut(root.path(), "../x").is_err());
        assert!(delete(root.path(), ID).is_err());
        let path = root.path().join("look.txt");
        fs::write(&path, CUBE).unwrap();
        assert!(read_file(&path).is_err());
        let cube = root.path().join("Look.CUBE");
        fs::write(&cube, CUBE).unwrap();
        assert_eq!(read_file(&cube).unwrap(), CUBE);
    }
}
