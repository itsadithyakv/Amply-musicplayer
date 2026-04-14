#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read, Seek, Write},
    path::{Component, Path, PathBuf},
    sync::{mpsc, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use std::io::ErrorKind;
use std::f32::consts::PI;

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use lofty::{
    file::TaggedFile,
    prelude::{Accessor, AudioFile, TaggedFileExt},
    probe::Probe,
};
use serde::Serialize;
use tauri::{Emitter, Manager, WindowEvent};
use tauri::image::Image;
use tokio::fs as async_fs;
use walkdir::WalkDir;
use rusqlite::{params, Connection};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use rodio::cpal;
use rodio::cpal::traits::{DeviceTrait, HostTrait};

mod playlist;
mod metadata;
mod compute;

#[cfg(target_os = "windows")]
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

#[cfg(target_os = "windows")]
use windows::Win32::UI::{
    Input::KeyboardAndMouse::{VK_MEDIA_NEXT_TRACK, VK_MEDIA_PLAY_PAUSE, VK_MEDIA_PREV_TRACK, VK_MEDIA_STOP},
    WindowsAndMessaging::{
        CallNextHookEx, HHOOK, KBDLLHOOKSTRUCT, SetWindowsHookExW, UnhookWindowsHookEx, GetMessageW, MSG, WH_KEYBOARD_LL,
        WM_KEYDOWN, WM_SYSKEYDOWN, HC_ACTION,
    },
};


trait ReadSeek: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> ReadSeek for T {}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScannedSong {
    id: String,
    path: String,
    filename: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
    duration: f64,
    track: u32,
    year: Option<u32>,
    album_art: Option<String>,
    added_at: i64,
    play_count: u32,
    last_played: Option<i64>,
    favorite: bool,
    replay_gain: Option<f32>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StorageStats {
    storage_path: String,
    lyrics_files: usize,
    artist_files: usize,
    metadata_files: usize,
    playlists_files: usize,
    total_files: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OutputDeviceInfo {
    name: String,
    is_default: bool,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioFocusEvent {
    other_active: bool,
    active_apps: Vec<String>,
    foreground_fullscreen: bool,
}

#[cfg(target_os = "windows")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaKeyEvent {
    action: String,
}

const EQ_BAND_FREQUENCIES: [f32; 5] = [60.0, 250.0, 1000.0, 4000.0, 12000.0];

#[derive(Clone, Copy, Debug)]
struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

#[derive(Clone, Copy, Debug, Default)]
struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

struct BiquadSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,
    coeffs: BiquadCoeffs,
    states: Vec<BiquadState>,
    channels: usize,
    channel_index: usize,
}

impl<S> BiquadSource<S>
where
    S: Source<Item = f32>,
{
    fn new(inner: S, coeffs: BiquadCoeffs) -> Self {
        let channels = inner.channels().max(1) as usize;
        Self {
            inner,
            coeffs,
            states: vec![BiquadState::default(); channels],
            channels,
            channel_index: 0,
        }
    }
}

impl<S> Iterator for BiquadSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        let channel = self.channel_index;
        self.channel_index = (self.channel_index + 1) % self.channels;
        let state = &mut self.states[channel];

        let y = self.coeffs.b0 * sample
            + self.coeffs.b1 * state.x1
            + self.coeffs.b2 * state.x2
            - self.coeffs.a1 * state.y1
            - self.coeffs.a2 * state.y2;

        state.x2 = state.x1;
        state.x1 = sample;
        state.y2 = state.y1;
        state.y1 = y;

        Some(y)
    }
}

impl<S> Source for BiquadSource<S>
where
    S: Source<Item = f32>,
{
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }
}

#[derive(Clone)]
struct AudioState {
    sender: mpsc::Sender<AudioCommand>,
}

impl AudioState {
    fn new(sender: mpsc::Sender<AudioCommand>) -> Self {
        Self { sender }
    }
}

struct NativeAudio {
    stream: Option<OutputStream>,
    handle: Option<OutputStreamHandle>,
    sink: Option<Sink>,
    fading_sink: Option<Sink>,
    preloaded: HashMap<String, Vec<u8>>,
    current_path: Option<String>,
    duration_sec: f64,
    paused_position: f64,
    start_instant: Option<Instant>,
    is_playing: bool,
    loop_current: bool,
    device_name: Option<String>,
    eq_gains: [f32; 5],
    rate: f32,
    volume: f32,
    ended_emitted: bool,
    fade_in: Option<FadeState>,
    fade_out: Option<FadeState>,
}

