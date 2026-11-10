// SPDX-License-Identifier: GPL-3.0-or-later
//! Remove's opt-in installer and serialized background patch worker.
use crate::{
    ai_models::{self, Archive, Package, RUNTIME},
    denoise::Provider,
    inpaint::{Lama, MODEL_SHA256, PIXELS},
    inpaint_cache::{self, Cache, DISK_LIMIT},
};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    Emitter, Manager,
    ipc::{InvokeBody, Request, Response},
};

const MODEL: Package = Package {
    id: "remove-lama-fp32",
    url: "https://huggingface.co/Carve/LaMa-ONNX/resolve/c3c0c9e468934d62e79c329e35d82dd09ff8c444/lama_fp32.onnx",
    sha256: MODEL_SHA256,
    bytes: 208_044_816,
    archive: Archive::File,
    check: "lama_fp32.onnx",
    license: Some(include_str!(
        "../../tools/inpaint/licenses/LaMa-APACHE-2.0.txt"
    )),
};
const PACKAGES: [&Package; 2] = [&RUNTIME, &MODEL];
static WORKER: Mutex<Option<Lama>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    supported: bool,
    installed: bool,
    download: u64,
    model: &'static str,
}

#[tauri::command]
pub fn remove_status(app: tauri::AppHandle) -> Result<Status, String> {
    let root = ai_models::root(&app)?;
    let missing: Vec<_> = PACKAGES
        .iter()
        .filter(|p| !ai_models::installed(&root, p))
        .collect();
    Ok(Status {
        supported: ai_models::supported(),
        installed: missing.is_empty(),
        download: missing.iter().map(|p| p.bytes).sum(),
        model: MODEL_SHA256,
    })
}

/// Called only after consent from the Remove UI. Normal app startup never downloads.
#[tauri::command]
pub async fn remove_install(app: tauri::AppHandle) -> Result<(), String> {
    if !ai_models::supported() {
        return Err("Remove needs a Mac with Apple silicon.".into());
    }
    let root = ai_models::root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let todo: Vec<_> = PACKAGES
            .iter()
            .copied()
            .filter(|p| !ai_models::installed(&root, p))
            .collect();
        let total: u64 = todo.iter().map(|p| p.bytes).sum();
        let mut before = 0;
        for package in todo {
            ai_models::install(&root, package, |done| {
                let _ = app.emit(
                    "remove-download-progress",
                    serde_json::json!({"done": before + done.min(package.bytes), "total": total}),
                );
            })?;
            before += package.bytes;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn patch_cache(app: &tauri::AppHandle) -> Result<Cache, String> {
    Ok(Cache::new(
        &app.path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("remove-patches"),
        DISK_LIMIT,
    ))
}

/// Cache-only restoration. Empty bytes mean a miss. Never waits for the model worker.
#[tauri::command]
pub async fn remove_cached_patch(app: tauri::AppHandle, key: String) -> Result<Response, String> {
    inpaint_cache::validate_key(&key)?;
    let cache = patch_cache(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        cache
            .get(&key)
            .map(|pixels| Response::new(pixels.unwrap_or_default()))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Body: 512² RGBA8 sRGB crop, then 512² mask bytes. Header: x-emulsion-key (28 hex).
/// Returns the 512² RGBA8 patch. Cache hits work offline without an installed model.
#[tauri::command]
pub async fn remove_inpaint(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<Response, String> {
    let key = request
        .headers()
        .get("x-emulsion-key")
        .and_then(|h| h.to_str().ok())
        .ok_or("Missing Remove patch key")?
        .to_owned();
    inpaint_cache::validate_key(&key)?;
    let InvokeBody::Raw(body) = request.body() else {
        return Err("Expected Remove crop and mask bytes".into());
    };
    if body.len() != PIXELS * 5 {
        return Err("Invalid Remove crop or mask size".into());
    }
    let body = body.clone();
    let root = ai_models::root(&app)?;
    let cache = patch_cache(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut worker = WORKER.lock().map_err(|_| "The Remove worker stopped")?;
        let pixels = inpaint_cache::resolve(&cache, &key, || {
            if worker.is_none() {
                // Provider choice follows the native benchmark in docs/research/lama-native.md.
                *worker = Some(Lama::open(
                    &root.join(RUNTIME.id).join(RUNTIME.check),
                    &root.join(MODEL.id).join(MODEL.check),
                    Provider::Cpu,
                    &root.join("remove-coreml-cache"),
                )?);
            }
            worker
                .as_mut()
                .unwrap()
                .process(&body[..PIXELS * 4], &body[PIXELS * 4..])
        })?;
        Ok(Response::new(pixels))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn shutdown() {
    if let Ok(mut worker) = WORKER.lock() {
        *worker = None;
    }
}
