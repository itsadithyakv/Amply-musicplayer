pub mod commands;
pub mod dsp;
pub mod engine;

use std::{
    fs,
    sync::{
        mpsc::{self, Receiver},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use self::engine::{AudioCommand, AudioProgress, AudioSpectrum, AudioState, NativeAudio};
use crate::platform::join_with_timeout;

/// Join handle of the audio thread, taken by `shutdown`.
static AUDIO_THREAD: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);

/// Asks the audio thread to stop and waits up to 2 s for it, so the output
/// stream is torn down before the process exits.
pub(crate) fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<AudioState>() {
        if state.sender.send(AudioCommand::Shutdown).is_err() {
            log::debug!("Audio thread already stopped before shutdown");
        }
    }
    let handle = AUDIO_THREAD
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    join_with_timeout("audio engine", handle, Duration::from_secs(2));
}

fn emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(error) = app.emit(event, payload) {
        log::warn!("Failed to emit {event}: {error}");
    }
}

pub(crate) fn spawn_audio_thread(app: AppHandle, rx: Receiver<AudioCommand>) {
    let app_handle = app;
    let audio_rx = rx;
    let handle = thread::spawn(move || {
        let mut audio = NativeAudio::new();
        let mut last_emit = Instant::now();
        let mut last_spectrum_emit = Instant::now();
        loop {
            // Sleep long when idle; only fades, playback progress and loop bookkeeping need the 50 ms tick.
            let wait = if audio.needs_tick() {
                Duration::from_millis(50)
            } else {
                Duration::from_secs(60)
            };
            match audio_rx.recv_timeout(wait) {
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
                    AudioCommand::SetVisualizerEnabled { enabled, reply } => {
                        audio.set_visualizer_enabled(enabled);
                        let _ = reply.send(Ok(()));
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

                            audio.preloaded.insert(path, Arc::from(data));
                        }

                        let _ = reply.send(Ok(()));
                    }
                    AudioCommand::Shutdown => break,
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

                let progress_due = audio.progress_dirty || last_emit.elapsed() >= Duration::from_millis(250);
                audio.progress_dirty = false;
                if audio.is_playing && progress_due {
                    last_emit = Instant::now();
                    emit(
                        &app_handle,
                        "amply://audio-progress",
                        AudioProgress {
                            position: audio.current_position(),
                            duration: audio.duration_sec,
                        },
                    );
                }
                if audio.is_playing
                    && audio.spectrum.is_enabled()
                    && last_spectrum_emit.elapsed() >= Duration::from_millis(50)
                {
                    last_spectrum_emit = Instant::now();
                    emit(
                        &app_handle,
                        "amply://audio-spectrum",
                        AudioSpectrum {
                            bands: audio.spectrum.snapshot(),
                        },
                    );
                }
                if ended {
                    emit(&app_handle, "amply://audio-ended", ());
                }
            }
        }
        log::info!("Audio thread stopped");
    });
    *AUDIO_THREAD.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handle);
}
