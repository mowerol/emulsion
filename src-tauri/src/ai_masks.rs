// SPDX-License-Identifier: GPL-3.0-or-later
//! AI object masks: the models (downloaded on request into the app's data folder, pinned by
//! SHA-256, as darktable fetches its darktable-ai packages) and the commands the masks
//! interface calls. The segmentation itself is segment.rs, ported from darktable.
//!
//! Downloads use the system's curl and unpack with unzip or tar (darktable uses libcurl);
//! progress is the partial file's size, polled.

use crate::segment::{Encoding, Point, Sam};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, PartialEq)]
enum Archive {
    Zip,
    Tgz,
}

struct Package {
    id: &'static str,
    url: &'static str,
    sha256: &'static str,
    bytes: u64,
    archive: Archive,
    /// A file inside the unpacked package that shows it is complete.
    check: &'static str,
}

/// ONNX Runtime, as the denoise tools pin it (tools/denoise/setup.py). Apple silicon only.
const RUNTIME: Package = Package {
    id: "onnxruntime-1.23.2",
    url: "https://github.com/microsoft/onnxruntime/releases/download/v1.23.2/onnxruntime-osx-arm64-1.23.2.tgz",
    sha256: "b4d513ab2b26f088c66891dbbc1408166708773d7cc4163de7bdca0e9bbb7856",
    bytes: 9_999_931,
    archive: Archive::Tgz,
    check: "onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib",
};

/// darktable's default mask model, from darktable-ai release-5.6.0 (Apache-2.0 weights, Meta).
const SAM: Package = Package {
    id: "mask-object-sam21-small",
    url: "https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/mask-object-sam21-small.dtmodel",
    sha256: "06a629ac1adf40daec47d2191cbdbdac609d93769584a05f65f4276bf784663f",
    bytes: 169_639_526,
    archive: Archive::Zip,
    check: "mask-object-sam21-small/encoder.onnx",
};

const PACKAGES: [&Package; 2] = [&RUNTIME, &SAM];

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map(|p| p.join("ai-models")).map_err(|e| e.to_string())
}

fn installed(root: &Path, p: &Package) -> bool {
    root.join(p.id).join(p.check).is_file()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub supported: bool,
    pub installed: bool,
    /// Bytes still to download.
    pub download: u64,
}

fn supported() -> bool {
    cfg!(all(target_os = "macos", target_arch = "aarch64"))
}

#[tauri::command]
pub fn ai_mask_status(app: tauri::AppHandle) -> Result<Status, String> {
    let root = root(&app)?;
    let missing: Vec<_> = PACKAGES.iter().filter(|p| !installed(&root, p)).collect();
    Ok(Status { supported: supported(), installed: missing.is_empty(), download: missing.iter().map(|p| p.bytes).sum() })
}

fn sha256_file(path: &Path) -> Result<String, String> {
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
        Err(format!("{what} failed: {}", String::from_utf8_lossy(&out.stderr).trim()))
    }
}

/// Download, check and unpack one package; `progress` gets the bytes so far.
fn install(root: &Path, p: &Package, progress: impl Fn(u64)) -> Result<(), String> {
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
        return Err(format!("Could not download {} (curl exit {})", p.id, status.code().unwrap_or(-1)));
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
        Archive::Zip => run(Command::new("unzip").arg("-q").arg(&part).arg("-d").arg(&tmp), "Unzip")?,
        Archive::Tgz => run(Command::new("tar").arg("-xzf").arg(&part).arg("-C").arg(&tmp), "Untar")?,
    }
    if !tmp.join(p.check).is_file() {
        return Err(format!("{} is not laid out as expected", p.id));
    }
    let dest = root.join(p.id);
    let _ = std::fs::remove_dir_all(&dest);
    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&part);
    Ok(())
}

