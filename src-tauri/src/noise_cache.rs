// SPDX-License-Identifier: GPL-3.0-or-later
//! One serialized inference worker, one full-resolution pair in memory and a
//! bounded disk cache shared by previews, virtual copies, thumbnails and export.
use crate::{
    ai_masks::Status,
    ai_models::{self, Archive, Package, RUNTIME},
    decode,
    denoise::{Denoiser, MODEL_SHA256, Provider},
    raw,
};
use image::{DynamicImage, Rgb32FImage};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::UNIX_EPOCH,
};
use tauri::{Emitter, Manager};

const DISK_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const MAX_PIXELS: u64 = 100_000_000;
static WORKER: Mutex<Worker> = Mutex::new(Worker {
    model: None,
    pair: None,
});
struct Worker {
    model: Option<Denoiser>,
    pair: Option<(String, Arc<Pair>)>,
}
struct Pair {
    meta: Meta,
    original: Rgb32FImage,
    denoised: Rgb32FImage,
}
#[derive(Serialize, Deserialize)]
struct Meta {
    width: u32,
    height: u32,
    white: Option<[f32; 2]>,
    full_size: (u32, u32),
    camera: raw::CameraMetadata,
}

fn key(path: &Path) -> Result<String, String> {
    let m = path.metadata().map_err(|e| e.to_string())?;
    let id = format!(
        "raw-nind-v1-libraw0223-darktable2-baseline{}|{}|{}|{}|{}",
        raw::BASELINE_GAIN,
        path.canonicalize().map_err(|e| e.to_string())?.display(),
        m.len(),
        m.modified()
            .map_err(|e| e.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos(),
        MODEL_SHA256
    );
    Ok(blake3::hash(id.as_bytes()).to_hex().to_string())
}

fn read_pixels(path: &Path, w: u32, h: u32) -> Result<Rgb32FImage, String> {
    let pixels = w as u64 * h as u64;
    if w == 0 || h == 0 || pixels > MAX_PIXELS {
        return Err("Invalid denoise cache dimensions".into());
    }
    let count = pixels * 3;
    if path.metadata().map_err(|e| e.to_string())?.len() != count * 4 {
        return Err("Invalid denoise cache dimensions".into());
    }
    let mut reader = std::io::BufReader::new(fs::File::open(path).map_err(|e| e.to_string())?);
    let mut values = vec![0.0; count as usize];
    let mut bytes = vec![0u8; 16384 * 4];
    for chunk in values.chunks_mut(16384) {
        let b = &mut bytes[..chunk.len() * 4];
        reader.read_exact(b).map_err(|e| e.to_string())?;
        for (out, v) in chunk.iter_mut().zip(b.chunks_exact(4)) {
            *out = f32::from_le_bytes(v.try_into().unwrap());
            if !out.is_finite() {
                return Err("Invalid denoise cache pixels".into());
            }
        }
    }
    Rgb32FImage::from_raw(w, h, values).ok_or("Invalid denoise cache size".into())
}

fn read_pair(dir: &Path) -> Result<Pair, String> {
    let meta: Meta =
        serde_json::from_slice(&fs::read(dir.join("meta.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let original = read_pixels(&dir.join("source.f32"), meta.width, meta.height)?;
    let denoised = read_pixels(&dir.join("denoised.f32"), meta.width, meta.height)?;
    // Mark the entry as recently used without rewriting its large pixel files.
    let _ = fs::write(dir.join("used"), []);
    Ok(Pair {
        meta,
        original,
        denoised,
    })
}

fn write_pixels(path: &Path, image: &Rgb32FImage) -> Result<(), String> {
    let mut file = std::io::BufWriter::new(fs::File::create(path).map_err(|e| e.to_string())?);
    for chunk in image.as_raw().chunks(16384) {
        let bytes: Vec<u8> = chunk.iter().flat_map(|v| v.to_le_bytes()).collect();
        file.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    file.flush().map_err(|e| e.to_string())
}

fn write_pair(root: &Path, id: &str, pair: &Pair) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let tmp = root.join(format!("{id}.partial"));
    let _ = fs::remove_dir_all(&tmp);
    fs::create_dir(&tmp).map_err(|e| e.to_string())?;
    let result = (|| {
        write_pixels(&tmp.join("source.f32"), &pair.original)?;
        write_pixels(&tmp.join("denoised.f32"), &pair.denoised)?;
        fs::write(
            tmp.join("meta.json"),
            serde_json::to_vec(&pair.meta).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::write(tmp.join("used"), []).map_err(|e| e.to_string())?;
        let destination = root.join(id);
        if destination.exists() {
            fs::remove_dir_all(&destination).map_err(|e| e.to_string())?;
        }
        fs::rename(&tmp, destination).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&tmp);
    }
    result
}

fn trim(root: &Path, keep: &str) {
    let mut entries = Vec::new();
    if let Ok(dirs) = fs::read_dir(root) {
        for dir in dirs.flatten() {
            let p = dir.path();
            if !p.is_dir() {
                continue;
            }
            let size = fs::read_dir(&p)
                .into_iter()
                .flatten()
                .flatten()
                .filter_map(|f| f.metadata().ok())
                .map(|m| m.len())
                .sum::<u64>();
            let used = p
                .join("used")
                .metadata()
                .and_then(|m| m.modified())
                .unwrap_or(UNIX_EPOCH);
            entries.push((p, size, used));
        }
    }
    entries.sort_by_key(|e| e.2);
    let mut total: u64 = entries.iter().map(|e| e.1).sum();
    for (p, size, _) in entries {
        if total <= DISK_LIMIT {
            break;
        }
        if p.file_name().is_some_and(|n| n == keep) {
            continue;
        }
        if fs::remove_dir_all(p).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}

/// darktable-ai's RawNIND package, the one darktable 5.6 downloads. The app uses its linear model
/// (checked again against denoise::MODEL_SHA256 on loading); the Bayer model beside it is unused.
const MODEL: Package = Package {
    id: "rawdenoise-nind",
    url: "https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/rawdenoise-nind.dtmodel",
    sha256: "d71b5f1e727c85a359e6f74dca9e2016c9d8fc3e2f7ac3e9b347d80ceca969af",
    bytes: 57_700_134,
    archive: Archive::Zip,
    check: "rawdenoise-nind/model_linear.onnx",
    license: Some(include_str!("../licenses/rawnind.txt")),
};
const PACKAGES: [&Package; 2] = [&RUNTIME, &MODEL];

/// The ONNX Runtime library and the linear model, wherever they were installed.
struct Assets {
    library: PathBuf,
    model: PathBuf,
}

/// The in-app download, beside the other AI models.
fn downloaded(root: &Path) -> Option<Assets> {
    PACKAGES.iter().all(|p| ai_models::installed(root, p)).then(|| Assets {
        library: root.join(RUNTIME.id).join(RUNTIME.check),
        model: root.join(MODEL.id).join(MODEL.check),
    })
}

/// A folder made by tools/denoise/setup.py, whose runtime.json names the library.
fn setup_folder(dir: &Path) -> Option<Assets> {
    let model = dir.join("model_linear.onnx");
    let config: serde_json::Value = serde_json::from_slice(&fs::read(dir.join("runtime.json")).ok()?).ok()?;
    let library = dir.join(config["library"].as_str()?);
    model.is_file().then_some(Assets { library, model })
}

const NOT_INSTALLED: &str = "The AI Noise Reduction model isn't installed. Download it under Noise reduction in Refine.";

fn assets(app: &tauri::AppHandle) -> Result<Assets, String> {
    if let Some(path) = std::env::var_os("EMULSION_DENOISE_ASSETS") {
        if let Some(found) = setup_folder(Path::new(&path)) {
            return Ok(found);
        }
    }
    if let Some(found) = ai_models::root(app).ok().and_then(|root| downloaded(&root)) {
        return Ok(found);
    }
    let mut folders = vec![];
    if let Ok(path) = app.path().app_data_dir() {
        folders.push(path.join("denoise"));
    }
    if let Ok(path) = app.path().resource_dir() {
        folders.push(path.join("denoise"));
    }
    // The development setup already verifies the released model and runtime.
    if cfg!(debug_assertions) {
        folders.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/denoise/assets"));
    }
    folders.iter().find_map(|dir| setup_folder(dir)).ok_or_else(|| NOT_INSTALLED.into())
}

#[tauri::command]
pub fn noise_model_status(app: tauri::AppHandle) -> Result<Status, String> {
    let root = ai_models::root(&app)?;
    let installed = assets(&app).is_ok();
    let download = if installed {
        0
    } else {
        PACKAGES.iter().filter(|p| !ai_models::installed(&root, p)).map(|p| p.bytes).sum()
    };
    Ok(Status { supported: ai_models::supported(), installed, download })
}

/// Called only from the sized Download button. Normal app startup never downloads.
#[tauri::command]
pub async fn noise_model_install(app: tauri::AppHandle) -> Result<(), String> {
    if !ai_models::supported() {
        return Err("AI Noise Reduction needs a Mac with Apple silicon.".into());
    }
    let root = ai_models::root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let todo: Vec<_> = PACKAGES.iter().copied().filter(|p| !ai_models::installed(&root, p)).collect();
        let total: u64 = todo.iter().map(|p| p.bytes).sum();
        let mut before = 0;
        for p in todo {
            ai_models::install(&root, p, |n| {
                let _ = app.emit("noise-model-progress", serde_json::json!({ "done": before + n.min(p.bytes), "total": total }));
            })?;
            before += p.bytes;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn load(
    app: &tauri::AppHandle,
    root: &Path,
    path: &Path,
    edge: Option<u32>,
) -> Result<Vec<u8>, String> {
    if crate::library::classify(path) != crate::library::Kind::Raw {
        return Err("AI Noise Reduction currently supports RAW photos.".into());
    }
    let notify = |done: usize, total: usize| {
        let _ = app.emit(
            "noise-reduction-progress",
            serde_json::json!({"path": path, "done": done, "total": total}),
        );
    };
    load_cached(root, path, edge, || assets(app), notify)
}

pub fn shutdown() {
    if let Ok(mut worker) = WORKER.lock() {
        worker.pair = None;
        worker.model = None;
    }
}

fn load_cached(
    root: &Path,
    path: &Path,
    edge: Option<u32>,
    resolve_assets: impl Fn() -> Result<Assets, String>,
    notify: impl Fn(usize, usize) + Copy,
) -> Result<Vec<u8>, String> {
    let id = key(path)?;
    let mut worker = WORKER
        .lock()
        .map_err(|_| "Noise reduction worker could not start")?;
    if worker.pair.as_ref().is_none_or(|(k, _)| *k != id) {
        worker.pair = None; // Free the previous full pair before decoding another.
        let pair = match read_pair(&root.join(&id)) {
            Ok(pair) => pair,
            Err(_) => {
                notify(0, 0);
                if worker.model.is_none() {
                    let Assets { library, model } = resolve_assets()?;
                    let provider = if cfg!(target_os = "macos") {
                        Provider::Coreml
                    } else {
                        Provider::Cpu
                    };
                    worker.model = Some(
                        Denoiser::open(
                            &library,
                            &model,
                            provider,
                            &root.parent().unwrap_or(root).join("noise-model-cache"),
                        )
                        .or_else(|_| {
                            Denoiser::open(
                                &library,
                                &model,
                                Provider::Cpu,
                                &root.parent().unwrap_or(root).join("noise-model-cache"),
                            )
                        })?,
                    );
                }
                let raw = raw::decode(path, false)?;
                if raw.image.width() as u64 * raw.image.height() as u64 > MAX_PIXELS {
                    return Err(
                        "This RAW is too large for AI noise reduction (100 MP limit).".into(),
                    );
                }
                let original = raw.image.into_rgb32f();
                let denoised = match worker
                    .model
                    .as_mut()
                    .unwrap()
                    .process(&original, 1.0, notify)
                {
                    Ok((image, _)) => image,
                    Err(_) => {
                        let Assets { library, model } = resolve_assets()?;
                        worker.model = Some(Denoiser::open(
                            &library,
                            &model,
                            Provider::Cpu,
                            &root.parent().unwrap_or(root).join("noise-model-cache"),
                        )?);
                        worker
                            .model
                            .as_mut()
                            .unwrap()
                            .process(&original, 1.0, notify)?
                            .0
                    }
                };
                if key(path)? != id {
                    return Err(
                        "The original changed while noise reduction was running. Try again.".into(),
                    );
                }
                let pair = Pair {
                    meta: Meta {
                        width: original.width(),
                        height: original.height(),
                        white: raw.white,
                        full_size: raw.full_size,
                        camera: raw.camera,
                    },
                    original,
                    denoised,
                };
                // Failure to persist a disposable cache does not discard a valid result.
                if pair.original.as_raw().len() as u64 * 8 <= DISK_LIMIT {
                    if let Err(e) = write_pair(root, &id, &pair) {
                        eprintln!("[denoise] cache: {e}");
                    }
                }
                trim(root, &id);
                pair
            }
        };
        worker.pair = Some((id, Arc::new(pair)));
    }
    let pair = worker.pair.as_ref().unwrap().1.clone();
    let m = &pair.meta;
    let (w, h) = decode::fit(m.width, m.height, edge);
    let resize = |image: &Rgb32FImage| {
        if (w, h) == image.dimensions() {
            DynamicImage::ImageRgb32F(image.clone())
        } else {
            DynamicImage::ImageRgb32F(image::imageops::resize(
                image,
                w,
                h,
                image::imageops::FilterType::Triangle,
            ))
        }
    };
    let original = resize(&pair.original);
    let raw = raw::Decoded {
        image: original,
        white: m.white,
        full_size: m.full_size,
        camera_to_working: m.camera.camera_to_working,
        camera: raw::CameraMetadata {
            // Entries written before noise profiles were sent lack one; read the ISO again.
            noise: m.camera.noise.clone().or_else(|| raw::noise_profile(path)),
            colour: m.camera.colour.clone().or_else(|| raw::colour_source_of(path)),
            ..m.camera.clone()
        },
    };
    let mut bytes = decode::raw_for_engine(path, raw, None)?;
    let flags = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) | 8;
    bytes[12..16].copy_from_slice(&flags.to_le_bytes());
    let output = resize(&pair.denoised).into_rgb32f();
    for p in output.pixels() {
        for v in [p[0], p[1], p[2], 1.0] {
            bytes.extend_from_slice(&half::f16::from_f32(v).to_le_bytes());
        }
    }
    notify(1, 1);
    drop(worker);
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "set EMULSION_NOISE_RAW to test real inference and persistent cache reuse"]
    fn real_raw_cache_reuses_inference_after_restart() {
        struct Cleanup;
        impl Drop for Cleanup {
            fn drop(&mut self) {
                shutdown();
            }
        }
        let _cleanup = Cleanup;
        let path = std::env::var("EMULSION_NOISE_RAW").unwrap();
        let root = tempfile::tempdir().unwrap();
        let assets = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/denoise/assets");
        let first = load_cached(
            root.path(),
            Path::new(&path),
            Some(512),
            || setup_folder(&assets).ok_or_else(|| "run tools/denoise/setup.py".to_string()),
            |_, _| {},
        )
        .unwrap();
        assert_ne!(u32::from_le_bytes(first[12..16].try_into().unwrap()) & 8, 0);
        shutdown();
        let second = load_cached(
            root.path(),
            Path::new(&path),
            Some(512),
            || panic!("cache must not load the model"),
            |_, _| {},
        )
        .unwrap();
        assert_eq!(first, second);
        let smaller = load_cached(
            root.path(),
            Path::new(&path),
            Some(256),
            || unreachable!(),
            |_, _| {},
        )
        .unwrap();
        assert_eq!(u32::from_le_bytes(smaller[0..4].try_into().unwrap()), 256);
        eprintln!("[denoise] real RAW inference, paired payload and persistent cache reuse passed");
    }
    #[test]
    fn finds_the_download_and_the_setup_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        assert!(downloaded(root).is_none());
        for p in PACKAGES {
            let check = root.join(p.id).join(p.check);
            fs::create_dir_all(check.parent().unwrap()).unwrap();
            fs::write(&check, b"").unwrap();
        }
        let found = downloaded(root).unwrap();
        assert_eq!(found.library, root.join("onnxruntime-1.23.2/onnxruntime-osx-arm64-1.23.2/lib/libonnxruntime.1.23.2.dylib"));
        assert_eq!(found.model, root.join("rawdenoise-nind/rawdenoise-nind/model_linear.onnx"));

        let setup = root.join("setup");
        fs::create_dir_all(&setup).unwrap();
        fs::write(setup.join("runtime.json"), br#"{"library": "lib/libonnxruntime.dylib"}"#).unwrap();
        assert!(setup_folder(&setup).is_none(), "no model yet");
        fs::write(setup.join("model_linear.onnx"), b"").unwrap();
        let found = setup_folder(&setup).unwrap();
        assert_eq!(found.library, setup.join("lib/libonnxruntime.dylib"));
        assert_eq!(found.model, setup.join("model_linear.onnx"));
    }
    #[test]
    fn float_cache_preserves_signed_values_and_rejects_truncation() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("image.f32");
        let image = Rgb32FImage::from_pixel(3, 2, image::Rgb([-0.2, 0.3, 1.7]));
        write_pixels(&path, &image).unwrap();
        assert_eq!(read_pixels(&path, 3, 2).unwrap(), image);
        assert!(read_pixels(&path, 3, 3).is_err());
        fs::write(&path, [0u8; 4]).unwrap();
        assert!(read_pixels(&path, 3, 2).is_err());
    }
    #[test]
    fn source_changes_invalidate_inference_identity() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("test.raw");
        fs::write(&path, b"original").unwrap();
        let before = key(&path).unwrap();
        fs::write(&path, b"different original").unwrap();
        assert_ne!(key(&path).unwrap(), before);
    }
}
