//! Windows' system media controls (SMTC): the media flyout that appears with the volume keys and on
//! the lock screen, and the taskbar thumbnail buttons. Windows routes the media keys to the active
//! media session, so with SMTC in place Amply needs no global keyboard hook, and pressing play on a
//! keyboard no longer also reaches Spotify or a browser.
//!
//! Both surfaces are fed by one command, `media_controls_update`, and report back through the
//! events the frontend already handles: `amply://media-key` and `amply://media-seek`.

use serde::{Deserialize, Serialize};

use crate::error::AmplyResult;

/// What is playing, as the frontend reports it. `None` means nothing is loaded.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct NowPlaying {
    pub song_id: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    /// An artwork-store URL or an https URL; anything else is ignored.
    pub artwork: Option<String>,
    pub playing: bool,
    pub position_sec: f64,
    pub duration_sec: f64,
    /// Localised tooltips for the taskbar buttons.
    pub labels: ButtonLabels,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ButtonLabels {
    pub previous: String,
    pub play: String,
    pub pause: String,
    pub next: String,
}

impl Default for ButtonLabels {
    fn default() -> Self {
        Self {
            previous: "Previous".to_string(),
            play: "Play".to_string(),
            pause: "Pause".to_string(),
            next: "Next".to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
struct MediaKeyEvent {
    action: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaSeekEvent {
    position_sec: f64,
}

pub(crate) fn emit_media_action(app: &tauri::AppHandle, action: &'static str) {
    use tauri::Emitter;
    if let Err(error) = app.emit("amply://media-key", MediaKeyEvent { action }) {
        log::warn!("Failed to emit media-key event: {error}");
    }
}

#[cfg(windows)]
mod imp {
    use std::sync::{Mutex, OnceLock};

    use tauri::{Emitter, Manager};
    use windows::core::HSTRING;
    use windows::Foundation::{TimeSpan, TypedEventHandler, Uri};
    use windows::Media::{
        MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs, SystemMediaTransportControls,
        SystemMediaTransportControlsButton, SystemMediaTransportControlsButtonPressedEventArgs,
        SystemMediaTransportControlsTimelineProperties,
    };
    use windows::Storage::StorageFile;
    use windows::Storage::Streams::RandomAccessStreamReference;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::WinRT::ISystemMediaTransportControlsInterop;

    use super::{emit_media_action, MediaSeekEvent, NowPlaying};

    static CONTROLS: OnceLock<SystemMediaTransportControls> = OnceLock::new();

    /// The song and artwork last shown, so a position update does not reload the cover.
    #[derive(Default)]
    struct Shown {
        song_id: String,
        artwork: Option<String>,
    }
    static SHOWN: Mutex<Option<Shown>> = Mutex::new(None);

    fn ticks(seconds: f64) -> TimeSpan {
        // TimeSpan counts 100 ns ticks.
        TimeSpan { Duration: (seconds.max(0.0) * 10_000_000.0) as i64 }
    }

    fn button_action(button: SystemMediaTransportControlsButton) -> Option<&'static str> {
        match button {
            SystemMediaTransportControlsButton::Play => Some("play"),
            SystemMediaTransportControlsButton::Pause => Some("pause"),
            SystemMediaTransportControlsButton::Stop => Some("stop"),
            SystemMediaTransportControlsButton::Next => Some("next"),
            SystemMediaTransportControlsButton::Previous => Some("previous"),
            _ => None,
        }
    }

    fn create(app: tauri::AppHandle, hwnd: HWND) -> windows::core::Result<SystemMediaTransportControls> {
        let interop = windows::core::factory::<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>()?;
        let controls: SystemMediaTransportControls = unsafe { interop.GetForWindow(hwnd)? };
        controls.SetIsEnabled(true)?;
        controls.SetIsPlayEnabled(true)?;
        controls.SetIsPauseEnabled(true)?;
        controls.SetIsStopEnabled(true)?;
        controls.SetIsNextEnabled(true)?;
        controls.SetIsPreviousEnabled(true)?;
        controls.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;

        let buttons_app = app.clone();
        controls.ButtonPressed(&TypedEventHandler::new(
            move |_: &Option<SystemMediaTransportControls>, args: &Option<SystemMediaTransportControlsButtonPressedEventArgs>| {
                if let Some(action) = args.as_ref().map(|args| args.Button()).transpose()?.and_then(button_action) {
                    emit_media_action(&buttons_app, action);
                }
                Ok(())
            },
        ))?;
        controls.PlaybackPositionChangeRequested(&TypedEventHandler::new(
            move |_: &Option<SystemMediaTransportControls>, args: &Option<PlaybackPositionChangeRequestedEventArgs>| {
                if let Some(args) = args {
                    let position_sec = args.RequestedPlaybackPosition()?.Duration as f64 / 10_000_000.0;
                    if let Err(error) = app.emit("amply://media-seek", MediaSeekEvent { position_sec }) {
                        log::warn!("Failed to emit media-seek event: {error}");
                    }
                }
                Ok(())
            },
        ))?;
        Ok(controls)
    }

    /// Creates the controls for the main window. Must run on the main thread, which owns the window.
    pub(crate) fn init(app: &tauri::AppHandle) -> bool {
        let Some(hwnd) = app.get_webview_window("main").and_then(|window| window.hwnd().ok()) else {
            return false;
        };
        match create(app.clone(), HWND(hwnd.0)) {
            Ok(controls) => CONTROLS.set(controls).is_ok(),
            Err(error) => {
                log::warn!("System media controls unavailable, falling back to the keyboard hook: {error}");
                false
            }
        }
    }

    fn thumbnail(artwork: &str) -> windows::core::Result<Option<RandomAccessStreamReference>> {
        if let Some(path) = crate::artwork::file_for_url(artwork) {
            let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path.as_os_str()))?.get()?;
            return RandomAccessStreamReference::CreateFromFile(&file).map(Some);
        }
        if artwork.starts_with("https://") {
            let uri = Uri::CreateUri(&HSTRING::from(artwork))?;
            return RandomAccessStreamReference::CreateFromUri(&uri).map(Some);
        }
        Ok(None)
    }

    /// Shows `state` in the flyout. Blocking: loading a cover waits on a WinRT file lookup.
    pub(crate) fn update(state: Option<&NowPlaying>) -> windows::core::Result<()> {
        let Some(controls) = CONTROLS.get() else {
            return Ok(());
        };
        let updater = controls.DisplayUpdater()?;
        let mut shown = SHOWN.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(state) = state else {
            updater.ClearAll()?;
            updater.Update()?;
            controls.SetPlaybackStatus(MediaPlaybackStatus::Closed)?;
            *shown = None;
            return Ok(());
        };

        let previous = shown.get_or_insert_with(Shown::default);
        let song_changed = previous.song_id != state.song_id;
        let artwork_changed = previous.artwork != state.artwork;
        if song_changed || artwork_changed {
            // ClearAll drops the old cover too, so a song without one never shows its predecessor's.
            updater.ClearAll()?;
            updater.SetType(MediaPlaybackType::Music)?;
            let music = updater.MusicProperties()?;
            music.SetTitle(&HSTRING::from(state.title.as_str()))?;
            music.SetArtist(&HSTRING::from(state.artist.as_str()))?;
            music.SetAlbumTitle(&HSTRING::from(state.album.as_str()))?;
            if let Some(artwork) = state.artwork.as_deref() {
                match thumbnail(artwork) {
                    Ok(Some(reference)) => updater.SetThumbnail(&reference)?,
                    Ok(None) => {}
                    Err(error) => log::warn!("Media flyout cover {artwork} failed: {error}"),
                }
            }
            updater.Update()?;
            previous.song_id = state.song_id.clone();
            previous.artwork = state.artwork.clone();
        }

        controls.SetPlaybackStatus(if state.playing { MediaPlaybackStatus::Playing } else { MediaPlaybackStatus::Paused })?;
        if state.duration_sec > 0.0 {
            let timeline = SystemMediaTransportControlsTimelineProperties::new()?;
            timeline.SetStartTime(ticks(0.0))?;
            timeline.SetMinSeekTime(ticks(0.0))?;
            timeline.SetEndTime(ticks(state.duration_sec))?;
            timeline.SetMaxSeekTime(ticks(state.duration_sec))?;
            timeline.SetPosition(ticks(state.position_sec.min(state.duration_sec)))?;
            controls.UpdateTimelineProperties(&timeline)?;
        }
        Ok(())
    }
}

#[cfg(windows)]
pub(crate) use imp::init;

#[cfg(not(windows))]
pub(crate) fn init(_app: &tauri::AppHandle) -> bool {
    false
}

/// Shows the current song in Windows' media flyout and taskbar buttons; `None` clears them.
#[tauri::command]
pub async fn media_controls_update(app: tauri::AppHandle, state: Option<NowPlaying>) -> AmplyResult<()> {
    super::taskbar::update(&app, state.as_ref().map(|now| (now.playing, now.labels.clone())));
    #[cfg(windows)]
    {
        let result = tauri::async_runtime::spawn_blocking(move || imp::update(state.as_ref()))
            .await
            .map_err(|err| err.to_string())?;
        if let Err(error) = result {
            log::warn!("Updating the media flyout failed: {error}");
        }
    }
    #[cfg(not(windows))]
    let _ = (app, state);
    Ok(())
}
