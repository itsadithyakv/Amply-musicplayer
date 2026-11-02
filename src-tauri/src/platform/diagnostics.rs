//! Technical details for a bug report: the Windows version, how Amply was installed, and the last
//! warnings in Amply's log. Nothing here is sent anywhere; the frontend shows it to the user, who
//! decides whether to include it.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;
use tauri::Manager;

/// Only the end of the log is read; a report needs the last few warnings, not the whole history.
const LOG_TAIL_BYTES: u64 = 24 * 1024;
const LOG_TAIL_LINES: usize = 40;
const LOG_TAIL_CHARS: usize = 6000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BugReportContext {
    /// "Windows 11 24H2 (build 26100.2894)", or "Windows" when the registry cannot be read.
    pub windows: String,
    /// "Microsoft Store" for an MSIX install, otherwise "Installer".
    pub install: String,
    /// The last log lines, with the user's profile folder replaced by `~`.
    pub log_tail: String,
}

/// Replaces `C:\Users\<name>` (in either slash direction) with `~`, so a log line or error that
/// mentions a music file does not carry the user's Windows account name.
pub(crate) fn scrub_user_paths(text: &str) -> String {
    static PROFILE: OnceLock<Regex> = OnceLock::new();
    // An account name can contain spaces, so inside a path it runs to the next slash; a bare
    // profile folder at the end of a message stops at the first space.
    let profile = PROFILE.get_or_init(|| {
        Regex::new(r#"(?i)\b[a-z]:[\\/]+users[\\/]+(?:[^\\/\r\n"'<>|:*?]+(?P<sep>[\\/])|[^\\/\s"'<>|:*?]+)"#).expect("valid regex")
    });
    profile.replace_all(text, "~$sep").into_owned()
}

/// The last `max_lines` lines of `text`, capped at `max_chars` from the end.
fn last_lines(text: &str, max_lines: usize, max_chars: usize) -> String {
    let lines: Vec<&str> = text.lines().filter(|line| !line.trim().is_empty()).collect();
    let start = lines.len().saturating_sub(max_lines);
    let joined = lines[start..].join("\n");
    if joined.chars().count() <= max_chars {
        return joined;
    }
    let skip = joined.chars().count() - max_chars;
    joined.chars().skip(skip).collect()
}

fn read_log_tail(path: &Path) -> String {
    let Ok(mut file) = File::open(path) else {
        return String::new();
    };
    let len = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    if file.seek(SeekFrom::Start(len.saturating_sub(LOG_TAIL_BYTES))).is_err() {
        return String::new();
    }
    let mut bytes = Vec::new();
    if file.read_to_end(&mut bytes).is_err() {
        return String::new();
    }
    let text = String::from_utf8_lossy(&bytes);
    scrub_user_paths(&last_lines(&text, LOG_TAIL_LINES, LOG_TAIL_CHARS))
}

/// Builds 22000 and later are Windows 11, although the registry still says "Windows 10".
fn windows_label(build: Option<u32>, update: Option<u32>, display_version: Option<String>) -> String {
    let Some(build) = build else {
        return "Windows".to_string();
    };
    let name = if build >= 22000 { "Windows 11" } else { "Windows 10" };
    let version = display_version.map(|value| format!(" {value}")).unwrap_or_default();
    match update {
        Some(update) => format!("{name}{version} (build {build}.{update})"),
        None => format!("{name}{version} (build {build})"),
    }
}

#[cfg(windows)]
fn windows_version() -> String {
    use windows::core::{w, PCWSTR};
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_LOCAL_MACHINE, RRF_RT_REG_DWORD, RRF_RT_REG_SZ};

    const KEY: PCWSTR = w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");

    let read_string = |name: PCWSTR| -> Option<String> {
        let mut buffer = [0u16; 64];
        let mut size = std::mem::size_of_val(&buffer) as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                KEY,
                name,
                RRF_RT_REG_SZ,
                None,
                Some(buffer.as_mut_ptr() as *mut core::ffi::c_void),
                Some(&mut size),
            )
        };
        if status.is_err() {
            return None;
        }
        let end = buffer.iter().position(|&unit| unit == 0).unwrap_or(buffer.len());
        Some(String::from_utf16_lossy(&buffer[..end])).filter(|value| !value.is_empty())
    };
    let read_dword = |name: PCWSTR| -> Option<u32> {
        let mut value = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                KEY,
                name,
                RRF_RT_REG_DWORD,
                None,
                Some(&mut value as *mut u32 as *mut core::ffi::c_void),
                Some(&mut size),
            )
        };
        status.is_ok().then_some(value)
    };

    let build = read_string(w!("CurrentBuild")).and_then(|value| value.parse().ok());
    windows_label(build, read_dword(w!("UBR")), read_string(w!("DisplayVersion")))
}

#[cfg(not(windows))]
fn windows_version() -> String {
    std::env::consts::OS.to_string()
}

#[tauri::command]
pub async fn bug_report_context(app: tauri::AppHandle) -> BugReportContext {
    let log_path = app.path().app_log_dir().ok().map(|dir| dir.join("amply.log"));
    tauri::async_runtime::spawn_blocking(move || BugReportContext {
        windows: windows_version(),
        install: if super::store_review::is_packaged() { "Microsoft Store" } else { "Installer" }.to_string(),
        log_tail: log_path.as_deref().map(read_log_tail).unwrap_or_default(),
    })
    .await
    .unwrap_or_else(|_| BugReportContext {
        windows: "Windows".to_string(),
        install: "Unknown".to_string(),
        log_tail: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrubs_profile_folders_in_both_slash_directions() {
        let line = r"failed to read C:\Users\Adi Kumar\Music\a.mp3 and c:/users/adi/Music/b.flac";
        assert_eq!(scrub_user_paths(line), r"failed to read ~\Music\a.mp3 and ~/Music/b.flac");
        assert_eq!(scrub_user_paths(r"home is C:\Users\adi now"), "home is ~ now");
        assert_eq!(scrub_user_paths(r"D:\Music\c.mp3"), r"D:\Music\c.mp3");
    }

    #[test]
    fn keeps_only_the_last_lines() {
        let text = "one\n\ntwo\nthree\nfour\n";
        assert_eq!(last_lines(text, 2, 100), "three\nfour");
        assert_eq!(last_lines(text, 10, 4), "four");
    }

    #[test]
    fn names_windows_from_the_build_number() {
        assert_eq!(windows_label(Some(26100), Some(2894), Some("24H2".into())), "Windows 11 24H2 (build 26100.2894)");
        assert_eq!(windows_label(Some(19045), None, None), "Windows 10 (build 19045)");
        assert_eq!(windows_label(None, None, None), "Windows");
    }
}
