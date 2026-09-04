use std::{sync::mpsc, time::Duration};

use rodio::cpal;
use rodio::cpal::traits::HostTrait;

use super::engine::{device_name, AudioCommand, AudioState, OutputDeviceInfo};
use crate::error::{AmplyError, AmplyResult};

/// Commands that may decode or open a device (load, seek, device switch).
const LONG_TIMEOUT: Duration = Duration::from_secs(15);
/// Everything else is an atomic store or a sink flag flip.
const SHORT_TIMEOUT: Duration = Duration::from_secs(5);

fn send_audio_command<F>(
    sender: mpsc::Sender<AudioCommand>,
    timeout: Duration,
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
        .recv_timeout(timeout)
        .map_err(|_| "Audio command timeout".to_string())?
}

async fn send_audio_command_async<F>(
    sender: mpsc::Sender<AudioCommand>,
    timeout: Duration,
    builder: F,
) -> AmplyResult<()>
where
    F: FnOnce(mpsc::Sender<Result<(), String>>) -> AudioCommand + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || send_audio_command(sender, timeout, builder))
        .await
        .map_err(|err| err.to_string())??;
    Ok(())
}

#[tauri::command]
pub async fn audio_preload(state: tauri::State<'_, AudioState>, paths: Vec<String>) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, SHORT_TIMEOUT, move |reply| AudioCommand::Preload { paths, reply }).await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn audio_load_song(
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
) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, LONG_TIMEOUT, move |reply| AudioCommand::LoadSong {
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
pub async fn audio_play(state: tauri::State<'_, AudioState>) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, SHORT_TIMEOUT, |reply| AudioCommand::Play { reply }).await
}

#[tauri::command]
pub async fn audio_play_from(state: tauri::State<'_, AudioState>, position_sec: f64) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, LONG_TIMEOUT, move |reply| AudioCommand::PlayFrom { position_sec, reply }).await
}

#[tauri::command]
pub async fn audio_pause(state: tauri::State<'_, AudioState>) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, SHORT_TIMEOUT, |reply| AudioCommand::Pause { reply }).await
}

#[tauri::command]
pub async fn audio_stop(state: tauri::State<'_, AudioState>) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, SHORT_TIMEOUT, |reply| AudioCommand::Stop { reply }).await
}

#[tauri::command]
pub async fn audio_seek(state: tauri::State<'_, AudioState>, position_sec: f64) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, LONG_TIMEOUT, move |reply| AudioCommand::Seek { position_sec, reply }).await
}

#[tauri::command]
pub async fn audio_set_volume(state: tauri::State<'_, AudioState>, volume: f32) -> AmplyResult<()> {
    let sender = state.sender.clone();
    let volume = volume.max(0.0);
    send_audio_command_async(sender, SHORT_TIMEOUT, move |reply| AudioCommand::SetVolume { volume, reply }).await
}

#[tauri::command]
pub async fn audio_set_rate(state: tauri::State<'_, AudioState>, rate: f32) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, SHORT_TIMEOUT, move |reply| AudioCommand::SetRate { rate, reply }).await
}

#[tauri::command]
pub async fn audio_set_loop(state: tauri::State<'_, AudioState>, enabled: bool) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, SHORT_TIMEOUT, move |reply| AudioCommand::SetLoop { enabled, reply }).await
}

#[tauri::command]
pub async fn audio_set_eq_gains(state: tauri::State<'_, AudioState>, gains: Vec<f32>) -> AmplyResult<()> {
    let mut normalized = [0.0_f32; 5];
    for (index, gain) in gains.into_iter().take(5).enumerate() {
        normalized[index] = gain.clamp(-12.0, 12.0);
    }

    let sender = state.sender.clone();
    send_audio_command_async(sender, SHORT_TIMEOUT, move |reply| AudioCommand::SetEqGains {
        gains: normalized,
        reply,
    })
    .await
}

#[tauri::command]
pub async fn audio_set_visualizer_enabled(
    state: tauri::State<'_, AudioState>,
    enabled: bool,
) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, SHORT_TIMEOUT, move |reply| AudioCommand::SetVisualizerEnabled {
        enabled,
        reply,
    })
    .await
}

#[tauri::command]
pub async fn audio_set_output_device(
    state: tauri::State<'_, AudioState>,
    name: Option<String>,
) -> AmplyResult<()> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, LONG_TIMEOUT, move |reply| AudioCommand::SetOutputDevice { name, reply }).await
}

#[tauri::command]
pub async fn audio_list_output_devices() -> AmplyResult<Vec<OutputDeviceInfo>> {
    tauri::async_runtime::spawn_blocking(list_output_devices_blocking)
        .await
        .map_err(|err| err.to_string())?
}

/// cpal enumeration can block on the audio backend, so it never runs on the main thread.
fn list_output_devices_blocking() -> AmplyResult<Vec<OutputDeviceInfo>> {
    let host = cpal::default_host();
    let default_name = host
        .default_output_device()
        .and_then(|device| device_name(&device));

    let devices = host
        .output_devices()
        .map_err(|err| AmplyError::Audio(err.to_string()))?;
    let mut items: Vec<OutputDeviceInfo> = devices
        .filter_map(|device| {
            let name = device_name(&device)?;
            let is_default = default_name.as_ref().map(|value| value == &name).unwrap_or(false);
            Some(OutputDeviceInfo { name, is_default })
        })
        .collect();

    items.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(items)
}
