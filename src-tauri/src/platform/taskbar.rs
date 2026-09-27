//! Previous / play-pause / next buttons on the taskbar thumbnail, as Windows media players have.
//! Windows accepts the buttons only after it announces the taskbar button ("TaskbarButtonCreated")
//! and reports clicks as WM_COMMAND, so the main window is subclassed to hear both. Everything here
//! runs on the main thread, which owns the window and the COM taskbar object.

#[cfg(not(windows))]
use super::media_controls::ButtonLabels;

/// The shapes drawn on the buttons.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Glyph {
    Previous,
    Play,
    Pause,
    Next,
}

/// Anti-aliased coverage (0-255) of `glyph` on a `size` x `size` grid, row-major from the top.
/// Four-by-four supersampling per pixel; shapes are laid out on a unit square.
fn rasterize(glyph: Glyph, size: u32) -> Vec<u8> {
    fn triangle(x: f32, y: f32, a: (f32, f32), b: (f32, f32), c: (f32, f32)) -> bool {
        let side = |p: (f32, f32), q: (f32, f32)| (q.0 - p.0) * (y - p.1) - (q.1 - p.1) * (x - p.0);
        let (d1, d2, d3) = (side(a, b), side(b, c), side(c, a));
        !((d1 < 0.0 || d2 < 0.0 || d3 < 0.0) && (d1 > 0.0 || d2 > 0.0 || d3 > 0.0))
    }
    let rect = |x: f32, y: f32, x0: f32, x1: f32| (x0..=x1).contains(&x) && (0.2..=0.8).contains(&y);
    let inside = |x: f32, y: f32| match glyph {
        Glyph::Play => triangle(x, y, (0.3, 0.18), (0.3, 0.82), (0.82, 0.5)),
        Glyph::Pause => rect(x, y, 0.26, 0.42) || rect(x, y, 0.58, 0.74),
        Glyph::Next => triangle(x, y, (0.2, 0.2), (0.2, 0.8), (0.64, 0.5)) || rect(x, y, 0.66, 0.8),
        Glyph::Previous => triangle(x, y, (0.8, 0.2), (0.8, 0.8), (0.36, 0.5)) || rect(x, y, 0.2, 0.34),
    };
    const SAMPLES: u32 = 4;
    let size_f = size as f32;
    let mut coverage = Vec::with_capacity((size * size) as usize);
    for row in 0..size {
        for col in 0..size {
            let mut hits = 0u32;
            for sy in 0..SAMPLES {
                for sx in 0..SAMPLES {
                    let x = (col as f32 + (sx as f32 + 0.5) / SAMPLES as f32) / size_f;
                    let y = (row as f32 + (sy as f32 + 0.5) / SAMPLES as f32) / size_f;
                    hits += u32::from(inside(x, y));
                }
            }
            coverage.push((hits * 255 / (SAMPLES * SAMPLES)) as u8);
        }
    }
    coverage
}

#[cfg(windows)]
mod imp {
    use std::cell::RefCell;
    use std::sync::OnceLock;

    use tauri::Manager;
    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        CreateBitmap, CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HDC,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::Shell::{
        DefSubclassProc, ITaskbarList3, RemoveWindowSubclass, SetWindowSubclass, TaskbarList, THBF_DISABLED,
        THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateIconIndirect, DestroyIcon, RegisterWindowMessageW, HICON, ICONINFO, WM_COMMAND, WM_NCDESTROY,
        WM_SETTINGCHANGE,
    };

    use super::super::media_controls::{emit_media_action, ButtonLabels};
    use super::{rasterize, Glyph};

    const SUBCLASS_ID: usize = 0x414d_504c; // "AMPL"
    const ID_PREVIOUS: u32 = 1;
    const ID_PLAY_PAUSE: u32 = 2;
    const ID_NEXT: u32 = 3;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static TASKBAR_CREATED: OnceLock<u32> = OnceLock::new();

    struct Icons([HICON; 4]);

    impl Icons {
        fn get(&self, glyph: Glyph) -> HICON {
            self.0[glyph as usize]
        }
    }

    impl Drop for Icons {
        fn drop(&mut self) {
            for icon in self.0 {
                if !icon.is_invalid() {
                    let _ = unsafe { DestroyIcon(icon) };
                }
            }
        }
    }

    struct Taskbar {
        list: ITaskbarList3,
        hwnd: HWND,
        icons: Icons,
        added: bool,
        has_song: bool,
        playing: bool,
        labels: ButtonLabels,
    }

    thread_local! {
        static TASKBAR: RefCell<Option<Taskbar>> = const { RefCell::new(None) };
    }

