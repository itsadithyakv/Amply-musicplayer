use std::{sync::OnceLock, thread, time::Duration};

use serde::Serialize;
use tauri::Emitter;

use windows::{
    core::Interface,
    Win32::{
        Media::Audio::{
            AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
            MMDeviceEnumerator, eMultimedia, eRender,
        },
        Foundation::{LPARAM, LRESULT, WPARAM},
        System::{
            Com::{CoCreateInstance, CoInitializeEx, COINIT_MULTITHREADED, CLSCTX_ALL},
            Threading::{GetCurrentProcessId, OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_NAME_WIN32},
        },
        UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowRect},
        Graphics::Gdi::{MonitorFromWindow, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST, MONITORINFO},
    },
};

use windows::Win32::UI::{
    Input::KeyboardAndMouse::{VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP},
    WindowsAndMessaging::{
        CallNextHookEx, HHOOK, KBDLLHOOKSTRUCT, SetWindowsHookExW, UnhookWindowsHookEx, GetMessageW, MSG, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_SYSKEYDOWN, HC_ACTION,
    },
};

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

pub(crate) fn start_windows_audio_focus_watcher(app: tauri::AppHandle) {
    thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(Some(std::ptr::null_mut()), COINIT_MULTITHREADED);
        }

        let current_pid = unsafe { GetCurrentProcessId() };
        let mut last_other_active: Option<bool> = None;
        let mut last_foreground_fullscreen: Option<bool> = None;
        let mut last_active_apps: Vec<String> = Vec::new();

        loop {
            let focus_state = (|| -> windows::core::Result<(bool, Vec<String>, bool)> {
                let enumerator: IMMDeviceEnumerator = unsafe {
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?
                };
                let device = unsafe {
                    enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?
                };
                let manager: IAudioSessionManager2 = unsafe {
                    device.Activate(CLSCTX_ALL, None)?
                };
                let sessions = unsafe {
                    manager.GetSessionEnumerator()?
                };
                let count = unsafe {
                    sessions.GetCount()?
                };
                let mut found = false;
                let mut active_apps: Vec<String> = Vec::new();

                for i in 0..count {
                    let session = unsafe {
                        sessions.GetSession(i)?
                    };
                    let control: IAudioSessionControl2 = session.cast()?;
                    let state = unsafe {
                        control.GetState()?
                    };
                    if state != AudioSessionStateActive {
                        continue;
                    }
                    let pid = unsafe {
                        control.GetProcessId()?
                    };
                    if pid == 0 || pid == current_pid {
                        continue;
                    }
                    let is_system_result = unsafe {
                        control.IsSystemSoundsSession()
                    };
                    if is_system_result.0 == 0 {
                        continue;
                    }
                    if let Some(name) = process_name_from_pid(pid) {
                        if !active_apps.contains(&name) {
                            active_apps.push(name);
                        }
                    }
                    found = true;
                }

                Ok((found, active_apps, is_foreground_fullscreen()))
            })();

            if let Ok((active, active_apps, foreground_fullscreen)) = focus_state {
                let apps_changed = active_apps != last_active_apps;
                let state_changed = last_other_active.map(|prev| prev != active).unwrap_or(true);
                let fullscreen_changed =
                    last_foreground_fullscreen.map(|prev| prev != foreground_fullscreen).unwrap_or(true);
                if state_changed || apps_changed || fullscreen_changed {
                    last_other_active = Some(active);
                    last_active_apps = active_apps.clone();
                    last_foreground_fullscreen = Some(foreground_fullscreen);
                    let _ = app.emit(
                        "amply://audio-focus",
                        AudioFocusEvent {
                            other_active: active,
                            active_apps,
                            foreground_fullscreen,
                        },
                    );
                }
            }

            thread::sleep(Duration::from_millis(800));
        }
    });
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
                        let _ = app.emit(
                            "amply://media-key",
                            MediaKeyEvent {
                                action: action.to_string(),
                            },
                        );
                    }
                }
            }
        }

        CallNextHookEx(HHOOK(std::ptr::null_mut()), code, w_param, l_param)
    }

    thread::spawn(move || unsafe {
        let _ = MEDIA_APP.set(app);
        let hook = match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
            Ok(hook) => hook,
            Err(_) => {
                eprintln!("Failed to install media key hook");
                return;
            }
        };
        if hook.is_invalid() {
            eprintln!("Failed to install media key hook");
            return;
        }

        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 != 0 {}

        let _ = UnhookWindowsHookEx(hook);
    });
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
        let _ = windows::Win32::Foundation::CloseHandle(handle);
        
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
        let mon_w = (info.rcMonitor.right - info.rcMonitor.left) as i32;
        let mon_h = (info.rcMonitor.bottom - info.rcMonitor.top) as i32;
        if mon_w <= 0 || mon_h <= 0 {
            return false;
        }
        let coverage_w = win_w as f32 / mon_w as f32;
        let coverage_h = win_h as f32 / mon_h as f32;
        coverage_w >= 0.95 && coverage_h >= 0.95
    }
}
