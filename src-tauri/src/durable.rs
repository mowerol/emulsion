// SPDX-License-Identifier: GPL-3.0-or-later
//! Flushing a file to disk before it is renamed into place (backups, exports, sidecars).
//!
//! On macOS, Rust's `File::sync_all` is `fcntl(F_FULLFSYNC)` with no fallback, and some
//! filesystems refuse it: the SMB client answers ENOTSUP (issue #1, catalog backups to a NAS).
//! `sync` does what SQLite's `full_fsync` (os_unix.c) does: try F_FULLFSYNC and, if it fails,
//! fall back to a plain `fsync`, since a failure there means this filesystem can't flush the
//! drive's cache, not that the write failed. Local APFS keeps the full flush.

use std::fs::File;
use std::io;

/// Flush `file`'s data and metadata to the storage device, as fully as its filesystem allows.
pub fn sync(file: &File) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        use std::sync::atomic::{AtomicBool, Ordering};
        static WARNED: AtomicBool = AtomicBool::new(false);
        let Err(full) = file.sync_all() else { return Ok(()) };
        loop {
            if unsafe { libc::fsync(file.as_raw_fd()) } == 0 {
                break;
            }
            let e = io::Error::last_os_error();
            if e.kind() != io::ErrorKind::Interrupted {
                return Err(e);
            }
        }
        if !WARNED.swap(true, Ordering::Relaxed) {
            eprintln!("[sync] full flush not supported here ({full}); used fsync instead");
        }
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flushes_an_ordinary_file() {
        let path = std::env::temp_dir().join(format!("emulsion-durable-{}", std::process::id()));
        let mut f = File::create(&path).unwrap();
        io::Write::write_all(&mut f, b"probe").unwrap();
        sync(&f).unwrap();
        let _ = std::fs::remove_file(path);
    }

    /// `/dev/null` refuses F_FULLFSYNC (ENODEV) but accepts fsync, as an SMB share does (ENOTSUP).
    #[cfg(target_os = "macos")]
    #[test]
    fn falls_back_to_fsync_where_a_full_flush_is_refused() {
        let f = std::fs::OpenOptions::new().write(true).open("/dev/null").unwrap();
        assert!(f.sync_all().is_err(), "the fixture no longer refuses F_FULLFSYNC");
        sync(&f).unwrap();
    }
}
