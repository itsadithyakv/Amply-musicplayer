pub mod commands;
pub mod dsp;
pub mod engine;

use std::{
    fs,
    sync::mpsc::{self, Receiver},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use tauri::{AppHandle, Emitter};

use self::engine::{AudioCommand, AudioProgress, AudioSpectrum, NativeAudio};

pub(crate) fn spawn_audio_thread(app: AppHandle, rx: Receiver<AudioCommand>) -> JoinHandle<()> {
    let app_handle = app;
    let audio_rx = rx;
    thread::spawn(move || {
        let mut audio = NativeAudio::new();
        let mut last_emit = Instant::now();
        let mut last_spectrum_emit = Instant::now();
        loop {
            match audio_rx.recv_timeout(Duration::from_millis(50)) {
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
                if audio.is_playing
                    && last_spectrum_emit.elapsed() >= Duration::from_millis(50)
                {
                    last_spectrum_emit = Instant::now();
                    let _ = app_handle.emit(
                        "amply://audio-spectrum",
                        AudioSpectrum {
                            bands: audio.spectrum.snapshot(),
                        },
                    );
                }
                if ended {
                    let _ = app_handle.emit("amply://audio-ended", ());
                }
            }
        }
    })
}
