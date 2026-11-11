// SPDX-License-Identifier: GPL-3.0-or-later
//! Tauri commands: thin async wrappers that run blocking work off the main thread.

use percent_encoding::percent_decode_str;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

use rayon::prelude::*;

use crate::{decode, export, library, raw, sidecar, thumbs, xmp, AppPaths};

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextEdit { Copy, Paste }

/// The custom Edit menu routes photo shortcuts through the webview. For text, use the same
/// native responder actions as macOS's predefined Copy/Paste items; DOM paste is restricted.
#[tauri::command]
pub fn native_text_edit(action: TextEdit) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use objc2::{sel, MainThreadMarker};
        use objc2_app_kit::NSApplication;
        let main = MainThreadMarker::new().ok_or("Text editing requires the main thread")?;
        let selector = match action { TextEdit::Copy => sel!(copy:), TextEdit::Paste => sel!(paste:) };
        // SAFETY: these are the standard, argument-compatible responder selectors. With no
        // target Cocoa resolves the focused responder, exactly as a native menu item does.
        unsafe { NSApplication::sharedApplication(main).sendAction_to_from(selector, None, None); }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = action;
        Err("Native text editing is only needed on macOS".into())
    }
}

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
pub async fn cull_preview(path: String) -> Result<Response, String> {
    let bytes = blocking(move || thumbs::cull_preview(Path::new(&path))).await?;
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

/// Stars, labels, keywords and IPTC fields embedded in each photo, for photos with none of
/// their own yet and no XMP sidecar (in-camera ratings, files from other apps). `None` where
/// there is nothing to take.
#[tauri::command]
pub async fn embedded_metadata(paths: Vec<String>) -> Result<Vec<Option<xmp::Interchange>>, String> {
    blocking(move || Ok(paths.par_iter().map(|p| sidecar::embedded(Path::new(p))).collect())).await
}

#[tauri::command]
pub async fn write_sidecar(path: String, saved: sidecar::Saved, checkpoint: Option<bool>) -> Result<(), String> {
    blocking(move || {
        sidecar::write(Path::new(&path), &saved, checkpoint.unwrap_or(false)).map_err(|e| format!("Could not save edits for {path}: {e}"))
    })
    .await
}

/// Earlier states of a photo's edits, newest first.
#[tauri::command]
pub async fn sidecar_history(path: String) -> Result<Vec<sidecar::Earlier>, String> {
    blocking(move || Ok(sidecar::history(Path::new(&path)))).await
}

fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_app_settings(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let root = data_root(&app)?;
    blocking(move || Ok(crate::app_data::read_settings(&root))).await
}

#[tauri::command]
pub async fn write_app_settings(app: tauri::AppHandle, settings: serde_json::Value) -> Result<(), String> {
    let root = data_root(&app)?;
    blocking(move || crate::app_data::write_settings(&root, &settings)).await
}

#[tauri::command]
pub async fn app_backups(app: tauri::AppHandle) -> Result<Vec<crate::app_data::Snapshot>, String> {
    let root = data_root(&app)?;
    blocking(move || Ok(crate::app_data::list(&root))).await
}

/// Merge a snapshot folder (one of `app_backups`, or any folder laid out like one) back in.
#[tauri::command]
pub async fn restore_app_backup(app: tauri::AppHandle, path: String) -> Result<crate::app_data::Restored, String> {
    let root = data_root(&app)?;
    blocking(move || crate::app_data::restore(&root, Path::new(&path))).await
}

#[tauri::command]
pub async fn export_app_settings(app: tauri::AppHandle, path: String) -> Result<usize, String> {
    let root = data_root(&app)?;
    let version = app.package_info().version.to_string();
    blocking(move || crate::app_data::export(&root, Path::new(&path), &version)).await
}

#[tauri::command]
pub async fn import_app_settings(app: tauri::AppHandle, path: String) -> Result<crate::app_data::Restored, String> {
    use tauri::Manager;
    let root = data_root(&app)?;
    let scratch = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("settings-import");
    blocking(move || {
        let _ = std::fs::remove_dir_all(&scratch);
        std::fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;
        let result = crate::app_data::unpack(Path::new(&path), &scratch).and_then(|_| crate::app_data::restore(&root, &scratch));
        let _ = std::fs::remove_dir_all(&scratch);
        result
    })
    .await
}

#[tauri::command]
pub async fn show_app_backups(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = crate::app_data::backups_dir(&data_root(&app)?);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
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

/// Body: the frame's pixels, top row first: 8-bit RGBA, or 16-bit RGB (little-endian) for a
/// 16-bit format. Headers carry the destination, size, format (JSON), the rule for an existing
/// file, and the photo's own path, which an overwrite never replaces.
#[tauri::command]
pub async fn write_export(request: Request<'_>) -> Result<export::Written, export::WriteError> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected raw pixel data".to_string().into());
    };
    let dir = PathBuf::from(header(&request, "x-emulsion-dir")?);
    let stem = header(&request, "x-emulsion-stem")?;
    let width: u32 = header(&request, "x-emulsion-width")?.parse().map_err(|_| "Invalid width".to_string())?;
    let height: u32 = header(&request, "x-emulsion-height")?.parse().map_err(|_| "Invalid height".to_string())?;
    let format: export::Format =
        serde_json::from_str(&header(&request, "x-emulsion-format")?).map_err(|e| format!("Invalid export format: {e}"))?;
    let existing: export::Existing =
        serde_json::from_str(&header(&request, "x-emulsion-existing")?).map_err(|e| format!("Invalid existing-file rule: {e}"))?;
    let protect = header(&request, "x-emulsion-protect").ok().filter(|p| !p.is_empty()).map(PathBuf::from);
    let pixels = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let px = if format.bits() == 16 { export::Pixels::Rgb16(&pixels) } else { export::Pixels::Rgba8(&pixels) };
        export::write_frame(&dir, &stem, &px, width, height, format, existing, protect.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Whether a frame of `stem` would find its file name taken in `dir` (to skip it before developing).
#[tauri::command]
pub fn export_exists(dir: String, stem: String, ext: String) -> bool {
    std::fs::symlink_metadata(export::target(Path::new(&dir), &stem, &ext)).is_ok()
}

/// Creates the export folder and checks it can be written, before any frame is developed.
#[tauri::command]
pub async fn check_export_dir(dir: String) -> Result<(), export::WriteError> {
    tauri::async_runtime::spawn_blocking(move || export::check_dir(Path::new(&dir))).await.map_err(|e| e.to_string())?
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

/// Drains the paths macOS asked us to open (see `PendingOpen`).
#[tauri::command]
pub fn take_open_paths(pending: tauri::State<'_, crate::PendingOpen>) -> Vec<String> {
    std::mem::take(&mut *pending.0.lock().unwrap())
}

/// Lets the webview report errors to the terminal during development.
#[tauri::command]
pub fn log_message(level: String, message: String) {
    eprintln!("[webview:{level}] {message}");
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
