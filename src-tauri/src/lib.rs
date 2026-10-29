// SPDX-License-Identifier: GPL-3.0-or-later
//! Emulsion desktop core: folders, decoding, thumbnails, sidecars and export.
//! Image processing itself runs on the GPU in the webview (see src/engine).

mod commands;
mod decode;
mod export;
mod library;
mod raw;
mod sidecar;
mod thumbs;

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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_folder,
            commands::thumbnail,
            commands::load_image,
            commands::white_points,
            commands::write_sidecar,
            commands::write_export,
            commands::startup_options,
            commands::log_message,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Emulsion");
}
