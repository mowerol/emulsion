// SPDX-License-Identifier: GPL-3.0-or-later
//! The log file testers attach to a report: `~/Library/Logs/app.emulsion.desktop/Emulsion.log`.
//!
//! Everything the app writes to stderr goes through a pipe to a thread that stamps each line with
//! the local time and appends it to the file, and also passes it on to the original stderr, so
//! `tauri dev` and `tools/perf` still see it. That covers our `eprintln!`s, the webview's errors
//! (`log_message`), and what native libraries (LibRaw, ONNX Runtime) print. A panic is written
//! straight to the file by the panic hook, because a release build aborts before the thread could
//! copy it. A crash in native code (a signal, not a panic) leaves macOS's own report in
//! `~/Library/Logs/DiagnosticReports`.
//!
//! The file is moved to `Emulsion.old.log` when it passes `MAX_BYTES`, at launch or while running,
//! so the two together stay under twice that.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::fd::FromRawFd;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const FILE_NAME: &str = "Emulsion.log";
const OLD_NAME: &str = "Emulsion.old.log";
const MAX_BYTES: u64 = 8 * 1024 * 1024;

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

/// The log file, once `install` has run.
pub fn path() -> Option<&'static Path> {
    LOG_PATH.get().map(PathBuf::as_path)
}

/// Starts logging into `dir`. Called once, first thing in setup; a failure leaves stderr as it was.
pub fn install(dir: &Path, version: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(FILE_NAME);
    rotate_if_large(&path)?;
    let mut file = open_append(&path)?;
    file.write_all(session_header(version).as_bytes())?;
    let _ = LOG_PATH.set(path.clone());

    // SAFETY: plain descriptor calls; every result is checked before the descriptor is used.
    let (read_fd, original) = unsafe {
        let mut fds = [0; 2];
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            return Err(std::io::Error::last_os_error());
        }
        let original = libc::dup(libc::STDERR_FILENO);
        if original < 0 || libc::dup2(fds[1], libc::STDERR_FILENO) < 0 {
            let e = std::io::Error::last_os_error();
            libc::close(fds[0]);
            libc::close(fds[1]);
            if original >= 0 {
                libc::close(original);
            }
            return Err(e);
        }
        libc::close(fds[1]);
        (fds[0], original)
    };
    // SAFETY: both descriptors were just made above and are owned only here.
    let (pipe, original) = unsafe { (File::from_raw_fd(read_fd), File::from_raw_fd(original)) };
    install_panic_hook(original.try_clone().ok());
    std::thread::Builder::new()
        .name("applog".into())
        .spawn(move || copy_lines(pipe, original, file, path))?;
    Ok(())
}

/// Copies each stderr line to the terminal and, stamped, to the file.
fn copy_lines(pipe: File, mut terminal: File, mut file: File, path: PathBuf) {
    let mut reader = BufReader::new(pipe);
    let mut line = Vec::new();
    let mut written = file.metadata().map(|m| m.len()).unwrap_or(0);
    loop {
        line.clear();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let _ = terminal.write_all(&line);
        let stamped = stamp(&String::from_utf8_lossy(&line));
        if written + stamped.len() as u64 > MAX_BYTES {
            if let Ok(fresh) = rotate(&path).and_then(|()| open_append(&path)) {
                file = fresh;
                written = 0;
            }
        }
        if file.write_all(stamped.as_bytes()).is_ok() {
            written += stamped.len() as u64;
        }
    }
}

/// Writes a panic to the file (and the terminal) in one write, from its own file handle: the
/// copying thread may be the one panicking, and a release build aborts right after the hook.
fn install_panic_hook(terminal: Option<File>) {
    std::panic::set_hook(Box::new(move |info| {
        let thread = std::thread::current();
        let report = panic_report(
            thread.name().unwrap_or("unnamed"),
            &info.payload_as_str().unwrap_or("(no message)"),
            info.location().map(|l| format!("{}:{}", l.file(), l.line())).as_deref(),
            &std::backtrace::Backtrace::force_capture().to_string(),
        );
        if let Some(path) = path() {
            if let Ok(mut f) = open_append(path) {
                let _ = f.write_all(report.as_bytes());
            }
        }
        if let Some(mut t) = terminal.as_ref() {
            let _ = t.write_all(report.as_bytes());
        }
    }));
}

fn panic_report(thread: &str, message: &str, location: Option<&str>, backtrace: &str) -> String {
    let at = location.map(|l| format!(" at {l}")).unwrap_or_default();
    let mut out = stamp(&format!("PANIC in thread '{thread}'{at}: {message}"));
    for l in backtrace.lines() {
        out.push_str("    ");
        out.push_str(l);
        out.push('\n');
    }
    out
}

