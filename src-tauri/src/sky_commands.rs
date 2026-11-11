// SPDX-License-Identifier: GPL-3.0-or-later
//! On-demand sky model download and local inference, independent of SAM installation.

use crate::{
    ai_masks::Status,
    ai_models::{self, Archive, Package, RUNTIME},
    sky::Sky,
};
use std::sync::Mutex;
use tauri::{
    Emitter,
    ipc::{InvokeBody, Request, Response},
};

const MODEL: Package = Package {
    id: "mask-sky-u2net-fp16",
    url: "https://huggingface.co/voyagerfromeast/skyseg/resolve/d76f97cf68f049654f087d78d071dfd7505b2561/skyseg_fp16.onnx",
    sha256: "74d87f4a69378a610a6be662f859c38cfbdfdd75ff74bbfc54842965ed6fc9f7",
    bytes: 88_084_505,
    archive: Archive::File,
    check: "skyseg_fp16.onnx",
    license: Some(include_str!("../licenses/skyseg.txt")),
};
const PACKAGES: [&Package; 2] = [&RUNTIME, &MODEL];
static WORKER: Mutex<Option<Sky>> = Mutex::new(None);

#[tauri::command]
pub fn sky_mask_status(app: tauri::AppHandle) -> Result<Status, String> {
    let root = ai_models::root(&app)?;
    let missing: Vec<_> = PACKAGES
        .iter()
        .filter(|p| !ai_models::installed(&root, p))
        .collect();
    Ok(Status {
        supported: ai_models::supported(),
        installed: missing.is_empty(),
        download: missing.iter().map(|p| p.bytes).sum(),
    })
}

#[tauri::command]
pub async fn sky_mask_install(app: tauri::AppHandle) -> Result<(), String> {
    if !ai_models::supported() {
        return Err("AI masks need a Mac with Apple silicon.".into());
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
        for p in todo {
            ai_models::install(&root, p, |n| {
                let _ = app.emit(
                    "sky-mask-progress",
                    serde_json::json!({ "done": before + n.min(p.bytes), "total": total }),
                );
            })?;
            before += p.bytes;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// RGBA8 of the whole uncropped source. Returns one top-row-first mask byte per pixel.
#[tauri::command]
pub async fn segment_sky(app: tauri::AppHandle, request: Request<'_>) -> Result<Response, String> {
    let dimension = |name| {
        request
            .headers()
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<usize>().ok())
            .ok_or_else(|| format!("Invalid {name}"))
    };
    let width = dimension("x-emulsion-width")?;
    let height = dimension("x-emulsion-height")?;
    let InvokeBody::Raw(rgba) = request.body() else {
        return Err("Expected raw pixel data".into());
    };
    if !crate::sky::valid_render(width, height, rgba.len()) {
        return Err("Bad render for sky selection".into());
    }
    if !ai_models::supported() {
        return Err("AI masks need a Mac with Apple silicon.".into());
    }
    let rgba = rgba.clone();
    let root = ai_models::root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut worker = WORKER.lock().map_err(|_| "The sky mask worker stopped")?;
        if worker.is_none() {
            ai_models::runtime(&root)?;
            *worker = Some(Sky::open(&root.join(MODEL.id).join(MODEL.check))?);
        }
        Ok(Response::new(
            worker.as_mut().unwrap().select(&rgba, width, height)?,
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn shutdown() {
    if let Ok(mut worker) = WORKER.lock() {
        *worker = None;
    }
}
