use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicU32, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::Emitter;

use windows::{
    core::Interface,
    Win32::{
        Foundation::{LPARAM, LRESULT, WPARAM},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        Media::Audio::{
            eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2,
            IMMDeviceEnumerator, MMDeviceEnumerator,
        },
        System::{
            Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED},
            Threading::{
                GetCurrentProcessId, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
                PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect, PostThreadMessageW, WM_QUIT},
    },
};

use windows::Win32::UI::{
    Input::KeyboardAndMouse::{VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP},
    WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, SetWindowsHookExW, UnhookWindowsHookEx, HC_ACTION, HHOOK, KBDLLHOOKSTRUCT,
        MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
    },
};

use super::join_with_timeout;

/// How often the audio-session watcher polls.
const FOCUS_POLL_PERIOD: Duration = Duration::from_millis(800);
/// Sleep granularity inside the poll period so shutdown is noticed promptly.
const FOCUS_SLEEP_SLICE: Duration = Duration::from_millis(100);
const JOIN_CAP: Duration = Duration::from_secs(2);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioFocusEvent {
    other_active: bool,
    active_apps: Vec<String>,
    foreground_fullscreen: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaKeyEvent {
    action: String,
}

/// Handles to the two Windows helper threads plus the signals used to stop them.
pub(crate) struct PlatformThreads {
    shutdown: Arc<AtomicBool>,
    focus: Option<JoinHandle<()>>,
    media_thread_id: Arc<AtomicU32>,
    media: Option<JoinHandle<()>>,
}

impl PlatformThreads {
    fn new() -> Self {
        Self {
            shutdown: Arc::new(AtomicBool::new(false)),
            focus: None,
            media_thread_id: Arc::new(AtomicU32::new(0)),
            media: None,
        }
    }
}

static PLATFORM: Mutex<Option<PlatformThreads>> = Mutex::new(None);

fn platform() -> std::sync::MutexGuard<'static, Option<PlatformThreads>> {
    PLATFORM.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn start_windows_audio_focus_watcher(app: tauri::AppHandle) {
    let mut guard = platform();
    let threads = guard.get_or_insert_with(PlatformThreads::new);
    let shutdown = Arc::clone(&threads.shutdown);
    match thread::Builder::new()
        .name("amply-audio-focus".into())
        .spawn(move || audio_focus_loop(app, shutdown))
    {
        Ok(handle) => threads.focus = Some(handle),
        Err(error) => log::error!("Failed to start audio focus watcher: {error}"),
    }
}

pub(crate) fn start_windows_media_key_listener(app: tauri::AppHandle) {
    static MEDIA_APP: OnceLock<tauri::AppHandle> = OnceLock::new();

    unsafe extern "system" fn hook_proc(code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            let message = w_param.0 as u32;
            if message == WM_KEYDOWN || message == WM_SYSKEYDOWN {
                let info = *(l_param.0 as *const KBDLLHOOKSTRUCT);
                let action = match info.vkCode {
                    vk if vk == VK_MEDIA_PLAY_PAUSE.0 as u32 => Some("playpause"),
                    vk if vk == VK_MEDIA_NEXT_TRACK.0 as u32 => Some("next"),
                    vk if vk == VK_MEDIA_PREV_TRACK.0 as u32 => Some("previous"),
                    vk if vk == VK_MEDIA_STOP.0 as u32 => Some("stop"),
                    _ => None,
                };
                if let Some(action) = action {
                    if let Some(app) = MEDIA_APP.get() {
                        if let Err(error) = app.emit(
                            "amply://media-key",
                            MediaKeyEvent {
                                action: action.to_string(),
                            },
                        ) {
                            log::warn!("Failed to emit media-key event: {error}");
                        }
                    }
                }
            }
        }

        CallNextHookEx(HHOOK(std::ptr::null_mut()), code, w_param, l_param)
    }

    let mut guard = platform();
    let threads = guard.get_or_insert_with(PlatformThreads::new);
    let thread_id = Arc::clone(&threads.media_thread_id);
    let spawned = thread::Builder::new()
        .name("amply-media-keys".into())
        .spawn(move || unsafe {
            let _ = MEDIA_APP.set(app);
            // Recorded before the hook so `shutdown()` can post WM_QUIT to this queue.
            thread_id.store(GetCurrentThreadId(), Ordering::SeqCst);
            let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
                Ok(hook) => hook,
                Err(error) => {
                    log::error!("Failed to install media key hook: {error}");
                    return;
                }
            };
            if hook.is_invalid() {
                log::error!("Failed to install media key hook: invalid hook handle");
                return;
            }

            // GetMessageW returns 0 on WM_QUIT and -1 on error; both end the loop.
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}

            if let Err(error) = UnhookWindowsHookEx(hook) {
                log::warn!("Failed to remove media key hook: {error}");
            }
        });
    match spawned {
        Ok(handle) => threads.media = Some(handle),
        Err(error) => log::error!("Failed to start media key listener: {error}"),
    }
}

/// Signals both helper threads to stop and joins them, each capped at 2 s.
pub(crate) fn shutdown() {
    let Some(mut threads) = platform().take() else {
        return;
    };
    threads.shutdown.store(true, Ordering::Relaxed);

    let media_tid = threads.media_thread_id.load(Ordering::SeqCst);
    if media_tid != 0 {
        // Makes GetMessageW return 0 so the hook is removed and the thread exits.
        if let Err(error) = unsafe { PostThreadMessageW(media_tid, WM_QUIT, WPARAM(0), LPARAM(0)) } {
            log::warn!("Failed to post WM_QUIT to the media key thread: {error}");
        }
    }

    join_with_timeout("audio focus watcher", threads.focus.take(), JOIN_CAP);
    join_with_timeout("media key listener", threads.media.take(), JOIN_CAP);
}