fn session_header(version: &str) -> String {
    let os = std::process::Command::new("sw_vers")
        .arg("-productVersion")
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".into());
    let build = if cfg!(debug_assertions) { "dev" } else { "release" };
    stamp(&format!(
        "=== Emulsion {version} ({build}) started on macOS {os} {}, pid {}",
        std::env::consts::ARCH,
        std::process::id()
    ))
}

fn open_append(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

fn rotate_if_large(path: &Path) -> std::io::Result<()> {
    match std::fs::metadata(path) {
        Ok(m) if m.len() > MAX_BYTES => rotate(path),
        _ => Ok(()),
    }
}

fn rotate(path: &Path) -> std::io::Result<()> {
    std::fs::rename(path, path.with_file_name(OLD_NAME))
}

/// `2026-11-11 14:03:22.123 message\n`, in local time.
fn stamp(message: &str) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{} {}\n", local_time(now.as_secs() as i64, now.subsec_millis()), message.trim_end_matches(['\n', '\r']))
}

fn local_time(secs: i64, millis: u32) -> String {
    // SAFETY: localtime_r writes only into `tm`.
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    let t = secs as libc::time_t;
    if unsafe { libc::localtime_r(&t, &mut tm) }.is_null() {
        return format!("@{secs}.{millis:03}");
    }
    format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}.{millis:03}",
        tm.tm_year + 1900,
        tm.tm_mon + 1,
        tm.tm_mday,
        tm.tm_hour,
        tm.tm_min,
        tm.tm_sec
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamps_one_line_with_local_time() {
        let s = stamp("hello\n");
        assert!(s.ends_with(" hello\n"), "{s:?}");
        assert_eq!(s.matches('\n').count(), 1);
        // YYYY-MM-DD HH:MM:SS.mmm
        let ts = &s[..23];
        assert!(ts.chars().enumerate().all(|(i, c)| match i {
            4 | 7 => c == '-',
            10 => c == ' ',
            13 | 16 => c == ':',
            19 => c == '.',
            _ => c.is_ascii_digit(),
        }), "{ts}");
    }

    #[test]
    fn panic_report_names_thread_place_and_indents_backtrace() {
        let r = panic_report("decode", "boom", Some("src/raw.rs:10"), "0: a\n1: b");
        assert!(r.contains("PANIC in thread 'decode' at src/raw.rs:10: boom\n"), "{r}");
        assert!(r.ends_with("    0: a\n    1: b\n"), "{r}");
    }

    #[test]
    fn large_log_moves_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, vec![b'x'; MAX_BYTES as usize + 1]).unwrap();
        rotate_if_large(&path).unwrap();
        assert!(!path.exists());
        assert!(dir.path().join(OLD_NAME).exists());
        std::fs::write(&path, b"small").unwrap();
        rotate_if_large(&path).unwrap();
        assert!(path.exists());
    }

    /// Runs `install` for real in a child test process (it takes over that process's stderr):
    /// stderr lines and a panic must both reach the file, stamped.
    #[test]
    fn stderr_and_panics_reach_the_file() {
        if let Ok(dir) = std::env::var("EMULSION_APPLOG_CHILD") {
            install(Path::new(&dir), "9.9.9").unwrap();
            eprintln!("from eprintln");
            unsafe { libc::write(libc::STDERR_FILENO, b"from native code\n".as_ptr().cast(), 17) };
            std::thread::sleep(std::time::Duration::from_millis(200));
            panic!("deliberate test panic");
        }
        let dir = tempfile::tempdir().unwrap();
        let out = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "applog::tests::stderr_and_panics_reach_the_file", "--nocapture", "--test-threads=1"])
            .env("EMULSION_APPLOG_CHILD", dir.path())
            .output()
            .unwrap();
        assert!(!out.status.success(), "the child should have panicked");
        let log = std::fs::read_to_string(dir.path().join(FILE_NAME)).unwrap();
        assert!(log.contains("=== Emulsion 9.9.9 ("), "{log}");
        assert!(log.contains(" from eprintln\n"), "{log}");
        assert!(log.contains(" from native code\n"), "{log}");
        assert!(log.contains("PANIC in thread "), "{log}");
        assert!(log.contains("deliberate test panic"), "{log}");
        // The terminal still gets the lines.
        assert!(String::from_utf8_lossy(&out.stderr).contains("from eprintln"));
    }
}