impl Default for NativeAudio {
    fn default() -> Self {
        Self {
            stream: None,
            handle: None,
            sink: None,
            fading_sink: None,
            preloaded: HashMap::new(),
            current_path: None,
            duration_sec: 0.0,
            paused_position: 0.0,
            start_instant: None,
            is_playing: false,
            loop_current: false,
            device_name: None,
            eq_gains: [0.0; 5],
            rate: 1.0,
            volume: 0.85,
            ended_emitted: false,
            fade_in: None,
            fade_out: None,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct FadeState {
    start: Instant,
    duration: Duration,
    from: f32,
    to: f32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioProgress {
    position: f64,
    duration: f64,
}

enum AudioCommand {
    LoadSong {
        path: String,
        autoplay: bool,
        transition: bool,
        start_at_sec: f64,
        duration_sec: f64,
        crossfade_duration_sec: f64,
        crossfade: bool,
        track_volume: f32,
        gapless_enabled: bool,
        reply: mpsc::Sender<Result<(), String>>,
    },
    Play { reply: mpsc::Sender<Result<(), String>> },
    PlayFrom { position_sec: f64, reply: mpsc::Sender<Result<(), String>> },
    Pause { reply: mpsc::Sender<Result<(), String>> },
    Stop { reply: mpsc::Sender<Result<(), String>> },
    Seek { position_sec: f64, reply: mpsc::Sender<Result<(), String>> },
    SetVolume { volume: f32, reply: mpsc::Sender<Result<(), String>> },
    SetRate { rate: f32, reply: mpsc::Sender<Result<(), String>> },
    SetLoop { enabled: bool, reply: mpsc::Sender<Result<(), String>> },
    SetEqGains { gains: [f32; 5], reply: mpsc::Sender<Result<(), String>> },
    SetOutputDevice { name: Option<String>, reply: mpsc::Sender<Result<(), String>> },
    Preload { paths: Vec<String>, reply: mpsc::Sender<Result<(), String>> },
}

impl NativeAudio {
    fn new() -> Self {
        match OutputStream::try_default() {
            Ok((stream, handle)) => Self {
                stream: Some(stream),
                handle: Some(handle),
                sink: None,
                fading_sink: None,
                preloaded: HashMap::new(),
                current_path: None,
                duration_sec: 0.0,
                paused_position: 0.0,
                start_instant: None,
                is_playing: false,
                loop_current: false,
                    device_name: None,
                    eq_gains: [0.0; 5],
                    rate: 1.0,
                volume: 0.85,
                ended_emitted: false,
                fade_in: None,
                fade_out: None,
            },
            Err(error) => {
                eprintln!("[Amply] Failed to initialize audio output: {error}");
                Self::default()
            }
        }
    }

    fn ensure_handle(&self) -> Result<&OutputStreamHandle, String> {
        self.handle.as_ref().ok_or_else(|| "Audio output unavailable".to_string())
    }

    fn build_source(
        &self,
        path: &str,
        start_at_sec: f64,
        rate: f32,
        loop_current: bool,
        preloaded: &HashMap<String, Vec<u8>>,
    ) -> Result<Box<dyn Source<Item = f32> + Send>, String> {
        let reader: Box<dyn ReadSeek> = if let Some(data) = preloaded.get(path) {
            Box::new(Cursor::new(data.clone()))
        } else {
            let file = fs::File::open(path).map_err(|err| err.to_string())?;
            Box::new(std::io::BufReader::new(file))
        };

        let decoder = Decoder::new(reader).map_err(|err: rodio::decoder::DecoderError| err.to_string())?;
        let source = decoder
            .convert_samples::<f32>()
            .skip_duration(Duration::from_secs_f64(start_at_sec.max(0.0)))
            .speed(rate.max(0.25));

        let source = self.apply_eq(source);

        if loop_current {
            Ok(Box::new(source.repeat_infinite()))
        } else {
            Ok(source)
        }
    }

    fn create_sink(
        &self,
        path: &str,
        start_at_sec: f64,
        rate: f32,
        loop_current: bool,
        preloaded: &HashMap<String, Vec<u8>>,
    ) -> Result<Sink, String> {
        let handle = self.ensure_handle()?;
        let source = self.build_source(path, start_at_sec, rate, loop_current, preloaded)?;
        let sink = Sink::try_new(handle).map_err(|err| err.to_string())?;
        sink.append(source);
        Ok(sink)
    }

    fn current_position(&self) -> f64 {
        if self.sink.is_none() {
            return self.paused_position;
        }

        if self.is_playing {
            if let Some(started) = self.start_instant {
                return (self.paused_position + started.elapsed().as_secs_f64()).min(self.duration_sec);
            }
        }

        self.paused_position
    }

    fn apply_eq<S>(&self, source: S) -> Box<dyn Source<Item = f32> + Send>
    where
        S: Source<Item = f32> + Send + 'static,
    {
        if self.eq_gains.iter().all(|gain| gain.abs() < 0.01) {
            return Box::new(source);
        }

        let sample_rate = source.sample_rate();
        let mut current: Box<dyn Source<Item = f32> + Send> = Box::new(source);
        for (index, gain) in self.eq_gains.iter().enumerate() {
            if gain.abs() < 0.01 {
                continue;
            }
            if let Some(freq) = EQ_BAND_FREQUENCIES.get(index) {
                current = Box::new(BiquadSource::new(
                    current,
                    biquad_peaking(sample_rate, *freq, 1.0, *gain),
                ));
            }
        }
        current
    }

    fn rebuild_sink(&mut self, position: f64, was_playing: bool) -> Result<(), String> {
        let path = match self.current_path.clone() {
            Some(path) => path,
            None => return Ok(()),
        };

        self.clear_fading_sink();

        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        let sink = self.create_sink(&path, position, self.rate, self.loop_current, &self.preloaded)?;
        sink.set_volume(self.volume);
        if !was_playing {
            sink.pause();
        }

        self.sink = Some(sink);
        self.paused_position = position;
        self.start_instant = if was_playing { Some(Instant::now()) } else { None };
        self.is_playing = was_playing;
        self.ended_emitted = false;
        self.fade_in = None;
        Ok(())
    }

    fn clear_fading_sink(&mut self) {
        if let Some(sink) = self.fading_sink.take() {
            sink.stop();
        }
        self.fade_out = None;
    }

    fn tick(&mut self) {
        if let Some(fade) = self.fade_in {
            if let Some(sink) = self.sink.as_ref() {
                let elapsed = fade.start.elapsed();
                let t = (elapsed.as_secs_f32() / fade.duration.as_secs_f32()).min(1.0);
                let volume = fade.from + (fade.to - fade.from) * t;
                sink.set_volume(volume.max(0.0));
                if t >= 1.0 {
                    self.fade_in = None;
                }
            } else {
                self.fade_in = None;
            }
        }

        if let Some(fade) = self.fade_out {
            if let Some(sink) = self.fading_sink.as_ref() {
                let elapsed = fade.start.elapsed();
                let t = (elapsed.as_secs_f32() / fade.duration.as_secs_f32()).min(1.0);
                let volume = fade.from + (fade.to - fade.from) * t;
                sink.set_volume(volume.max(0.0));
                if t >= 1.0 {
                    sink.stop();
                    self.fading_sink = None;
                    self.fade_out = None;
                }
            } else {
                self.fade_out = None;
            }
        }
    }

    fn stop_all(&mut self) {
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        if let Some(sink) = self.fading_sink.take() {
            sink.stop();
        }
        self.is_playing = false;
        self.start_instant = None;
        self.paused_position = 0.0;
        self.ended_emitted = false;
        self.fade_in = None;
        self.fade_out = None;
    }

    fn load_song(
        &mut self,
        path: String,
        autoplay: bool,
        transition: bool,
        start_at_sec: f64,
        duration_sec: f64,
        crossfade_duration_sec: f64,
        crossfade: bool,
        track_volume: f32,
        gapless_enabled: bool,
    ) -> Result<(), String> {
        if self.handle.is_none() {
            return Err("Audio output unavailable".to_string());
        }

        let can_crossfade = transition && crossfade && self.sink.is_some();
        let fade_duration = Duration::from_secs_f64(crossfade_duration_sec.max(1.0));

        let gapless_ready = gapless_enabled && self.preloaded.contains_key(&path);
        if !can_crossfade && !gapless_ready {
            self.stop_all();
        } else if !can_crossfade {
            self.clear_fading_sink();
        } else if let Some(sink) = self.sink.take() {
            self.clear_fading_sink();
            self.fading_sink = Some(sink);
        }

        let sink = self.create_sink(&path, start_at_sec, self.rate, self.loop_current, &self.preloaded)?;
        let target_volume = if can_crossfade { 0.0 } else { track_volume };
        sink.set_volume(target_volume);

        if !autoplay {
            sink.pause();
        }

        if let Some(old) = self.fading_sink.as_ref() {
            let old_volume = old.volume();
            self.fade_out = Some(FadeState {
                start: Instant::now(),
                duration: fade_duration,
                from: old_volume,
                to: 0.0,
            });
        }

        if can_crossfade {
            self.fade_in = Some(FadeState {
                start: Instant::now(),
                duration: fade_duration,
                from: 0.0,
                to: track_volume,
            });
        }

        self.sink = Some(sink);
        self.current_path = Some(path);
        self.duration_sec = duration_sec.max(0.0);
        self.paused_position = start_at_sec.max(0.0);
        self.start_instant = if autoplay { Some(Instant::now()) } else { None };
        self.is_playing = autoplay;
        self.volume = track_volume;
        self.ended_emitted = false;
        if gapless_ready && !can_crossfade {
            if let Some(old) = self.fading_sink.take() {
                old.stop();
            }
        }
        Ok(())
    }

    fn play(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.play();
            self.start_instant = Some(Instant::now());
            self.is_playing = true;
        }
        Ok(())
    }

    fn play_from(&mut self, position_sec: f64) -> Result<(), String> {
        let path = self
            .current_path
            .clone()
            .ok_or_else(|| "No song loaded".to_string())?;

        self.clear_fading_sink();

        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        let sink = self.create_sink(&path, position_sec, self.rate, self.loop_current, &self.preloaded)?;
        sink.set_volume(self.volume);
        sink.play();
        self.sink = Some(sink);
        self.paused_position = position_sec.max(0.0);
        self.start_instant = Some(Instant::now());
        self.is_playing = true;
        self.ended_emitted = false;
        self.fade_in = None;
        self.fade_out = None;
        Ok(())
    }

    fn pause(&mut self) {
        if let Some(sink) = &self.sink {
            sink.pause();
        }
        self.clear_fading_sink();
        self.paused_position = self.current_position();
        self.start_instant = None;
        self.is_playing = false;
        self.fade_in = None;
    }

    fn stop(&mut self) {
        self.stop_all();
    }

    fn seek(&mut self, position_sec: f64) -> Result<(), String> {
        let path = self
            .current_path
            .clone()
            .ok_or_else(|| "No song loaded".to_string())?;
        let was_playing = self.is_playing;

        self.clear_fading_sink();

        if let Some(sink) = self.sink.take() {
            sink.stop();
        }

        let sink = self.create_sink(&path, position_sec, self.rate, self.loop_current, &self.preloaded)?;
        sink.set_volume(self.volume);
        if !was_playing {
            sink.pause();
        }

        self.sink = Some(sink);
        self.paused_position = position_sec.max(0.0);
        self.start_instant = if was_playing { Some(Instant::now()) } else { None };
        self.is_playing = was_playing;
        self.ended_emitted = false;
        self.fade_in = None;
        Ok(())
    }

    fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
        if let Some(sink) = &self.sink {
            sink.set_volume(volume);
        }
        if let Some(sink) = &self.fading_sink {
            sink.set_volume(volume);
        }
    }

    fn set_rate(&mut self, rate: f32) -> Result<(), String> {
        self.rate = rate.max(0.25);
        if self.sink.is_some() {
            let position = self.current_position();
            let was_playing = self.is_playing;
            self.rebuild_sink(position, was_playing)?;
        }
        Ok(())
    }

    fn set_loop(&mut self, enabled: bool) -> Result<(), String> {
        self.loop_current = enabled;
        if self.sink.is_some() {
            let position = self.current_position();
            let was_playing = self.is_playing;
            self.rebuild_sink(position, was_playing)?;
        }
        Ok(())
    }

    fn set_eq_gains(&mut self, gains: [f32; 5]) -> Result<(), String> {
        self.eq_gains = gains.map(|gain| gain.clamp(-12.0, 12.0));
        if self.sink.is_some() {
            let position = self.current_position();
            let was_playing = self.is_playing;
            self.rebuild_sink(position, was_playing)?;
        }
        Ok(())
    }

    fn set_output_device(&mut self, name: Option<String>) -> Result<(), String> {
        let host = cpal::default_host();
        let device = if let Some(target) = name.as_ref() {
            host.output_devices()
                .ok()
                .and_then(|mut devices| {
                    devices.find(|device| device.name().map(|value| value == *target).unwrap_or(false))
                })
                .or_else(|| host.default_output_device())
        } else {
            host.default_output_device()
        };

        let device = device.ok_or_else(|| "No output device available".to_string())?;
        let (stream, handle) = OutputStream::try_from_device(&device).map_err(|err| err.to_string())?;

        let position = self.current_position();
        let was_playing = self.is_playing;

        self.stream = Some(stream);
        self.handle = Some(handle);
        self.device_name = name;

        if self.sink.is_some() {
            self.rebuild_sink(position, was_playing)?;
        }

        Ok(())
    }
}

fn is_supported_audio(path: &Path) -> bool {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some(ext) => {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "mp3" | "mp4" | "m4a" | "aac" | "wav" | "flac" | "ogg" | "opus" | "aif" | "aiff" | "wma" | "webm"
            )
        }
        None => false,
    }
}