    /// Whether Windows' taskbar and flyouts use the light theme; their thumbnail toolbars follow it.
    fn system_uses_light_theme() -> bool {
        let mut value = 0u32;
        let mut size = std::mem::size_of::<u32>() as u32;
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
                w!("SystemUsesLightTheme"),
                RRF_RT_REG_DWORD,
                None,
                Some(&mut value as *mut u32 as *mut core::ffi::c_void),
                Some(&mut size),
            )
        };
        status.is_ok() && value == 1
    }

    fn make_icon(glyph: Glyph, size: u32, rgb: (u8, u8, u8)) -> HICON {
        let coverage = rasterize(glyph, size);
        let header = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size as i32,
            biHeight: -(size as i32), // top-down rows, matching `rasterize`
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let info = BITMAPINFO { bmiHeader: header, ..Default::default() };
        unsafe {
            let mut bits: *mut core::ffi::c_void = std::ptr::null_mut();
            let Ok(color) = CreateDIBSection(HDC::default(), &info, DIB_RGB_COLORS, &mut bits, None, 0) else {
                return HICON::default();
            };
            let pixels = std::slice::from_raw_parts_mut(bits as *mut u8, coverage.len() * 4);
            for (pixel, alpha) in pixels.chunks_exact_mut(4).zip(coverage) {
                pixel.copy_from_slice(&[rgb.2, rgb.1, rgb.0, alpha]); // BGRA
            }
            // An all-zero mask: the colour bitmap's alpha channel decides transparency.
            let mask = CreateBitmap(size as i32, size as i32, 1, 1, None);
            let icon = CreateIconIndirect(&ICONINFO { fIcon: true.into(), hbmMask: mask, hbmColor: color, ..Default::default() })
                .unwrap_or_default();
            let _ = DeleteObject(color);
            let _ = DeleteObject(mask);
            icon
        }
    }

    fn make_icons(hwnd: HWND) -> Icons {
        // Small-icon size at the window's DPI: 16 px at 100 %, 32 px at 200 %.
        let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
        let size = (16 * dpi / 96).clamp(16, 64);
        let rgb = if system_uses_light_theme() { (0x1f, 0x1f, 0x1f) } else { (0xff, 0xff, 0xff) };
        Icons([Glyph::Previous, Glyph::Play, Glyph::Pause, Glyph::Next].map(|glyph| make_icon(glyph, size, rgb)))
    }

    fn button(id: u32, icon: HICON, tip: &str, enabled: bool) -> THUMBBUTTON {
        let mut tooltip = [0u16; 260];
        for (slot, unit) in tooltip.iter_mut().zip(tip.encode_utf16().take(259)) {
            *slot = unit;
        }
        THUMBBUTTON {
            dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
            iId: id,
            hIcon: icon,
            szTip: tooltip,
            dwFlags: if enabled { THBF_ENABLED } else { THBF_DISABLED },
            ..Default::default()
        }
    }

    impl Taskbar {
        fn buttons(&self) -> [THUMBBUTTON; 3] {
            let (glyph, tip) = if self.playing { (Glyph::Pause, &self.labels.pause) } else { (Glyph::Play, &self.labels.play) };
            [
                button(ID_PREVIOUS, self.icons.get(Glyph::Previous), &self.labels.previous, self.has_song),
                button(ID_PLAY_PAUSE, self.icons.get(glyph), tip, self.has_song),
                button(ID_NEXT, self.icons.get(Glyph::Next), &self.labels.next, self.has_song),
            ]
        }

        /// Adds the buttons the first time, updates them afterwards. Adding fails until the taskbar
        /// button exists; the TaskbarButtonCreated message then retries.
        fn sync(&mut self) {
            let buttons = self.buttons();
            let result = unsafe {
                if self.added {
                    self.list.ThumbBarUpdateButtons(self.hwnd, &buttons)
                } else {
                    self.list.ThumbBarAddButtons(self.hwnd, &buttons)
                }
            };
            match result {
                Ok(()) => self.added = true,
                Err(error) if self.added => log::warn!("Updating taskbar buttons failed: {error}"),
                Err(_) => {}
            }
        }
    }

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if Some(&message) == TASKBAR_CREATED.get() {
            // First announcement, or Explorer restarted and forgot the buttons.
            TASKBAR.with_borrow_mut(|taskbar| {
                if let Some(taskbar) = taskbar {
                    taskbar.added = false;
                    taskbar.sync();
                }
            });
        } else if message == WM_COMMAND && ((wparam.0 >> 16) & 0xffff) as u32 == THBN_CLICKED {
            let action = match (wparam.0 & 0xffff) as u32 {
                ID_PREVIOUS => Some("previous"),
                ID_PLAY_PAUSE => Some("playpause"),
                ID_NEXT => Some("next"),
                _ => None,
            };
            if let (Some(action), Some(app)) = (action, APP.get()) {
                emit_media_action(app, action);
                return LRESULT(0);
            }
        } else if message == WM_SETTINGCHANGE && lparam.0 != 0 {
            // Light/dark switch: redraw the glyphs in the new colour.
            let area = PCWSTR(lparam.0 as *const u16);
            if area.to_string().is_ok_and(|name| name == "ImmersiveColorSet") {
                TASKBAR.with_borrow_mut(|taskbar| {
                    if let Some(taskbar) = taskbar {
                        taskbar.icons = make_icons(hwnd);
                        taskbar.sync();
                    }
                });
            }
        } else if message == WM_NCDESTROY {
            let _ = RemoveWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID);
            TASKBAR.with_borrow_mut(|taskbar| *taskbar = None);
        }
        DefSubclassProc(hwnd, message, wparam, lparam)
    }

    /// Subclasses the main window and prepares the buttons. Must run on the main thread.
    pub(crate) fn init(app: &tauri::AppHandle) {
        let Some(raw) = app.get_webview_window("main").and_then(|window| window.hwnd().ok()) else {
            return;
        };
        let hwnd = HWND(raw.0);
        let _ = APP.set(app.clone());
        let _ = TASKBAR_CREATED.set(unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) });
        let list: ITaskbarList3 = match unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) } {
            Ok(list) => list,
            Err(error) => {
                log::warn!("Taskbar buttons unavailable: {error}");
                return;
            }
        };
        if let Err(error) = unsafe { list.HrInit() } {
            log::warn!("Taskbar buttons unavailable: {error}");
            return;
        }
        if !unsafe { SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0) }.as_bool() {
            log::warn!("Taskbar buttons unavailable: the window could not be subclassed");
            return;
        }
        let mut taskbar = Taskbar {
            list,
            hwnd,
            icons: make_icons(hwnd),
            added: false,
            has_song: false,
            playing: false,
            labels: ButtonLabels::default(),
        };
        // The taskbar button usually exists already by now; if not, the message above adds them.
        taskbar.sync();
        TASKBAR.with_borrow_mut(|slot| *slot = Some(taskbar));
    }

    /// Reflects the playback state on the buttons: `None` disables them (nothing loaded).
    pub(crate) fn update(app: &tauri::AppHandle, state: Option<(bool, ButtonLabels)>) {
        let result = app.run_on_main_thread(move || {
            TASKBAR.with_borrow_mut(|taskbar| {
                let Some(taskbar) = taskbar else {
                    return;
                };
                let (has_song, playing, labels) = match state {
                    Some((playing, labels)) => (true, playing, labels),
                    None => (false, false, taskbar.labels.clone()),
                };
                if taskbar.has_song == has_song && taskbar.playing == playing && taskbar.labels.play == labels.play {
                    return;
                }
                taskbar.has_song = has_song;
                taskbar.playing = playing;
                taskbar.labels = labels;
                taskbar.sync();
            });
        });
        if let Err(error) = result {
            log::warn!("Scheduling a taskbar button update failed: {error}");
        }
    }
}

