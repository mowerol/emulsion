// SPDX-License-Identifier: GPL-3.0-or-later
//! Debug builds use a distinct Dock icon after Tauri installs its default at Ready.
use objc2::{AllocAnyThread, MainThreadMarker};
use objc2_app_kit::{NSApplication, NSImage};
use objc2_foundation::NSData;

pub fn install() {
    let Some(main_thread) = MainThreadMarker::new() else { return };
    let data = NSData::with_bytes(include_bytes!("../dev-icon.png"));
    let Some(icon) = NSImage::initWithData(NSImage::alloc(), &data) else { return };
    let app = NSApplication::sharedApplication(main_thread);
    unsafe { app.setApplicationIconImage(Some(&icon)) };
}