fn default_music_path() -> PathBuf {
    let cwd_music = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("music");

    if cwd_music.exists() {
        return cwd_music;
    }

    if let Some(music_dir) = dirs::audio_dir() {
        return music_dir;
    }

    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("music")
}

fn to_unix_secs(metadata: &fs::Metadata) -> i64 {
    metadata
        .created()
        .or_else(|_| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_else(|| {
            let now = std::time::SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs() as i64)
                .unwrap_or(0);
            now
        })
}

fn sanitize_id(path: &str) -> String {
    path.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect()
}

fn parse_replay_gain(input: Option<&str>) -> Option<f32> {
    let raw = input?.trim();
    let value = raw.replace("dB", "").trim().parse::<f32>().ok()?;
    Some(value)
}

fn extract_album_art(tagged_file: &TaggedFile) -> Option<String> {
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag())?;

    let picture = tag.pictures().first()?;

    // Avoid huge inlined payloads when scanning large libraries.
    if picture.data().len() > 300_000 {
        return None;
    }

    let mime = picture
        .mime_type()
        .map(|mime| mime.as_str().to_string())
        .unwrap_or_else(|| "image/jpeg".to_string());

    let encoded = BASE64_STANDARD.encode(picture.data());
    Some(format!("data:{};base64,{}", mime, encoded))
}