#[cfg(windows)]
pub(crate) use imp::{init, update};

#[cfg(not(windows))]
pub(crate) fn init(_app: &tauri::AppHandle) {}

#[cfg(not(windows))]
pub(crate) fn update(_app: &tauri::AppHandle, _state: Option<(bool, ButtonLabels)>) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(coverage: &[u8], size: u32, x: u32, y: u32) -> u8 {
        coverage[(y * size + x) as usize]
    }

    #[test]
    fn glyphs_fill_their_shapes_and_leave_the_edges_clear() {
        let size = 32;
        let play = rasterize(Glyph::Play, size);
        assert_eq!(at(&play, size, 14, 16), 255, "centre of the play triangle");
        assert_eq!(at(&play, size, 1, 1), 0, "corner stays transparent");
        let pause = rasterize(Glyph::Pause, size);
        assert_eq!(at(&pause, size, 16, 16), 0, "gap between the pause bars");
        assert_eq!(at(&pause, size, 11, 16), 255);
        // Anti-aliasing: some edge pixels are partially covered.
        assert!(play.iter().any(|&alpha| alpha > 0 && alpha < 255));
    }

    #[test]
    fn previous_mirrors_next() {
        let size = 24;
        let next = rasterize(Glyph::Next, size);
        let previous = rasterize(Glyph::Previous, size);
        for y in 0..size {
            for x in 0..size {
                let diff = i16::from(at(&next, size, x, y)) - i16::from(at(&previous, size, size - 1 - x, y));
                assert!(diff.abs() <= 64, "({x},{y}) differs by {diff}");
            }
        }
    }
}
