// SPDX-License-Identifier: GPL-3.0-or-later
// Included as a test module ONLY in a disposable frozen checkout by native-run.py.
#[test]
fn app_performance_native_audit() {
    use std::{fs, path::Path, time::Instant};
    let mut result = serde_json::Map::new();
    let dir = tempfile::tempdir().unwrap();
    for count in [1000, 10000, 50000] {
        let existing = if count == 1000 { 0 } else if count == 10000 { 1000 } else { 10000 };
        for i in existing..count { fs::write(dir.path().join(format!("{i:06}.JPG")), []).unwrap(); }
        let mut times = vec![];
        for _ in 0..3 {
            let t = Instant::now();
            let found = crate::library::scan(dir.path(), false).unwrap();
            assert_eq!(found.entries.len(), count);
            times.push(t.elapsed().as_secs_f64() * 1000.0);
        }
        result.insert(format!("scan-{count}"), serde_json::json!(times));
    }
    if let Ok(paths) = std::env::var("EMULSION_AUDIT_PHOTOS") {
        for (index, name) in paths.split('|').enumerate() {
            for edge in [512, 2560] {
                let mut times = vec![]; let mut dimensions = (0, 0); let mut bytes = 0;
                for _ in 0..2 {
                    let t = Instant::now();
                    let out = crate::decode::load_for_engine(Path::new(name), Some(edge)).unwrap();
                    times.push(t.elapsed().as_secs_f64() * 1000.0);
                    dimensions = (u32::from_le_bytes(out[0..4].try_into().unwrap()), u32::from_le_bytes(out[4..8].try_into().unwrap()));
                    bytes = out.len();
                }
                result.insert(format!("decode-{index}-{edge}"), serde_json::json!({"name":Path::new(name).file_name().unwrap().to_string_lossy(),"milliseconds":times,"dimensions":dimensions,"bytes":bytes}));
            }
        }
    }
    println!("AUDIT_JSON:{}", serde_json::to_string(&result).unwrap());
}