fn extract_text_metadata(tagged_file: &TaggedFile, filename_fallback: &str) -> (String, String, String, String, u32, Option<u32>, Option<f32>) {
    let tag = tagged_file
        .primary_tag()
        .or_else(|| tagged_file.first_tag());

    let title = tag
        .and_then(|entry| entry.title().map(|value| value.into_owned()))
        .unwrap_or_else(|| filename_fallback.to_string());

    let artist = tag
        .and_then(|entry| entry.artist().map(|value| value.into_owned()))
        .unwrap_or_else(|| "Unknown Artist".to_string());

    let album = tag
        .and_then(|entry| entry.album().map(|value| value.into_owned()))
        .unwrap_or_else(|| "Unknown Album".to_string());

    let genre = tag
        .and_then(|entry| entry.genre().map(|value| value.into_owned()))
        .unwrap_or_else(|| "Unknown Genre".to_string());

    let track = tag.and_then(|entry| entry.track()).unwrap_or(0);
    let year = tag.and_then(|entry| entry.year());

    let replay_gain = tag.and_then(|entry| {
        for item in entry.items() {
            let key = format!("{:?}", item.key()).to_ascii_lowercase();
            if key.contains("replaygain") {
                return parse_replay_gain(item.value().text());
            }
        }
        None
    });

    (title, artist, album, genre, track, year, replay_gain)
}

