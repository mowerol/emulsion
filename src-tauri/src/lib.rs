// SPDX-License-Identifier: GPL-3.0-or-later
//! Emulsion desktop core: folders, decoding, thumbnails, sidecars and export.
//! Image processing itself runs on the GPU in the webview (see src/engine).

mod camera_profiles;
mod capture;
mod commands;
mod decode;
mod export;
mod library;
mod lens;
mod raw;
mod sidecar;
mod thumbs;
mod user_looks;

use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

pub struct AppPaths {
    pub cache_dir: PathBuf,
}

/// The app menu. The standard Edit menu's Undo, Redo and Select All would take
/// those shortcuts before the webview sees them, so these send them to the
/// webview instead, which undoes edits and selects photos (or acts on a text
/// field when one has focus).
fn app_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let sep = || PredefinedMenuItem::separator(app);
    let about = Submenu::with_items(
        app,
        "Emulsion",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &MenuItem::with_id(app, "select-all", "Select All", true, Some("CmdOrCtrl+A"))?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&about, &edit, &window])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let cache_dir = app.path().app_cache_dir()?.join("thumbs");
            std::fs::create_dir_all(&cache_dir)?;
            app.manage(AppPaths { cache_dir });
            app.set_menu(app_menu(app.handle())?)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            // Undo, redo and select all are Emulsion's own, handled in the webview.
            let id = event.id().as_ref();
            if matches!(id, "undo" | "redo" | "select-all") {
                let _ = app.emit("menu", id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::thumbnail,
            commands::load_image,
            commands::camera_profiles,
            commands::read_camera_profile,
            commands::read_camera_profile_file,
            commands::install_camera_profile,
            commands::user_looks,
            commands::read_user_look,
            commands::read_user_look_file,
            commands::install_user_look,
            commands::save_user_profile,
            commands::delete_user_look,
            commands::white_points,
            commands::capture_info,
            commands::write_sidecar,
            commands::write_export,
            commands::startup_options,
            commands::log_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Emulsion");
}
