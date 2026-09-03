#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(crate) use self::windows::*;

#[cfg(not(windows))]
pub(crate) fn start_windows_audio_focus_watcher(_app: tauri::AppHandle) {}

#[cfg(not(windows))]
pub(crate) fn start_windows_media_key_listener(_app: tauri::AppHandle) {}