fn clean_title(raw: &str) -> String {
    let mut title = raw.to_string();
    if let Some((left, _)) = title.split_once(" - ") {
        title = left.to_string();
    }
    if let Some((left, _)) = title.split_once(" — ") {
        title = left.to_string();
    }
    if let Some((left, _)) = title.split_once(" | ") {
        title = left.to_string();
    }
    for (open, close) in [('[', ']'), ('(', ')'), ('{', '}')] {
        loop {
            let Some(start) = title.find(open) else { break };
            let Some(end) = title[start + 1..].find(close) else { break };
            let end = start + 1 + end;
            title.replace_range(start..=end, "");
        }
    }
    let lowered = title.to_lowercase();
    let cut = [" feat.", " ft.", " featuring ", " prod.", " produced by "]
        .iter()
        .filter_map(|token| lowered.find(token))
        .min();
    if let Some(idx) = cut {
        title = title[..idx].to_string();
    }
    let noise = [
        "official", "audio", "video", "lyrics", "lyric", "visualizer", "hq", "hd",
        "high quality", "remaster", "remastered", "instrumental", "acapella",
        "slowed", "reverb", "speed up", "sped up", "clean", "explicit",
    ];
    let lowered = title.to_lowercase();
    if let Some(pos) = noise.iter().filter_map(|token| lowered.find(token)).min() {
        title = title[..pos].to_string();
    }
    title
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn split_artist_title(raw: &str) -> Option<(String, String)> {
    let separators = [" - ", " – ", " — ", " -- "];
    for sep in separators {
        if let Some((left, right)) = raw.split_once(sep) {
            let artist = left.trim();
            let title = right.trim();
            if !artist.is_empty() && !title.is_empty() {
                return Some((artist.to_string(), clean_title(title)));
            }
        }
    }
    None
}

#[tauri::command]
async fn scan_music(folder: Option<String>) -> Result<Vec<ScannedSong>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let scan_root = folder
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from)
            .unwrap_or_else(default_music_path);

        if !scan_root.exists() {
            return Ok(Vec::new());
        }

        let mut songs: Vec<ScannedSong> = Vec::new();

        for entry in WalkDir::new(scan_root)
            .follow_links(true)
            .into_iter()
            .filter_map(Result::ok)
        {
            let path = entry.path();

            if !entry.file_type().is_file() || !is_supported_audio(path) {
                continue;
            }

            let metadata = match fs::metadata(path) {
                Ok(meta) => meta,
                Err(_) => continue,
            };

            let filename = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Unknown File")
                .to_string();

            let filename_no_ext = path
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Unknown Title");

            let (mut title, mut artist, mut album, genre, track, year, replay_gain, duration, album_art) =
                match Probe::open(path).and_then(|probe| probe.read()) {
                    Ok(tagged_file) => {
                        let (title, artist, album, genre, track, year, replay_gain) =
                            extract_text_metadata(&tagged_file, filename_no_ext);
                        let duration = tagged_file.properties().duration().as_secs_f64();
                        let album_art = extract_album_art(&tagged_file);
                        (title, artist, album, genre, track, year, replay_gain, duration, album_art)
                    }
                    Err(_) => (
                        filename_no_ext.to_string(),
                        "Unknown Artist".to_string(),
                        "Unknown Album".to_string(),
                        "Unknown Genre".to_string(),
                        0,
                        None,
                        None,
                        0.0,
                        None,
                    ),
                };

            if artist.trim().eq_ignore_ascii_case("unknown artist") || title.trim() == filename_no_ext {
                if let Some((parsed_artist, parsed_title)) = split_artist_title(filename_no_ext) {
                    if artist.trim().eq_ignore_ascii_case("unknown artist") {
                        artist = parsed_artist;
                    }
                    if title.trim() == filename_no_ext {
                        title = parsed_title;
                    }
                    if album.trim().eq_ignore_ascii_case("unknown album") {
                        album = "Single".to_string();
                    }
                }
            }

            let full_path = path.to_string_lossy().to_string();
            songs.push(ScannedSong {
                id: sanitize_id(&full_path),
                path: full_path,
                filename,
                title,
                artist,
                album,
                genre,
                duration,
                track,
                year,
                album_art,
                added_at: to_unix_secs(&metadata),
                play_count: 0,
                last_played: None,
                favorite: false,
                replay_gain,
            });
        }

        songs.sort_by(|a, b| {
            a.artist
                .to_ascii_lowercase()
                .cmp(&b.artist.to_ascii_lowercase())
                .then_with(|| a.album.to_ascii_lowercase().cmp(&b.album.to_ascii_lowercase()))
                .then_with(|| a.track.cmp(&b.track))
                .then_with(|| a.title.to_ascii_lowercase().cmp(&b.title.to_ascii_lowercase()))
        });

        Ok(songs)
    })
    .await
    .map_err(|err| err.to_string())?
}

pub(crate) fn storage_root_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("storage"))
}

pub(crate) fn storage_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(storage_root_path(app)?.join("amply_cache.db"))
}

fn ensure_storage_dirs_blocking(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = storage_root_path(app)?;
    fs::create_dir_all(root.join("lyrics_cache")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("playlists")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("artist_cache")).map_err(|err| err.to_string())?;
    fs::create_dir_all(root.join("metadata_cache")).map_err(|err| err.to_string())?;
    Ok(root)
}

async fn ensure_storage_dirs_async(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = storage_root_path(app)?;
    async_fs::create_dir_all(root.join("lyrics_cache"))
        .await
        .map_err(|err| err.to_string())?;
    async_fs::create_dir_all(root.join("playlists"))
        .await
        .map_err(|err| err.to_string())?;
    async_fs::create_dir_all(root.join("artist_cache"))
        .await
        .map_err(|err| err.to_string())?;
    async_fs::create_dir_all(root.join("metadata_cache"))
        .await
        .map_err(|err| err.to_string())?;
    Ok(root)
}

fn init_storage_db(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS kv (
            path TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn read_storage_kv_blocking(app: &tauri::AppHandle, relative_path: &str) -> Result<Option<String>, String> {
    let _ = ensure_storage_dirs_blocking(app)?;
    let db_path = storage_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    init_storage_db(&conn)?;
    let mut stmt = conn
        .prepare("SELECT value FROM kv WHERE path = ?1")
        .map_err(|err| err.to_string())?;
    let mut rows = stmt.query(params![relative_path]).map_err(|err| err.to_string())?;
    if let Some(row) = rows.next().map_err(|err| err.to_string())? {
        let value: String = row.get(0).map_err(|err| err.to_string())?;
        Ok(Some(value))
    } else {
        // Backfill from legacy file cache if present.
        if let Ok(target) = resolve_storage_path(app, relative_path) {
            if let Ok(content) = fs::read_to_string(&target) {
                let _ = write_storage_kv_blocking(app, relative_path, &content);
                return Ok(Some(content));
            }
        }
        Ok(None)
    }
}

fn write_storage_kv_blocking(app: &tauri::AppHandle, relative_path: &str, content: &str) -> Result<(), String> {
    let _ = ensure_storage_dirs_blocking(app)?;
    let db_path = storage_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    init_storage_db(&conn)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    conn.execute(
        "INSERT INTO kv (path, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![relative_path, content, now],
    )
    .map_err(|err| err.to_string())?;
    Ok(())
}

fn delete_storage_kv_blocking(app: &tauri::AppHandle, relative_path: &str) -> Result<(), String> {
    let _ = ensure_storage_dirs_blocking(app)?;
    let db_path = storage_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    init_storage_db(&conn)?;
    conn.execute("DELETE FROM kv WHERE path = ?1", params![relative_path])
        .map_err(|err| err.to_string())?;
    Ok(())
}

pub(crate) async fn read_storage_kv(app: &tauri::AppHandle, relative_path: &str) -> Result<Option<String>, String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    tauri::async_runtime::spawn_blocking(move || read_storage_kv_blocking(&app_handle, &key))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) async fn write_storage_kv(app: &tauri::AppHandle, relative_path: &str, content: &str) -> Result<(), String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    let value = content.to_string();
    tauri::async_runtime::spawn_blocking(move || write_storage_kv_blocking(&app_handle, &key, &value))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) async fn delete_storage_kv(app: &tauri::AppHandle, relative_path: &str) -> Result<(), String> {
    let app_handle = app.clone();
    let key = relative_path.to_string();
    tauri::async_runtime::spawn_blocking(move || delete_storage_kv_blocking(&app_handle, &key))
        .await
        .map_err(|err| err.to_string())?
}

