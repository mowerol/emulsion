// SPDX-License-Identifier: GPL-3.0-or-later
//! Tauri commands: thin async wrappers that run blocking work off the main thread.

use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

use crate::{decode, export, library, sidecar, thumbs, AppPaths};

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn scan_folder(path: String, recursive: bool) -> Result<library::ScanResult, String> {
    blocking(move || library::scan(Path::new(&path), recursive).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn thumbnail(paths: State<'_, AppPaths>, path: String, max_edge: u32) -> Result<Response, String> {
    let cache = paths.cache_dir.clone();
    let bytes = blocking(move || thumbs::get_or_create(&cache, Path::new(&path), max_edge.clamp(64, 2048))).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn load_image(path: String, max_edge: Option<u32>) -> Result<Response, String> {
    let bytes = blocking(move || decode::load_for_engine(Path::new(&path), max_edge)).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn write_sidecar(path: String, recipe: serde_json::Value) -> Result<(), String> {
    blocking(move || {
        sidecar::write(Path::new(&path), &recipe).map_err(|e| format!("Could not save edits for {path}: {e}"))
    })
    .await
}

fn header(request: &Request<'_>, name: &str) -> Result<String, String> {
    let raw = request
        .headers()
        .get(name)
        .ok_or_else(|| format!("Missing {name}"))?
        .to_str()
        .map_err(|_| format!("Invalid {name}"))?;
    percent_decode_str(raw).decode_utf8().map(|s| s.into_owned()).map_err(|_| format!("Invalid {name}"))
}

/// Body: RGBA8 pixels, top row first. Headers carry the destination and size.
#[tauri::command]
pub async fn write_export(request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw pixel data".into());
    };
    let dir = PathBuf::from(header(&request, "x-minilab-dir")?);
    let stem = header(&request, "x-minilab-stem")?;
    let width: u32 = header(&request, "x-minilab-width")?.parse().map_err(|_| "Invalid width")?;
    let height: u32 = header(&request, "x-minilab-height")?.parse().map_err(|_| "Invalid height")?;
    let quality: u8 = header(&request, "x-minilab-quality")?.parse().map_err(|_| "Invalid quality")?;
    let pixels = bytes.clone();
    let path = blocking(move || export::write_jpeg(&dir, &stem, &pixels, width, height, quality)).await?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupOptions {
    /// A folder or file to open on launch: the first command-line argument that
    /// exists on disk, or `MINILAB_OPEN_FOLDER`.
    pub open_path: Option<String>,
    /// `library` or `develop`, from `MINILAB_START_VIEW`.
    pub start_view: Option<String>,
}

#[tauri::command]
pub fn startup_options() -> StartupOptions {
    let from_args = std::env::args().skip(1).find(|a| !a.starts_with('-') && Path::new(a).exists());
    let open_path = from_args.or_else(|| std::env::var("MINILAB_OPEN_FOLDER").ok().filter(|p| Path::new(p).exists()));
    StartupOptions { open_path, start_view: std::env::var("MINILAB_START_VIEW").ok() }
}

/// Lets the webview report errors to the terminal during development.
#[tauri::command]
pub fn log_message(level: String, message: String) {
    eprintln!("[webview:{level}] {message}");
}
