use std::{
    thread::JoinHandle,
    time::{Duration, Instant},
};

#[cfg(windows)]
mod windows;
#[cfg(windows)]
pub(crate) use self::windows::*;

#[cfg(not(windows))]
pub(crate) fn start_windows_audio_focus_watcher(_app: tauri::AppHandle) {}

#[cfg(not(windows))]
pub(crate) fn start_windows_media_key_listener(_app: tauri::AppHandle) {}

/// Stops the platform helper threads. No-op where none are started.
#[cfg(not(windows))]
pub(crate) fn shutdown() {}

/// Joins `handle` if it finishes within `cap`; otherwise logs and detaches it so
/// process exit is never held hostage by a stuck helper thread.
pub(crate) fn join_with_timeout(name: &str, handle: Option<JoinHandle<()>>, cap: Duration) {
    let Some(handle) = handle else {
        return;
    };
    let deadline = Instant::now() + cap;
    while !handle.is_finished() {
        if Instant::now() >= deadline {
            log::warn!("{name} thread did not stop within {cap:?}; detaching");
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    if handle.join().is_err() {
        log::warn!("{name} thread panicked before exit");
    }
}