pub(crate) fn resolve_storage_path(app: &tauri::AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(relative_path);

    if candidate.is_absolute() {
        return Err("Storage path must be relative".to_string());
    }

    for component in candidate.components() {
        if matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err("Unsafe storage path".to_string());
        }
    }

    Ok(storage_root_path(app)?.join(candidate))
}

fn biquad_peaking(sample_rate: u32, freq: f32, q: f32, gain_db: f32) -> BiquadCoeffs {
    let fs = sample_rate as f32;
    let omega = 2.0 * PI * (freq / fs);
    let cos_omega = omega.cos();
    let sin_omega = omega.sin();
    let alpha = sin_omega / (2.0 * q.max(0.1));
    let a = 10.0_f32.powf(gain_db / 40.0);

    let b0 = 1.0 + alpha * a;
    let b1 = -2.0 * cos_omega;
    let b2 = 1.0 - alpha * a;
    let a0 = 1.0 + alpha / a;
    let a1 = -2.0 * cos_omega;
    let a2 = 1.0 - alpha / a;

    BiquadCoeffs {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

#[tauri::command]
async fn ensure_storage_dirs(app: tauri::AppHandle) -> Result<String, String> {
    let root = ensure_storage_dirs_async(&app).await?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
async fn get_storage_stats(app: tauri::AppHandle) -> Result<StorageStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = storage_root_path(&app)?;
        let lyrics_files = count_storage_prefix(&app, "lyrics_cache/").unwrap_or(0);
        let artist_files = count_storage_prefix(&app, "artist_cache/").unwrap_or(0);
        let metadata_files = count_storage_prefix(&app, "metadata_cache/").unwrap_or(0);
        let playlists_files = count_storage_prefix(&app, "playlists/").unwrap_or(0);
        let total_files = lyrics_files + artist_files + metadata_files + playlists_files;

        Ok(StorageStats {
            storage_path: root.to_string_lossy().to_string(),
            lyrics_files,
            artist_files,
            metadata_files,
            playlists_files,
            total_files,
        })
    })
    .await
    .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn open_storage_dir(app: tauri::AppHandle) -> Result<(), String> {
    let root = ensure_storage_dirs_async(&app).await?;
    let target = root.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&target)
            .spawn()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&target)
            .spawn()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&target)
            .spawn()
            .map_err(|err| err.to_string())?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Ok(())
}

#[tauri::command]
async fn clear_storage_cache(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let db_path = storage_db_path(&app)?;
        if db_path.exists() {
            let conn = Connection::open(&db_path).map_err(|err| err.to_string())?;
            init_storage_db(&conn)?;
            let _ = conn.execute("DELETE FROM kv", []);
        }
        let _ = ensure_storage_dirs_blocking(&app)?;
        Ok(())
    })
    .await
    .map_err(|err| err.to_string())?
}

fn count_storage_prefix(app: &tauri::AppHandle, prefix: &str) -> Result<usize, String> {
    let db_path = storage_db_path(app)?;
    let conn = Connection::open(db_path).map_err(|err| err.to_string())?;
    init_storage_db(&conn)?;
    let like = format!("{prefix}%");
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM kv WHERE path LIKE ?1",
            params![like],
            |row| row.get(0),
        )
        .map_err(|err| err.to_string())?;
    Ok(count.max(0) as usize)
}

#[tauri::command]
fn pick_music_folder() -> Option<String> {
    rfd::FileDialog::new()
        .set_title("Select Music Folder")
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_music_folders() -> Vec<String> {
    rfd::FileDialog::new()
        .set_title("Select Music Folders")
        .pick_folders()
        .unwrap_or_default()
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
async fn read_storage_file(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<Option<String>, String> {
    read_storage_kv(&app, &relative_path).await
}

#[tauri::command]
async fn write_storage_file(
    app: tauri::AppHandle,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    write_storage_kv(&app, &relative_path, &content).await
}

fn send_audio_command<F>(
    sender: mpsc::Sender<AudioCommand>,
    builder: F,
) -> Result<(), String>
where
    F: FnOnce(mpsc::Sender<Result<(), String>>) -> AudioCommand,
{
    let (reply_tx, reply_rx) = mpsc::channel();
    sender
        .send(builder(reply_tx))
        .map_err(|_| "Audio thread unavailable".to_string())?;
    reply_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Audio command timeout".to_string())?
}

async fn send_audio_command_async<F>(
    sender: mpsc::Sender<AudioCommand>,
    builder: F,
) -> Result<(), String>
where
    F: FnOnce(mpsc::Sender<Result<(), String>>) -> AudioCommand + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || send_audio_command(sender, builder))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn audio_preload(state: tauri::State<'_, AudioState>, paths: Vec<String>) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::Preload { paths, reply }).await
}

#[tauri::command]
async fn audio_load_song(
    state: tauri::State<'_, AudioState>,
    path: String,
    autoplay: bool,
    transition: bool,
    start_at_sec: f64,
    duration_sec: f64,
    crossfade_duration_sec: f64,
    crossfade: bool,
    track_volume: f32,
    gapless_enabled: bool,
) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::LoadSong {
        path,
        autoplay,
        transition,
        start_at_sec,
        duration_sec,
        crossfade_duration_sec,
        crossfade,
        track_volume,
        gapless_enabled,
        reply,
    })
    .await
}

