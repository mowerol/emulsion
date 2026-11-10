// SPDX-License-Identifier: GPL-3.0-or-later
//! Pinned, on-demand AI packages shared by object selection and Remove.
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, OnceLock},
};
use tauri::Manager;

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum Archive {
    Zip,
    Tgz,
    File,
}

pub(crate) struct Package {
    pub(crate) id: &'static str,
    pub(crate) url: &'static str,
    pub(crate) sha256: &'static str,
    pub(crate) bytes: u64,
    pub(crate) archive: Archive,
    /// A file inside the unpacked package that shows it is complete.
    pub(crate) check: &'static str,
    /// Raw model downloads have no archive carrying their license.
    pub(crate) license: Option<&'static str>,
}

/// ONNX Runtime, as the denoise tools pin it (tools/denoise/setup.py). Apple silicon only.
pub(crate) const RUNTIME: Package = Package {
    id: "onnxruntime-1.23.2",
    url: "https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-osx-arm64-1.23.2.tgz",
    sha256: "b4d513ab2b26f088c66891dbbc1408166708773d7cc4163de7bdca0e9bbb7856",
    bytes: 9_999_931,
    archive: Archive::Tgz,
    check: "onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib",
    license: None,
};

pub(crate) fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("ai-models"))
        .map_err(|e| e.to_string())
}

pub(crate) fn installed(root: &Path, p: &Package) -> bool {
    root.join(p.id).join(p.check).is_file()
}

pub(crate) fn supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}

pub(crate) fn sha256_file(path: &Path) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(format!("{:x}", h.finalize()))
}

fn run(cmd: &mut Command, what: &str) -> Result<(), String> {
    let out = cmd.output().map_err(|e| format!("{what}: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{what} failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// Download, check and unpack one package; `progress` gets the bytes so far.
pub(crate) fn install(root: &Path, p: &Package, progress: impl Fn(u64)) -> Result<(), String> {
    static INSTALL: Mutex<()> = Mutex::new(());
    let _guard = INSTALL.lock().map_err(|_| "The AI installer stopped")?;
    if installed(root, p) {
        return Ok(());
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let part = root.join(format!("{}.part", p.id));
    let _ = std::fs::remove_file(&part);
    let mut child = Command::new("curl")
        .args(["-fsSL", "--retry", "2", "-o"])
        .arg(&part)
        .arg(p.url)
        .spawn()
        .map_err(|e| format!("Download: {e}"))?;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        progress(std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0));
        std::thread::sleep(std::time::Duration::from_millis(200));
    };
    if !status.success() {
        let _ = std::fs::remove_file(&part);
        return Err(format!(
            "Could not download {} (curl exit {})",
            p.id,
            status.code().unwrap_or(-1)
        ));
    }
    progress(p.bytes);
    let actual = sha256_file(&part)?;
    if actual != p.sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(format!("{} did not match its pinned checksum", p.id));
    }
    let tmp = root.join(format!("{}.unpack", p.id));
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
    match p.archive {
        Archive::Zip => run(
            Command::new("unzip")
                .arg("-q")
                .arg(&part)
                .arg("-d")
                .arg(&tmp),
            "Unzip",
        )?,
        Archive::Tgz => run(
            Command::new("tar")
                .arg("-xzf")
                .arg(&part)
                .arg("-C")
                .arg(&tmp),
            "Untar",
        )?,
        Archive::File => std::fs::rename(&part, tmp.join(p.check)).map_err(|e| e.to_string())?,
    }
    if !tmp.join(p.check).is_file() {
        return Err(format!("{} is not laid out as expected", p.id));
    }
    if let Some(license) = p.license {
        std::fs::write(tmp.join("LICENSE"), license).map_err(|e| e.to_string())?;
    }
    let dest = root.join(p.id);
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&part);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_model_install_checks_hash_before_publishing() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.onnx");
        std::fs::write(&source, b"test model").unwrap();
        // The installer uses curl's local-file transport; no network in this test.
        let url = Box::leak(format!("file://{}", source.display()).into_boxed_str());
        let hash = Box::leak(sha256_file(&source).unwrap().into_boxed_str());
        let mut package = Package {
            id: "test",
            url,
            sha256: "wrong",
            bytes: 10,
            archive: Archive::File,
            check: "model.onnx",
            license: Some("test license"),
        };
        let root = dir.path().join("models");
        assert!(
            install(&root, &package, |_| {})
                .unwrap_err()
                .contains("checksum")
        );
        assert!(!installed(&root, &package));
        assert!(!root.join("test.part").exists());
        package.sha256 = hash;
        install(&root, &package, |_| {}).unwrap();
        assert!(installed(&root, &package));
        assert_eq!(
            std::fs::read(root.join("test/model.onnx")).unwrap(),
            b"test model"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("test/LICENSE")).unwrap(),
            "test license"
        );
    }
}

/// ONNX Runtime is set up once per process. The denoise worker may already have done it with
/// the same version, in which case this one is a no-op.
pub(crate) fn runtime(root: &Path) -> Result<(), String> {
    static INIT: OnceLock<Result<(), String>> = OnceLock::new();
    INIT.get_or_init(|| {
        let lib = root.join(RUNTIME.id).join(RUNTIME.check);
        if !lib.is_file() {
            return Err("ONNX Runtime is not installed".into());
        }
        ort::init_from(lib).map_err(|e| e.to_string())?.commit();
        Ok(())
    })
    .clone()
}
