// SPDX-License-Identifier: GPL-3.0-or-later
//! Quitting goes through the interface, so it can save the catalog and, when a backup is due,
//! offer one first (Lightroom Classic's "Back Up Catalog" on exit).
//!
//! On macOS, ⌘Q, the Dock's Quit and logging out ask the application delegate
//! `applicationShouldTerminate:`. tao's delegate doesn't answer it, so the app would end at once.
//! `install` adds the method to tao's delegate class: until the interface approves, it cancels the
//! request and tells the page (`quit-requested`), which saves, asks about a backup, then calls
//! `quit_now`. Cancelling rather than answering "later" keeps the run loop in its normal mode, so
//! the webview and IPC keep working while the backup runs. A logout that arrives this way is
//! cancelled; the person logs out again once Emulsion has closed.
//!
//! If the page doesn't acknowledge within `ACK_WAIT` (it has crashed or hung), the app quits anyway.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static APP: OnceLock<AppHandle> = OnceLock::new();
static APPROVED: AtomicBool = AtomicBool::new(false);
static ACKED: AtomicBool = AtomicBool::new(false);
const ACK_WAIT: Duration = Duration::from_secs(4);

/// Ask the page to run its quit sequence; quit anyway if it doesn't answer.
pub fn request(app: &AppHandle) {
    ACKED.store(false, Ordering::SeqCst);
    let _ = app.emit("quit-requested", ());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(ACK_WAIT);
        if !ACKED.load(Ordering::SeqCst) && !APPROVED.load(Ordering::SeqCst) {
            eprintln!("[quit] the interface did not answer; quitting");
            quit(&app);
        }
    });
}

fn quit(app: &AppHandle) {
    APPROVED.store(true, Ordering::SeqCst);
    app.exit(0);
}

/// The page has started its quit sequence (it may show a dialog for as long as it likes).
#[tauri::command]
pub fn quit_ack() {
    ACKED.store(true, Ordering::SeqCst);
}

/// The page is done: quit for real.
#[tauri::command]
pub fn quit_now(app: AppHandle) {
    quit(&app);
}

/// After an update is installed and the page has saved: quit and start the new version.
#[tauri::command]
pub fn relaunch_now(app: AppHandle) {
    APPROVED.store(true, Ordering::SeqCst);
    app.request_restart();
}

#[cfg(target_os = "macos")]
pub fn install(app: &AppHandle) {
    use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
    use objc2::{ffi, sel};

    let _ = APP.set(app.clone());
    /// NSApplicationTerminateReply: NSTerminateCancel = 0, NSTerminateNow = 1.
    extern "C-unwind" fn should_terminate(_this: &AnyObject, _sel: Sel, _sender: *mut AnyObject) -> usize {
        if APPROVED.load(Ordering::SeqCst) {
            return 1;
        }
        match APP.get() {
            Some(app) => {
                request(app);
                0
            }
            None => 1,
        }
    }
    let Some(class) = AnyClass::get(c"TaoAppDelegateParent") else {
        eprintln!("[quit] tao's app delegate class was not found; quitting won't offer a backup");
        return;
    };
    // SAFETY: the class is tao's registered delegate class, which has no
    // applicationShouldTerminate: of its own (class_addMethod would refuse to replace one). The
    // function matches the selector's signature, `- (NSUInteger)m:(id)sender` = "Q@:@".
    let added = unsafe {
        let imp: Imp = std::mem::transmute(should_terminate as extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize);
        ffi::class_addMethod(class as *const AnyClass as *mut AnyClass, sel!(applicationShouldTerminate:), imp, c"Q@:@".as_ptr())
    };
    if !added.as_bool() {
        eprintln!("[quit] could not add applicationShouldTerminate:; quitting won't offer a backup");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
}