#[tauri::command]
async fn audio_play(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, |reply| AudioCommand::Play { reply }).await
}

#[tauri::command]
async fn audio_play_from(state: tauri::State<'_, AudioState>, position_sec: f64) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::PlayFrom { position_sec, reply }).await
}

#[tauri::command]
async fn audio_pause(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, |reply| AudioCommand::Pause { reply }).await
}

#[tauri::command]
async fn audio_stop(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, |reply| AudioCommand::Stop { reply }).await
}

#[tauri::command]
async fn audio_seek(state: tauri::State<'_, AudioState>, position_sec: f64) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::Seek { position_sec, reply }).await
}

#[tauri::command]
async fn audio_set_volume(state: tauri::State<'_, AudioState>, volume: f32) -> Result<(), String> {
    let sender = state.sender.clone();
    let volume = volume.max(0.0);
    send_audio_command_async(sender, move |reply| AudioCommand::SetVolume { volume, reply }).await
}

#[tauri::command]
async fn audio_set_rate(state: tauri::State<'_, AudioState>, rate: f32) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::SetRate { rate, reply }).await
}

#[tauri::command]
async fn audio_set_loop(state: tauri::State<'_, AudioState>, enabled: bool) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::SetLoop { enabled, reply }).await
}

#[tauri::command]
async fn audio_set_eq_gains(state: tauri::State<'_, AudioState>, gains: Vec<f32>) -> Result<(), String> {
    let mut normalized = [0.0_f32; 5];
    for (index, gain) in gains.into_iter().take(5).enumerate() {
        normalized[index] = gain.clamp(-12.0, 12.0);
    }

    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::SetEqGains {
        gains: normalized,
        reply,
    })
    .await
}

#[tauri::command]
async fn audio_set_output_device(
    state: tauri::State<'_, AudioState>,
    name: Option<String>,
) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::SetOutputDevice { name, reply }).await
}

#[tauri::command]
fn audio_list_output_devices() -> Result<Vec<OutputDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|device| device.name().ok());

    let devices = host.output_devices().map_err(|err| err.to_string())?;
    let mut items: Vec<OutputDeviceInfo> = devices
        .filter_map(|device| {
            let name = device.name().ok()?;
            let is_default = default_name.as_ref().map(|value| value == &name).unwrap_or(false);
            Some(OutputDeviceInfo { name, is_default })
        })
        .collect();

    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}

#[tauri::command]
async fn audio_analyze_loudness(path: String) -> Result<f32, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let file = fs::File::open(&path).map_err(|err| err.to_string())?;
        let reader = std::io::BufReader::new(file);
        let decoder = Decoder::new(reader).map_err(|err| err.to_string())?;
        let channels = decoder.channels() as u32;
        let sample_rate = decoder.sample_rate();
        if channels == 0 || sample_rate == 0 {
            return Err("Invalid audio format".to_string());
        }

        let mut meter = ebur128::EbuR128::new(channels, sample_rate, ebur128::Mode::I)
            .map_err(|err| err.to_string())?;

        let mut buffer: Vec<f32> = Vec::with_capacity(2048 * channels as usize);
        for sample in decoder.convert_samples::<f32>() {
            buffer.push(sample);
            if buffer.len() >= 2048 * channels as usize {
                meter.add_frames_f32(&buffer).map_err(|err| err.to_string())?;
                buffer.clear();
            }
        }

        if !buffer.is_empty() {
            meter.add_frames_f32(&buffer).map_err(|err| err.to_string())?;
        }

        meter
            .loudness_global()
            .map(|value| value as f32)
            .map_err(|err| err.to_string())
    })
    .await
    .map_err(|err| err.to_string())?
}

