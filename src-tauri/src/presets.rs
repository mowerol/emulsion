// SPDX-License-Identifier: GPL-3.0-or-later
use std::{fs, path::Path};
use serde_json::Value;
fn valid_id(id: &str) -> bool {
    id.len() == 36 && id.bytes().enumerate().all(|(i,b)| if [8,13,18,23].contains(&i) { b == b'-' } else { b.is_ascii_digit() || (b'a'..=b'f').contains(&b) })
}
pub fn list(root: &Path) -> Vec<Value> {
    fs::read_dir(root).into_iter().flatten().flatten().filter_map(|e| {
        let path = e.path();
        if path.extension()?.to_str()? != "json" { return None; }
        let value: Value = serde_json::from_slice(&fs::read(&path).ok()?).ok()?;
        (path.file_stem()?.to_str()? == value.get("id")?.as_str()?).then_some(value)
    }).collect()
}
pub fn save(root: &Path, preset: Value) -> Result<(), String> {
    let id = preset["id"].as_str().filter(|id| valid_id(id)).ok_or("Invalid preset ID")?;
    let name = preset["name"].as_str().ok_or("A preset needs a name")?;
    if name.trim().is_empty() || name.len() > 200 || preset["version"] != 1 || !preset["recipe"].is_object() || !preset["groups"].is_array() { return Err("Invalid preset".into()); }
    let bytes = serde_json::to_vec(&preset).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 { return Err("Preset is too large".into()); }
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let tmp = root.join(format!("{id}.tmp"));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(tmp, root.join(format!("{id}.json"))).map_err(|e| e.to_string())
}
pub fn delete(root: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) { return Err("Invalid preset ID".into()); }
    fs::remove_file(root.join(format!("{id}.json"))).map_err(|e| e.to_string())
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn persistence_and_validation() {
        let dir = tempfile::tempdir().unwrap();
        let id = "00000000-0000-4000-8000-000000000000";
        let p = serde_json::json!({"id": id, "version": 1, "name": "Warm", "groups": ["Tone"], "recipe": {}});
        save(dir.path(), p.clone()).unwrap();
        assert_eq!(list(dir.path()), vec![p]);
        assert!(delete(dir.path(), "../outside").is_err());
        delete(dir.path(), id).unwrap();
        assert!(list(dir.path()).is_empty());
    }
}
