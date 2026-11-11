// SPDX-License-Identifier: GPL-3.0-or-later
//! Emulsion desktop core: folders, decoding, thumbnails, sidecars and export.
//! Image processing itself runs on the GPU in the webview (see src/engine).

mod ai_masks;
mod ai_models;
mod app_data;
mod capture;
mod commands;
mod decode;
pub mod denoise;
pub mod inpaint;
mod inpaint_cache;
mod inpaint_commands;
mod jxl;
mod keywords;
mod noise_cache;
mod noiseprofiles;
mod export;
mod export_meta;
mod exposure;
mod library;
mod lens;
mod raw;
mod rawspeed_cameras;
mod presets;
mod perspective;
mod segment;
mod sky;
mod sky_commands;
mod sidecar;
mod thumbs;
mod user_looks;
mod xmp;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Paths macOS asked us to open (files or folders dropped on the Dock icon, or "Open With"),
/// kept until the interface takes them: a launch by drop delivers them before the page listens.
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Vec<String>>);

pub struct AppPaths {
    pub cache_dir: PathBuf,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingOpen::default())
        .setup(|app| {
            let cache_dir = app.path().app_cache_dir()?.join("thumbs");
            std::fs::create_dir_all(&cache_dir)?;
            app.manage(AppPaths { cache_dir });
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
        .invoke_handler(tauri::generate_handler![
            commands::native_text_edit,
            commands::auto_perspective,
            commands::scan_folder,
            commands::list_folder_photos,
            commands::photo_exposure,
            commands::catalog_metadata,
            commands::browse_directory,
            commands::computer_folders,
            commands::thumbnail,
            commands::cull_preview,
            commands::load_image,
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
            commands::embedded_metadata,
            commands::capture_info,
            commands::write_sidecar,
            commands::sidecar_history,
            commands::retag_keywords,
            commands::read_app_settings,
            commands::write_app_settings,
            commands::app_backups,
            commands::restore_app_backup,
            commands::export_app_settings,
            commands::import_app_settings,
            commands::show_app_backups,
            commands::write_export,
            commands::check_export_dir,
            commands::export_exists,
            commands::startup_options,
            commands::take_open_paths,
            commands::log_message,
            ai_masks::ai_mask_status,
            ai_masks::ai_mask_install,
            ai_masks::segment_encode,
            ai_masks::segment_decode,
            ai_masks::segment_refine,
            sky_commands::sky_mask_status,
            sky_commands::sky_mask_install,
            sky_commands::segment_sky,
            inpaint_commands::remove_status,
            inpaint_commands::remove_install,
            inpaint_commands::remove_inpaint,
            inpaint_commands::remove_cached_patch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Emulsion")
        .run(|app, event| match event {
            tauri::RunEvent::Exit => { noise_cache::shutdown(); ai_masks::shutdown(); sky_commands::shutdown(); inpaint_commands::shutdown(); }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                let paths: Vec<String> = urls.iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
                if paths.is_empty() { return; }
                app.state::<PendingOpen>().0.lock().unwrap().extend(paths);
                // The page drains the queue with take_open_paths; this only wakes it if it is listening.
                let _ = app.emit("open-paths", ());
                if let Some(w) = app.get_webview_window("main") { let _ = w.set_focus(); }
            }
            _ => {}
        });
}
