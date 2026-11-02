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
pub async fn photo_exposure(path: String) -> Result<Option<crate::exposure::Exposure>, String> {
    blocking(move || Ok(crate::exposure::read(Path::new(&path)))).await
}

#[tauri::command]
pub async fn catalog_metadata(paths: Vec<String>) -> Result<Vec<crate::exposure::CatalogMetadata>, String> {
    blocking(move || Ok(paths.par_iter().map(|path| crate::exposure::catalog(Path::new(path))).collect())).await
}

#[tauri::command]
pub async fn browse_directory(path: String) -> Result<Vec<library::FolderEntry>, String> {
    blocking(move || library::directories(Path::new(&path)).map_err(|e| e.to_string())).await
}

#[tauri::command]
pub async fn computer_folders(app: tauri::AppHandle) -> Result<Vec<library::FolderEntry>, String> {
    use tauri::Manager;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    blocking(move || {
        let mut roots = vec![library::FolderEntry { path: home.to_string_lossy().into_owned(), name: "Home".into() }];
        #[cfg(not(target_os = "windows"))]
        roots.push(library::FolderEntry { path: "/".into(), name: "Computer".into() });
        #[cfg(target_os = "macos")]
        if let Ok(volumes) = library::directories(Path::new("/Volumes")) { roots.extend(volumes); }
        #[cfg(target_os = "linux")]
        for mount in ["/media", "/mnt", "/run/media"] {
            if let Ok(volumes) = library::directories(Path::new(mount)) { roots.extend(volumes); }
        }
        #[cfg(target_os = "windows")]
        for drive in b'A'..=b'Z' {
            let path = format!("{}:\\", drive as char);
            if Path::new(&path).is_dir() { roots.push(library::FolderEntry { name: path.clone(), path }); }
        }
        Ok(roots)
    }).await
}

