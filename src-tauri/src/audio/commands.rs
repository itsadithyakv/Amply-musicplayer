use std::{sync::mpsc, time::Duration};

use rodio::cpal;
use rodio::cpal::traits::{DeviceTrait, HostTrait};

use super::engine::{AudioCommand, AudioState, OutputDeviceInfo};

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
pub async fn audio_preload(state: tauri::State<'_, AudioState>, paths: Vec<String>) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::Preload { paths, reply }).await
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
pub async fn audio_play(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, |reply| AudioCommand::Play { reply }).await
}

#[tauri::command]
pub async fn audio_play_from(state: tauri::State<'_, AudioState>, position_sec: f64) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::PlayFrom { position_sec, reply }).await
}

#[tauri::command]
pub async fn audio_pause(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, |reply| AudioCommand::Pause { reply }).await
}

#[tauri::command]
pub async fn audio_stop(state: tauri::State<'_, AudioState>) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, |reply| AudioCommand::Stop { reply }).await
}

#[tauri::command]
pub async fn audio_seek(state: tauri::State<'_, AudioState>, position_sec: f64) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::Seek { position_sec, reply }).await
}

#[tauri::command]
pub async fn audio_set_volume(state: tauri::State<'_, AudioState>, volume: f32) -> Result<(), String> {
    let sender = state.sender.clone();
    let volume = volume.max(0.0);
    send_audio_command_async(sender, move |reply| AudioCommand::SetVolume { volume, reply }).await
}

#[tauri::command]
pub async fn audio_set_rate(state: tauri::State<'_, AudioState>, rate: f32) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::SetRate { rate, reply }).await
}

#[tauri::command]
pub async fn audio_set_loop(state: tauri::State<'_, AudioState>, enabled: bool) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::SetLoop { enabled, reply }).await
}

#[tauri::command]
pub async fn audio_set_eq_gains(state: tauri::State<'_, AudioState>, gains: Vec<f32>) -> Result<(), String> {
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
pub async fn audio_set_visualizer_enabled(
    state: tauri::State<'_, AudioState>,
    enabled: bool,
) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::SetVisualizerEnabled {
        enabled,
        reply,
    })
    .await
}

#[tauri::command]
pub async fn audio_set_output_device(
    state: tauri::State<'_, AudioState>,
    name: Option<String>,
) -> Result<(), String> {
    let sender = state.sender.clone();
    send_audio_command_async(sender, move |reply| AudioCommand::SetOutputDevice { name, reply }).await
}

#[tauri::command]
pub fn audio_list_output_devices() -> Result<Vec<OutputDeviceInfo>, String> {
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
