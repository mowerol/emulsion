// SPDX-License-Identifier: GPL-3.0-or-later
//! Tauri commands: thin async wrappers that run blocking work off the main thread.

use percent_encoding::percent_decode_str;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

use rayon::prelude::*;

use crate::{decode, export, library, raw, sidecar, thumbs, AppPaths};

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

/// As-shot white points (CIE xy) of `paths`, in order: metadata only, read in
/// parallel. `None` for anything that is not a RAW or records no white balance.
/// The last photo's capture sharpening data; reading the raw data takes up to a second or two.
static CAPTURE: std::sync::Mutex<Option<(String, std::sync::Arc<crate::capture::Info>)>> = std::sync::Mutex::new(None);

/// Capture sharpening data for a RAW decoded at width × height: RawTherapee's
/// auto radius (in sensor pixels), the matrix from working Rec.2020 to camera
/// RGB, then the clip mask, one byte per pixel. Little-endian: f32 radius,
/// u32 width, u32 height, 9 f32 matrix (row major), then the mask.
#[tauri::command]
pub async fn capture_info(path: String, width: u32, height: u32) -> Result<Response, String> {
    let bytes = blocking(move || {
        let cached = CAPTURE.lock().unwrap().as_ref().filter(|(p, _)| *p == path).map(|(_, i)| i.clone());
        let info = match cached {
            Some(i) => i,
            None => {
                let i = std::sync::Arc::new(crate::capture::Info::read(Path::new(&path))?);
                *CAPTURE.lock().unwrap() = Some((path.clone(), i.clone()));
                i
            }
        };
        let matrix = crate::raw::working_to_camera(Path::new(&path))?;
        let mask = info.mask_at(width as usize, height as usize);
        let mut out = Vec::with_capacity(48 + mask.len());
        out.extend(info.radius.to_le_bytes());
        out.extend(width.to_le_bytes());
        out.extend(height.to_le_bytes());
        for v in matrix.iter().flatten() {
            out.extend(v.to_le_bytes());
        }
        out.extend(mask);
        Ok(out)
    })
    .await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn white_points(paths: Vec<String>) -> Result<Vec<Option<[f32; 2]>>, String> {
    blocking(move || {
        Ok(paths
            .par_iter()
            .map(|p| {
                let path = Path::new(p);
                if library::classify(path) == library::Kind::Raw { raw::as_shot_white(path).ok().flatten() } else { None }
            })
            .collect())
    })
    .await
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
    let dir = PathBuf::from(header(&request, "x-emulsion-dir")?);
    let stem = header(&request, "x-emulsion-stem")?;
    let width: u32 = header(&request, "x-emulsion-width")?.parse().map_err(|_| "Invalid width")?;
    let height: u32 = header(&request, "x-emulsion-height")?.parse().map_err(|_| "Invalid height")?;
    let quality: u8 = header(&request, "x-emulsion-quality")?.parse().map_err(|_| "Invalid quality")?;
    let pixels = bytes.clone();
    let path = blocking(move || export::write_jpeg(&dir, &stem, &pixels, width, height, quality)).await?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupOptions {
    /// A folder or file to open on launch: the first command-line argument that
    /// exists on disk, or `EMULSION_OPEN_FOLDER`.
    pub open_path: Option<String>,
    /// `library` or `develop`, from `EMULSION_START_VIEW`.
    pub start_view: Option<String>,
}

#[tauri::command]
pub fn startup_options() -> StartupOptions {
    let from_args = std::env::args().skip(1).find(|a| !a.starts_with('-') && Path::new(a).exists());
    let open_path = from_args.or_else(|| std::env::var("EMULSION_OPEN_FOLDER").ok().filter(|p| Path::new(p).exists()));
    StartupOptions { open_path, start_view: std::env::var("EMULSION_START_VIEW").ok() }
}

/// Lets the webview report errors to the terminal during development.
#[tauri::command]
pub fn log_message(level: String, message: String) {
    eprintln!("[webview:{level}] {message}");
}