#[tauri::command]
pub async fn thumbnail(paths: State<'_, AppPaths>, path: String, max_edge: u32) -> Result<Response, String> {
    let cache = paths.cache_dir.clone();
    let bytes = blocking(move || thumbs::get_or_create(&cache, Path::new(&path), max_edge.clamp(64, 2048))).await?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub async fn load_image(app: tauri::AppHandle, paths: State<'_, AppPaths>, path: String, max_edge: Option<u32>, noise_reduction: Option<bool>) -> Result<Response, String> {
    let cache = paths.cache_dir.parent().unwrap_or(&paths.cache_dir).join("noise-reduction");
    let bytes = blocking(move || if noise_reduction.unwrap_or(false) { crate::noise_cache::load(&app, &cache, Path::new(&path), max_edge) }
        else { decode::load_for_engine(Path::new(&path), max_edge) }).await?;
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
pub async fn write_sidecar(path: String, saved: sidecar::Saved) -> Result<(), String> {
    blocking(move || {
        sidecar::write(Path::new(&path), &saved).map_err(|e| format!("Could not save edits for {path}: {e}"))
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

/// Neutral, lens-corrected RGBA8 preview. Geometry is fitted off the UI thread.
#[tauri::command]
pub async fn auto_perspective(request: Request<'_>) -> Result<crate::perspective::Perspective, String> {
    let width: u32 = header(&request, "x-emulsion-width")?.parse().map_err(|_| "Invalid width")?;
    let height: u32 = header(&request, "x-emulsion-height")?.parse().map_err(|_| "Invalid height")?;
    let axis = header(&request, "x-emulsion-axis")?;
    let current = serde_json::from_str(&header(&request, "x-emulsion-perspective")?).map_err(|_| "Invalid perspective parameters")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("Expected raw pixel data".into()); };
    if bytes.len() > 4_000_000 { return Err("Perspective preview is too large".into()); }
    let pixels = bytes.clone();
    blocking(move || crate::perspective::fit(&pixels, width, height, &axis, current)).await
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

/// The user's DCP library, under the app's data folder.
fn profiles_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map(|p| p.join("camera-profiles")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn camera_profiles(app: tauri::AppHandle) -> Result<Vec<crate::camera_profiles::ProfileEntry>, String> {
    let root = profiles_root(&app)?;
    Ok(crate::camera_profiles::list(&root))
}

#[tauri::command]
pub async fn read_camera_profile(app: tauri::AppHandle, id: String) -> Result<Response, String> {
    let path = crate::camera_profiles::file(&profiles_root(&app)?, &id)?;
    blocking(move || crate::camera_profiles::read_file(&path).map(Response::new)).await
}

#[tauri::command]
pub async fn read_camera_profile_file(path: String) -> Result<Response, String> {
    blocking(move || crate::camera_profiles::read_file(std::path::Path::new(&path)).map(Response::new)).await
}

#[tauri::command]
pub async fn install_camera_profile(app: tauri::AppHandle, request: Request<'_>) -> Result<crate::camera_profiles::ProfileEntry, String> {
    let name = header(&request, "x-emulsion-profile-name")?;
    let camera = header(&request, "x-emulsion-profile-camera")?;
    let copyright = header(&request, "x-emulsion-profile-copyright")?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("Expected binary DCP data".into()),
    };
    let root = profiles_root(&app)?;
    blocking(move || crate::camera_profiles::install(&root, &bytes, name, camera, copyright)).await
}

/// Custom looks, under the app's data folder.
fn looks_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map(|p| p.join("looks")).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn custom_looks(app: tauri::AppHandle) -> Result<Vec<crate::user_looks::CustomLook>, String> {
    let root = looks_root(&app)?;
    blocking(move || Ok(crate::user_looks::list(&root))).await
}

#[tauri::command]
pub async fn read_look_lut(app: tauri::AppHandle, hash: String) -> Result<Response, String> {
    let root = looks_root(&app)?;
    blocking(move || crate::user_looks::read_lut(&root, &hash).map(Response::new)).await
}

#[tauri::command]
pub async fn read_lut_file(path: String) -> Result<Response, String> {
    blocking(move || crate::user_looks::read_file(std::path::Path::new(&path)).map(Response::new)).await
}

/// Body: the LUT file's bytes; header: its format. Returns its content hash.
#[tauri::command]
pub async fn store_look_lut(app: tauri::AppHandle, request: Request<'_>) -> Result<String, String> {
    let ext = header(&request, "x-emulsion-lut-ext")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected the LUT file's bytes".into());
    };
    let bytes = bytes.clone();
    let root = looks_root(&app)?;
    blocking(move || crate::user_looks::store_lut(&root, &bytes, &ext)).await
}

#[tauri::command]
pub async fn save_custom_look(app: tauri::AppHandle, look: crate::user_looks::CustomLook) -> Result<crate::user_looks::CustomLook, String> {
    let root = looks_root(&app)?;
    blocking(move || crate::user_looks::save(&root, look)).await
}

#[tauri::command]
pub async fn delete_custom_look(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = looks_root(&app)?;
    blocking(move || crate::user_looks::delete(&root, &id)).await
}

#[tauri::command]
pub async fn list_presets(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let root = looks_root(&app)?.with_file_name("presets");
    blocking(move || Ok(crate::presets::list(&root))).await
}
#[tauri::command]
pub async fn save_preset(app: tauri::AppHandle, preset: serde_json::Value) -> Result<(), String> {
    let root = looks_root(&app)?.with_file_name("presets");
    blocking(move || crate::presets::save(&root, preset)).await
}
#[tauri::command]
pub async fn delete_preset(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = looks_root(&app)?.with_file_name("presets");
    blocking(move || crate::presets::delete(&root, &id)).await
}
/// Read preset files the person chose, for the interface to check and save as new presets.
#[tauri::command]
pub async fn read_preset_files(paths: Vec<String>) -> Result<Vec<serde_json::Value>, String> {
    blocking(move || crate::presets::read_files(&paths)).await
}