fn main() {
    let (audio_tx, audio_rx) = mpsc::channel::<AudioCommand>();

    tauri::Builder::default()
        .manage(AudioState::new(audio_tx.clone()))
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = ensure_storage_dirs_async(&handle).await;
            });
            #[cfg(desktop)]
            {
                use tauri_plugin_autostart::MacosLauncher;
                if let Err(error) =
                    app.handle().plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
                {
                    eprintln!("Failed to initialize autostart plugin: {error}");
                }
            }

            let window_icon = Image::from_bytes(include_bytes!("../../icons/AmplyNoBG.png")).ok();
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = window_icon {
                    let _ = window.set_icon(icon);
                }
            }

            #[cfg(target_os = "windows")]
            start_windows_audio_focus_watcher(app.handle().clone());
            #[cfg(target_os = "windows")]
            start_windows_media_key_listener(app.handle().clone());

            let app_handle = app.handle().clone();
            thread::spawn(move || {
                let mut audio = NativeAudio::new();
                let mut last_emit = Instant::now();
                loop {
                    match audio_rx.recv_timeout(Duration::from_millis(200)) {
                        Ok(command) => match command {
                        AudioCommand::LoadSong {
                            path,
                            autoplay,
                            transition,
                            start_at_sec,
                            duration_sec,
                            crossfade_duration_sec,
                            crossfade,
                            track_volume,
                            gapless_enabled,
                            reply,
                        } => {
                            let result = audio.load_song(
                                path,
                                autoplay,
                                transition,
                                start_at_sec,
                                duration_sec,
                                crossfade_duration_sec,
                                crossfade,
                                track_volume,
                                gapless_enabled,
                            );
                            let _ = reply.send(result);
                        }
                            AudioCommand::Play { reply } => {
                                let _ = reply.send(audio.play());
                            }
                            AudioCommand::PlayFrom { position_sec, reply } => {
                                let _ = reply.send(audio.play_from(position_sec));
                            }
                            AudioCommand::Pause { reply } => {
                                audio.pause();
                                let _ = reply.send(Ok(()));
                            }
                            AudioCommand::Stop { reply } => {
                                audio.stop();
                                let _ = reply.send(Ok(()));
                            }
                            AudioCommand::Seek { position_sec, reply } => {
                                let _ = reply.send(audio.seek(position_sec));
                            }
                            AudioCommand::SetVolume { volume, reply } => {
                                audio.set_volume(volume);
                                let _ = reply.send(Ok(()));
                            }
                            AudioCommand::SetRate { rate, reply } => {
                                let _ = reply.send(audio.set_rate(rate));
                            }
                            AudioCommand::SetLoop { enabled, reply } => {
                                let _ = reply.send(audio.set_loop(enabled));
                            }
                            AudioCommand::SetEqGains { gains, reply } => {
                                let _ = reply.send(audio.set_eq_gains(gains));
                            }
                            AudioCommand::SetOutputDevice { name, reply } => {
                                let _ = reply.send(audio.set_output_device(name));
                            }
                            AudioCommand::Preload { paths, reply } => {
                                let next: std::collections::HashSet<_> = paths.iter().cloned().collect();
                                audio.preloaded.retain(|key, _| next.contains(key));

                                for path in paths {
                                    if audio.preloaded.contains_key(&path) {
                                        continue;
                                    }

                                    let data = match fs::read(&path) {
                                        Ok(bytes) => bytes,
                                        Err(_) => continue,
                                    };

                                    if data.len() > 40 * 1024 * 1024 {
                                        continue;
                                    }

                                    audio.preloaded.insert(path, data);
                                }

                                let _ = reply.send(Ok(()));
                            }
                        },
                        Err(mpsc::RecvTimeoutError::Timeout) => {}
                        Err(mpsc::RecvTimeoutError::Disconnected) => break,
                    }

                    audio.tick();

                    if audio.sink.is_some() {
                        let mut ended = false;
                        if audio.is_playing {
                            if let Some(sink) = audio.sink.as_ref() {
                                if sink.empty() && !audio.loop_current && !audio.ended_emitted {
                                    audio.is_playing = false;
                                    audio.start_instant = None;
                                    audio.paused_position = audio.duration_sec;
                                    audio.ended_emitted = true;
                                    ended = true;
                                }
                            }
                        }

                        if audio.is_playing && last_emit.elapsed() >= Duration::from_millis(250) {
                            last_emit = Instant::now();
                            let _ = app_handle.emit(
                                "amply://audio-progress",
                                AudioProgress {
                                    position: audio.current_position(),
                                    duration: audio.duration_sec,
                                },
                            );
                        }
                        if ended {
                            let _ = app_handle.emit("amply://audio-ended", ());
                        }
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ensure_storage_dirs,
            get_storage_stats,
            open_storage_dir,
            clear_storage_cache,
            pick_music_folder,
            pick_music_folders,
            read_storage_file,
            write_storage_file,
            scan_music,
            audio_preload,
            audio_load_song,
            audio_play,
            audio_play_from,
            audio_pause,
            audio_stop,
            audio_seek,
            audio_set_volume,
            audio_set_rate,
            audio_set_loop,
            audio_set_eq_gains,
            audio_set_output_device,
            audio_list_output_devices,
            audio_analyze_loudness,
            generate_smart_playlists_rust,
            metadata::has_cached_artist_profile_rust,
            metadata::read_cached_artist_profile_rust,
            metadata::load_artist_profile_rust,
            metadata::load_album_artwork_cache_rust,
            metadata::read_cached_album_artwork_rust,
            metadata::load_album_artwork_rust,
            metadata::load_album_tracklist_cache_rust,
            metadata::read_cached_album_tracklist_rust,
            metadata::load_album_tracklist_rust,
            metadata::load_song_genre_cache_rust,
            metadata::load_song_genre_rust,
            metadata::lyrics_find_candidates_rust,
            metadata::lyrics_read_cached_rust,
            metadata::lyrics_save_selection_rust,
            metadata::lyrics_load_rust,
            compute::build_stats_rust,
            compute::search_filter_rank_rust,
            compute::build_album_art_frequency_rust,
            compute::build_artwork_set_rust
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if window.label() == "overlay" {
                    return;
                }
                let app = window.app_handle();
                close_all_windows(&app);
                app.exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("failed to run amply");
}

fn close_all_windows(app: &tauri::AppHandle) {
    for (_label, window) in app.webview_windows() {
        let _ = window.close();
    }
}

#[cfg(target_os = "windows")]
fn start_windows_audio_focus_watcher(app: tauri::AppHandle) {
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
                    if is_system_result.0 >= 0 {
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

#[tauri::command]
fn generate_smart_playlists_rust(
    songs: Vec<playlist::SongInput>,
    seed: Option<u64>,
    daily_seed: Option<u64>,
    profile: Option<playlist::ListeningProfileInput>,
    discovery_intensity: Option<f32>,
    randomness_intensity: Option<f32>,
    lite: Option<bool>,
) -> Result<Vec<playlist::PlaylistOutput>, String> {
    let seed_value = seed.unwrap_or_else(|| {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
        now.as_secs()
    });
    let daily_seed_value = daily_seed.unwrap_or(seed_value);
    let discovery = discovery_intensity.unwrap_or(0.35).clamp(0.0, 1.0);
    let randomness = randomness_intensity.unwrap_or(0.3).clamp(0.0, 1.0);
    let lite_flag = lite.unwrap_or(false);

    Ok(playlist::generate_playlists(
        songs,
        seed_value,
        daily_seed_value,
        profile,
        discovery,
        randomness,
        lite_flag,
    ))
}

#[cfg(target_os = "windows")]
fn start_windows_media_key_listener(app: tauri::AppHandle) {
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

#[cfg(target_os = "windows")]
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
            std::mem::transmute(buffer.as_mut_ptr()),
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

#[cfg(target_os = "windows")]
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
        let win_w = (rect.right - rect.left) as i32;
        let win_h = (rect.bottom - rect.top) as i32;
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
