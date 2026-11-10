// SPDX-License-Identifier: GPL-3.0-or-later
//! AI object masks: the models (downloaded on request into the app's data folder, pinned by
//! SHA-256, as darktable fetches its darktable-ai packages) and the commands the masks
//! interface calls. The segmentation itself is segment.rs, ported from darktable.
//!
//! Downloads use the system's curl and unpack with unzip or tar (darktable uses libcurl);
//! progress is the partial file's size, polled.

use crate::segment::{Encoding, Point, Sam};
use serde::Serialize;
use std::sync::Mutex;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::Emitter;
use crate::ai_models::{Archive, Package, RUNTIME, root, installed, supported, install, runtime};

/// darktable's default mask model, from darktable-ai release-5.6.0 (Apache-2.0 weights, Meta).
const SAM: Package = Package {
    id: "mask-object-sam21-small",
    url: "https://github.com/darktable-org/darktable-ai/releases/download/release-5.6.0/mask-object-sam21-small.dtmodel",
    sha256: "06a629ac1adf40daec47d2191cbdbdac609d93769584a05f65f4276bf784663f",
    bytes: 169_639_526,
    archive: Archive::Zip,
    check: "mask-object-sam21-small/encoder.onnx",
    license: None,
};

const PACKAGES: [&Package; 2] = [&RUNTIME, &SAM];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub supported: bool,
    pub installed: bool,
    /// Bytes still to download.
    pub download: u64,
}

#[tauri::command]
pub fn ai_mask_status(app: tauri::AppHandle) -> Result<Status, String> {
    let root = root(&app)?;
    let missing: Vec<_> = PACKAGES.iter().filter(|p| !installed(&root, p)).collect();
    Ok(Status { supported: supported(), installed: missing.is_empty(), download: missing.iter().map(|p| p.bytes).sum() })
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
        let root = std::path::PathBuf::from(std::env::var("EMULSION_AI_ROOT").unwrap());
        let seen = std::cell::Cell::new(0u64);
        install(&root, &RUNTIME, |n| seen.set(seen.get().max(n))).unwrap();
        assert!(installed(&root, &RUNTIME));
        assert_eq!(seen.get(), RUNTIME.bytes);
        assert!(!root.join(format!("{}.part", RUNTIME.id)).exists());
    }
}
