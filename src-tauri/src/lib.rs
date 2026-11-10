// SPDX-License-Identifier: GPL-3.0-or-later
//! Emulsion desktop core: folders, decoding, thumbnails, sidecars and export.
//! Image processing itself runs on the GPU in the webview (see src/engine).

mod ai_masks;
mod ai_models;
mod app_data;
mod camera_profiles;
mod capture;
mod commands;
mod decode;
pub mod denoise;
pub mod inpaint;
mod inpaint_cache;
mod inpaint_commands;
mod noise_cache;
mod noiseprofiles;
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
use tauri::Manager;

pub struct AppPaths {
    pub cache_dir: PathBuf,
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
            inpaint_commands::remove_status,
            inpaint_commands::remove_install,
            inpaint_commands::remove_inpaint,
            inpaint_commands::remove_cached_patch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Emulsion")
        .run(|_, event| { if matches!(event, tauri::RunEvent::Exit) { noise_cache::shutdown(); ai_masks::shutdown(); inpaint_commands::shutdown(); } });
}
