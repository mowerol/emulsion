// SPDX-License-Identifier: GPL-3.0-or-later
//! Emulsion desktop core: folders, decoding, thumbnails, sidecars and export.
//! Image processing itself runs on the GPU in the webview (see src/engine).

mod ai_masks;
mod app_data;
mod camera_profiles;
mod capture;
mod commands;
mod decode;
pub mod denoise;
mod noise_cache;
mod export;
mod exposure;
mod library;
mod lens;
mod raw;
mod presets;
mod perspective;
mod segment;
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
            &MenuItem::with_id(app, "settings-export", "Export Settings…", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings-import", "Import Settings…", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings-restore", "Restore Settings from Backup…", true, None::<&str>)?,
            &MenuItem::with_id(app, "settings-show-backups", "Show Backups in Finder", true, None::<&str>)?,
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
            // darktable-style snapshots of looks, presets, profiles and settings: one a day, and
            // one before a version upgrade. Off the main thread; a failure only loses a snapshot.
            if let Ok(data) = app.path().app_data_dir() {
                let version = app.package_info().version.to_string();
                std::thread::spawn(move || match app_data::launch_snapshots(&data, &version, &app_data::today()) {
                    Ok(made) if !made.is_empty() => eprintln!("[backups] made {}", made.join(", ")),
                    Err(e) => eprintln!("[backups] snapshot failed: {e}"),
                    _ => {}
                });
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            // Undo, redo and select all are Emulsion's own, handled in the webview.
            let id = event.id().as_ref();
            if matches!(id, "undo" | "redo" | "select-all") || id.starts_with("settings-") {
                let _ = app.emit("menu", id);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::auto_perspective,
            commands::scan_folder,
            commands::photo_exposure,
            commands::catalog_metadata,
            commands::browse_directory,
            commands::computer_folders,
            commands::thumbnail,
            commands::load_image,
            commands::camera_profiles,
            commands::read_camera_profile,
            commands::read_camera_profile_file,
            commands::install_camera_profile,
            commands::custom_looks,
            commands::list_presets,
            commands::save_preset,
            commands::delete_preset,
            commands::read_preset_files,
            commands::read_look_lut,
            commands::read_lut_file,
            commands::store_look_lut,
            commands::save_custom_look,
            commands::delete_custom_look,
            commands::white_points,
            commands::capture_info,
            commands::write_sidecar,
            commands::sidecar_history,
            commands::read_app_settings,
            commands::write_app_settings,
            commands::app_backups,
            commands::restore_app_backup,
            commands::export_app_settings,
            commands::import_app_settings,
            commands::show_app_backups,
            commands::write_export,
            commands::startup_options,
            commands::log_message,
            ai_masks::ai_mask_status,
            ai_masks::ai_mask_install,
            ai_masks::segment_encode,
            ai_masks::segment_decode,
            ai_masks::segment_refine,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Emulsion")
        .run(|_, event| { if matches!(event, tauri::RunEvent::Exit) { noise_cache::shutdown(); ai_masks::shutdown(); } });
}
