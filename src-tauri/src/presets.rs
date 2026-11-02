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
/// Presets in files chosen for import: one preset per file, or an array of them. Files over
/// 4 MB or that are not JSON are reported by name; checking each preset is left to the caller.
pub fn read_files(paths: &[String]) -> Result<Vec<Value>, String> {
    let mut out = Vec::new();
    for path in paths {
        let p = Path::new(path);
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or(path);
        let size = fs::metadata(p).map_err(|e| format!("{name}: {e}"))?.len();
        if size > 4 * 1024 * 1024 { return Err(format!("{name} is too large to be a preset")); }
        let value: Value = serde_json::from_slice(&fs::read(p).map_err(|e| format!("{name}: {e}"))?).map_err(|_| format!("{name} is not a preset file"))?;
        match value { Value::Array(items) => out.extend(items), v => out.push(v) }
    }
    Ok(out)
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
    #[test] fn reads_single_and_array_files() {
        let dir = tempfile::tempdir().unwrap();
        let one = dir.path().join("one.json");
        let many = dir.path().join("many.json");
        let bad = dir.path().join("bad.json");
        fs::write(&one, r#"{"name":"A"}"#).unwrap();
        fs::write(&many, r#"[{"name":"B"},{"name":"C"}]"#).unwrap();
        fs::write(&bad, "not json").unwrap();
        let paths = [one, many].map(|p| p.to_string_lossy().into_owned());
        assert_eq!(read_files(&paths).unwrap().len(), 3);
        assert!(read_files(&[bad.to_string_lossy().into_owned()]).unwrap_err().contains("bad.json"));
    }
}