#[tauri::command]
pub async fn ai_mask_install(app: tauri::AppHandle) -> Result<(), String> {
    if !supported() {
        return Err("AI masks need a Mac with Apple silicon.".into());
    }
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let todo: Vec<&Package> = PACKAGES.iter().copied().filter(|p| !installed(&root, p)).collect();
        let total: u64 = todo.iter().map(|p| p.bytes).sum();
        let mut before = 0;
        for p in todo {
            install(&root, p, |n| {
                let _ = app.emit("ai-mask-progress", serde_json::json!({ "done": before + n.min(p.bytes), "total": total }));
            })?;
            before += p.bytes;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// ONNX Runtime is set up once per process. The denoise worker may already have done it with
/// the same version, in which case this one is a no-op.
fn runtime(root: &Path) -> Result<(), String> {
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

/// The model, kept loaded, and the last photo's encoding.
#[derive(Default)]
struct Worker {
    sam: Option<Sam>,
    encoding: Option<(String, Encoding)>,
    /// The last decode, before DenseCRF, for segment_refine.
    last: Option<Vec<f32>>,
}

static WORKER: Mutex<Option<Worker>> = Mutex::new(None);

fn with_worker<T>(f: impl FnOnce(&mut Worker) -> Result<T, String>) -> Result<T, String> {
    let mut guard = WORKER.lock().map_err(|_| "The AI mask worker stopped")?;
    f(guard.get_or_insert_with(Worker::default))
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = request.headers().get(name).ok_or(format!("Missing {name}"))?;
    let raw = raw.to_str().map_err(|_| format!("Invalid {name}"))?;
    percent_encoding::percent_decode_str(raw).decode_utf8().map(|s| s.into_owned()).map_err(|_| format!("Invalid {name}"))
}

/// Encode a photo for selection. Body: RGBA8 pixels of the photo as rendered (darktable
/// renders at 1536 px), top row first. Headers: x-emulsion-key (which photo and render, so a
/// repeat is free), x-emulsion-width, x-emulsion-height.
#[tauri::command]
pub async fn segment_encode(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> {
    let key = header(&request, "x-emulsion-key")?;
    let width: usize = header(&request, "x-emulsion-width")?.parse().map_err(|_| "Invalid width")?;
    let height: usize = header(&request, "x-emulsion-height")?.parse().map_err(|_| "Invalid height")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("Expected raw pixel data".into()) };
    if bytes.len() != width * height * 4 || width * height > 4096 * 4096 {
        return Err("Bad render for segmentation".into());
    }
    let rgba = bytes.clone();
    let root = root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        with_worker(|w| {
            if w.encoding.as_ref().is_some_and(|(k, _)| *k == key) {
                return Ok(());
            }
            if w.sam.is_none() {
                runtime(&root)?;
                let dir = root.join(SAM.id).join(SAM.id);
                // CPU: on an M2, CoreML took 56 s to compile the encoder once and 11 s to load it
                // on every launch after, to encode in 0.5-1 s; the CPU loads in 0.2 s and
                // encodes in 1.4 s (1536 px render).
                w.sam = Some(Sam::open(&dir, None)?);
            }
            let rgb: Vec<u8> = rgba.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2]]).collect();
            w.encoding = None;
            w.last = None;
            let encoding = w.sam.as_mut().unwrap().encode(rgb, width, height)?;
            w.encoding = Some((key, encoding));
            Ok(())
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn to_bytes(mask: &[f32]) -> Vec<u8> {
    mask.iter().map(|v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8).collect()
}

/// Decode the prompts (encoded pixels) for the encoded photo `key`: the mask at the render's
/// size, 8-bit, before edge refinement. `fresh` starts a new selection.
#[tauri::command]
pub async fn segment_decode(key: String, points: Vec<Point>, fresh: bool) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        with_worker(|w| {
            let Some((k, enc)) = w.encoding.as_mut() else { return Err("The photo is not encoded".into()) };
            if *k != key {
                return Err("The photo is not encoded".into());
            }
            if fresh {
                enc.reset();
            }
            let mask = w.sam.as_mut().ok_or("No model")?.decode(enc, &points)?;
            let bytes = to_bytes(&mask);
            w.last = Some(mask);
            Ok(Response::new(bytes))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The last decode with darktable's DenseCRF edge refinement.
#[tauri::command]
pub async fn segment_refine(key: String) -> Result<Response, String> {
    let (mut mask, rgb, w, h) = with_worker(|w| {
        let Some((k, enc)) = w.encoding.as_ref() else { return Err("The photo is not encoded".into()) };
        if *k != key {
            return Err("The photo is not encoded".into());
        }
        let last = w.last.clone().ok_or("Nothing to refine")?;
        Ok((last, enc.rgb.clone(), enc.width, enc.height))
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::segment::dense_crf(&mut mask, &rgb, w, h);
        Ok(Response::new(to_bytes(&mask)))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Frees the model and encoding (closing the tool keeps them, as darktable's persist_model).
pub fn shutdown() {
    if let Ok(mut w) = WORKER.lock() {
        *w = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// EMULSION_AI_ROOT=<empty folder> cargo test --lib install_runtime -- --ignored --nocapture
    #[test]
    #[ignore]
    fn install_runtime() {
        let root = PathBuf::from(std::env::var("EMULSION_AI_ROOT").unwrap());
        let seen = std::cell::Cell::new(0u64);
        install(&root, &RUNTIME, |n| seen.set(seen.get().max(n))).unwrap();
        assert!(installed(&root, &RUNTIME));
        assert_eq!(seen.get(), RUNTIME.bytes);
        assert!(!root.join(format!("{}.part", RUNTIME.id)).exists());
    }
}