/// Sleeps for `total` in short slices so a shutdown request is noticed within ~100 ms.
fn sleep_interruptible(shutdown: &AtomicBool, total: Duration) {
    let deadline = Instant::now() + total;
    while !shutdown.load(Ordering::Relaxed) {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        thread::sleep(remaining.min(FOCUS_SLEEP_SLICE));
    }
}

fn audio_focus_loop(app: tauri::AppHandle, shutdown: Arc<AtomicBool>) {
    let com = unsafe { CoInitializeEx(Some(std::ptr::null_mut()), COINIT_MULTITHREADED) };
    if com.is_err() {
        log::warn!("CoInitializeEx failed on the audio focus thread: {com}");
    }

    let current_pid = unsafe { GetCurrentProcessId() };
    let mut last_other_active: Option<bool> = None;
    let mut last_foreground_fullscreen: Option<bool> = None;
    let mut last_active_apps: Vec<String> = Vec::new();
    // pid -> executable name; OpenProcess/QueryFullProcessImageNameW run once per pid.
    let mut process_names: HashMap<u32, String> = HashMap::new();

    while !shutdown.load(Ordering::Relaxed) {
        match poll_focus_state(current_pid, &mut process_names) {
            Ok((active, active_apps, foreground_fullscreen)) => {
                let apps_changed = active_apps != last_active_apps;
                let state_changed = last_other_active.map(|prev| prev != active).unwrap_or(true);
                let fullscreen_changed =
                    last_foreground_fullscreen.map(|prev| prev != foreground_fullscreen).unwrap_or(true);
                if state_changed || apps_changed || fullscreen_changed {
                    last_other_active = Some(active);
                    last_active_apps = active_apps.clone();
                    last_foreground_fullscreen = Some(foreground_fullscreen);
                    if let Err(error) = app.emit(
                        "amply://audio-focus",
                        AudioFocusEvent {
                            other_active: active,
                            active_apps,
                            foreground_fullscreen,
                        },
                    ) {
                        log::warn!("Failed to emit audio-focus event: {error}");
                    }
                }
            }
            Err(error) => log::debug!("Audio session enumeration failed: {error}"),
        }

        sleep_interruptible(&shutdown, FOCUS_POLL_PERIOD);
    }

    if com.is_ok() {
        unsafe { CoUninitialize() };
    }
}

/// One pass over the active audio sessions. Names are served from `process_names`;
/// pids that are no longer active are evicted so the cache tracks live sessions only.
fn poll_focus_state(
    current_pid: u32,
    process_names: &mut HashMap<u32, String>,
) -> windows::core::Result<(bool, Vec<String>, bool)> {
    let enumerator: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
    let device = unsafe { enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)? };
    let manager: IAudioSessionManager2 = unsafe { device.Activate(CLSCTX_ALL, None)? };
    let sessions = unsafe { manager.GetSessionEnumerator()? };
    let count = unsafe { sessions.GetCount()? };
    let mut found = false;
    let mut active_apps: Vec<String> = Vec::new();
    let mut seen_pids: HashSet<u32> = HashSet::new();

    for i in 0..count {
        let session = unsafe { sessions.GetSession(i)? };
        let control: IAudioSessionControl2 = session.cast()?;
        let state = unsafe { control.GetState()? };
        if state != AudioSessionStateActive {
            continue;
        }
        let pid = unsafe { control.GetProcessId()? };
        if pid == 0 || pid == current_pid {
            continue;
        }
        let is_system_result = unsafe { control.IsSystemSoundsSession() };
        if is_system_result.0 == 0 {
            continue;
        }
        seen_pids.insert(pid);
        let name = match process_names.get(&pid) {
            Some(name) => Some(name.clone()),
            None => {
                let looked_up = process_name_from_pid(pid);
                if let Some(name) = &looked_up {
                    process_names.insert(pid, name.clone());
                }
                looked_up
            }
        };
        if let Some(name) = name {
            if !active_apps.contains(&name) {
                active_apps.push(name);
            }
        }
        found = true;
    }

    process_names.retain(|pid, _| seen_pids.contains(pid));

    Ok((found, active_apps, is_foreground_fullscreen()))
}

fn process_name_from_pid(pid: u32) -> Option<String> {
    unsafe {
        let handle = match OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) {
            Ok(h) => h,
            Err(_) => return None,
        };
        let mut buffer = [0u16; 260];
        let mut size = buffer.len() as u32;

        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );
        if let Err(error) = windows::Win32::Foundation::CloseHandle(handle) {
            log::debug!("CloseHandle for pid {pid} failed: {error}");
        }

        if result.is_err() || size == 0 {
            return None;
        }
        let path = String::from_utf16_lossy(&buffer[..size as usize]);
        let name = std::path::Path::new(&path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_lowercase();
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    }
}

fn is_foreground_fullscreen() -> bool {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return false;
        }
        let mut rect = std::mem::MaybeUninit::uninit();
        if GetWindowRect(hwnd, rect.as_mut_ptr()).is_err() {
            return false;
        }
        let rect = rect.assume_init();
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.0.is_null() {
            return false;
        }
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(monitor, &mut info).as_bool() {
            return false;
        }
        let win_w = rect.right - rect.left;
        let win_h = rect.bottom - rect.top;
        let mon_w = info.rcMonitor.right - info.rcMonitor.left;
        let mon_h = info.rcMonitor.bottom - info.rcMonitor.top;
        if mon_w <= 0 || mon_h <= 0 {
            return false;
        }
        let coverage_w = win_w as f32 / mon_w as f32;
        let coverage_h = win_h as f32 / mon_h as f32;
        coverage_w >= 0.95 && coverage_h >= 0.95
    }
}
