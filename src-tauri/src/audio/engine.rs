use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read, Seek},
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

use rodio::cpal;
use rodio::cpal::traits::{DeviceTrait, HostTrait};
use rodio::{Decoder, OutputStream, OutputStreamHandle, Sink, Source};
use serde::Serialize;

use super::dsp::{
    BiquadSource, SharedParams, SharedSpeed, SpectrumLevels, SpectrumSource,
    AUDIO_SPECTRUM_BANDS, EQ_BAND_COUNT,
};

trait ReadSeek: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> ReadSeek for T {}

type BoxedSource = Box<dyn Source<Item = f32> + Send>;

const MIN_RATE: f32 = 0.25;
const EQ_GAIN_LIMIT_DB: f32 = 12.0;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OutputDeviceInfo {
    pub(crate) name: String,
    pub(crate) is_default: bool,
}

#[derive(Clone)]
pub(crate) struct AudioState {
    pub(crate) sender: mpsc::Sender<AudioCommand>,
}

impl AudioState {
    pub(crate) fn new(sender: mpsc::Sender<AudioCommand>) -> Self {
        Self { sender }
    }
}

pub(crate) struct NativeAudio {
    stream: Option<OutputStream>,
    handle: Option<OutputStreamHandle>,
    pub(crate) sink: Option<Sink>,
    fading_sink: Option<Sink>,
    /// Preloaded file bytes, shared with every decoder built from them (no copy per sink).
    pub(crate) preloaded: HashMap<String, Arc<[u8]>>,
    current_path: Option<String>,
    pub(crate) duration_sec: f64,
    pub(crate) paused_position: f64,
    pub(crate) start_instant: Option<Instant>,
    /// Playback rate in effect since `start_instant`; wall-clock elapsed is scaled by it.
    rate_at_start: f32,
    pub(crate) is_playing: bool,
    pub(crate) loop_current: bool,
    /// A second copy of the current track has been appended to the sink for looping.
    loop_copy_queued: bool,
    last_sink_len: usize,
    /// Set by `tick()` when the position was reset (loop wrap) and progress should be emitted now.
    pub(crate) progress_dirty: bool,
    params: Arc<SharedParams>,
    volume: f32,
    pub(crate) ended_emitted: bool,
    fade_in: Option<FadeState>,
    fade_out: Option<FadeState>,
    pub(crate) spectrum: Arc<SpectrumLevels>,
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
            rate_at_start: 1.0,
            is_playing: false,
            loop_current: false,
            loop_copy_queued: false,
            last_sink_len: 0,
            progress_dirty: false,
            params: Arc::new(SharedParams::default()),
            volume: 0.85,
            ended_emitted: false,
            fade_in: None,
            fade_out: None,
            spectrum: Arc::new(SpectrumLevels::default()),
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
pub(crate) struct AudioProgress {
    pub(crate) position: f64,
    pub(crate) duration: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AudioSpectrum {
    pub(crate) bands: [f32; AUDIO_SPECTRUM_BANDS],
}

pub(crate) enum AudioCommand {
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
    SetEqGains { gains: [f32; EQ_BAND_COUNT], reply: mpsc::Sender<Result<(), String>> },
    SetVisualizerEnabled { enabled: bool, reply: mpsc::Sender<Result<(), String>> },
    SetOutputDevice { name: Option<String>, reply: mpsc::Sender<Result<(), String>> },
    Preload { paths: Vec<String>, reply: mpsc::Sender<Result<(), String>> },
    /// Ends the audio thread's loop; sent from `audio::shutdown` at process exit.
    Shutdown,
}

/// Playback position given the position at the last (re)start, the wall-clock time
/// elapsed since, and the playback rate in effect during that interval.
pub(crate) fn position_from(paused_position: f64, elapsed: Duration, rate: f32) -> f64 {
    paused_position + elapsed.as_secs_f64() * f64::from(rate)
}

impl NativeAudio {
    pub(crate) fn new() -> Self {
        let mut audio = Self::default();
        // Failure is logged inside; the engine retries lazily on the next load/play.
        let _ = audio.ensure_output();
        audio
    }

    /// Lazily (re)creates the default output stream when none is available.
    fn ensure_output(&mut self) -> Result<(), String> {
        if self.handle.is_some() {
            return Ok(());
        }
        match OutputStream::try_default() {
            Ok((stream, handle)) => {
                self.stream = Some(stream);
                self.handle = Some(handle);
                Ok(())
            }
            Err(error) => {
                log::error!("Failed to initialize audio output: {error}");
                Err(format!("Audio output unavailable: {error}"))
            }
        }
    }

    fn ensure_handle(&self) -> Result<&OutputStreamHandle, String> {
        self.handle.as_ref().ok_or_else(|| "Audio output unavailable".to_string())
    }

    fn rate(&self) -> f32 {
        self.params.rate()
    }

    /// Whether the audio thread needs its 50 ms tick (fades, progress, loop bookkeeping).
    pub(crate) fn needs_tick(&self) -> bool {
        self.is_playing
            || self.fade_in.is_some()
            || self.fade_out.is_some()
            || (self.loop_current && self.sink.is_some())
    }

    fn open_reader(&self, path: &str) -> Result<Box<dyn ReadSeek>, String> {
        if let Some(data) = self.preloaded.get(path) {
            Ok(Box::new(Cursor::new(Arc::clone(data))))
        } else {
            let file = fs::File::open(path).map_err(|err| err.to_string())?;
            Ok(Box::new(std::io::BufReader::new(file)))
        }
    }

    /// Decoder -> EQ stages -> spectrum tap -> shared-rate wrapper.
    ///
    /// `start_at_sec > 0` uses `skip_duration` (decode-and-discard); callers prefer
    /// building from 0 and seeking the sink, using this only as a fallback.
    fn build_source(&self, path: &str, start_at_sec: f64) -> Result<BoxedSource, String> {
        let reader = self.open_reader(path)?;
        let decoder = Decoder::new(reader).map_err(|err: rodio::decoder::DecoderError| err.to_string())?;
        let decoded = decoder.convert_samples::<f32>();

        let source: BoxedSource = if start_at_sec > 0.0 {
            Box::new(decoded.skip_duration(Duration::from_secs_f64(start_at_sec)))
        } else {
            Box::new(decoded)
        };

        // EQ and spectrum operate at the decoder's native rate so their tuning does not
        // move with the playback rate; the speed wrapper sits outermost.
        let source = self.apply_eq(source);
        let source = SpectrumSource::new(source, Arc::clone(&self.spectrum));
        let source = SharedSpeed::new(source, Arc::clone(&self.params));
        Ok(Box::new(source))
    }

    fn apply_eq<S>(&self, source: S) -> BoxedSource
    where
        S: Source<Item = f32> + Send + 'static,
    {
        let mut current: BoxedSource = Box::new(source);
        for band in 0..EQ_BAND_COUNT {
            current = Box::new(BiquadSource::new(current, Arc::clone(&self.params), band));
        }
        current
    }

    /// Seeks the sink to `position_sec` of *source* time.
    ///
    /// `Sink::try_seek` takes output time and rodio's `Speed` (and our `SharedSpeed`)
    /// multiplies it by the factor on the way down, so divide by the rate here.
    fn seek_sink(&self, sink: &Sink, position_sec: f64) -> Result<(), String> {
        let output_secs = position_sec.max(0.0) / f64::from(self.rate());
        sink.try_seek(Duration::from_secs_f64(output_secs))
            .map_err(|err| err.to_string())
    }

    /// Creates a sink with the track loaded at `start_at_sec`, already at `volume`
    /// and paused if requested (so no samples leak before the pause applies).
    fn create_sink(
        &self,
        path: &str,
        start_at_sec: f64,
        volume: f32,
        paused: bool,
    ) -> Result<Sink, String> {
        let handle = self.ensure_handle()?;
        let start_at_sec = start_at_sec.max(0.0);

        let new_sink = || -> Result<Sink, String> {
            let sink = Sink::try_new(handle).map_err(|err| err.to_string())?;
            sink.set_volume(volume);
            if paused {
                sink.pause();
            }
            Ok(sink)
        };

        let sink = new_sink()?;
        sink.append(self.build_source(path, 0.0)?);
        if start_at_sec <= 0.0 {
            return Ok(sink);
        }

        match self.seek_sink(&sink, start_at_sec) {
            Ok(()) => Ok(sink),
            Err(err) => {
                log::warn!("try_seek to {start_at_sec:.2}s failed ({err}); falling back to skip_duration");
                sink.stop();
                let sink = new_sink()?;
                sink.append(self.build_source(path, start_at_sec)?);
                Ok(sink)
            }
        }
    }

    pub(crate) fn current_position(&self) -> f64 {
        if self.sink.is_none() {
            return self.paused_position;
        }

        if self.is_playing {
            if let Some(started) = self.start_instant {
                let position = position_from(self.paused_position, started.elapsed(), self.rate_at_start);
                return if self.duration_sec > 0.0 {
                    position.min(self.duration_sec)
                } else {
                    position
                };
            }
        }

        self.paused_position
    }

    /// Restarts the wall-clock reference at `position` with the current rate.
    fn set_position(&mut self, position: f64, playing: bool) {
        self.paused_position = position.max(0.0);
        self.start_instant = if playing { Some(Instant::now()) } else { None };
        self.rate_at_start = self.rate();
        self.is_playing = playing;
    }

    fn reset_loop_tracking(&mut self) {
        self.loop_copy_queued = false;
        self.last_sink_len = self.sink.as_ref().map(Sink::len).unwrap_or(0);
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

        let sink = self.create_sink(&path, position, self.volume, !was_playing)?;
        self.sink = Some(sink);
        self.set_position(position, was_playing);
        self.ended_emitted = false;
        self.fade_in = None;
        self.reset_loop_tracking();
        Ok(())
    }

    fn clear_fading_sink(&mut self) {
        if let Some(sink) = self.fading_sink.take() {
            sink.stop();
        }
        self.fade_out = None;
    }

    pub(crate) fn tick(&mut self) {
        self.tick_fades();
        self.tick_loop();
    }

    fn tick_fades(&mut self) {
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

    /// Loop by queueing a second copy of the track behind the current one, and
    /// resetting the position when the sink hands over to that copy.
    fn tick_loop(&mut self) {
        if !self.loop_current {
            return;
        }
        let Some(len) = self.sink.as_ref().map(Sink::len) else {
            return;
        };

        let wrapped = len < self.last_sink_len && (self.loop_copy_queued || len == 0);
        if wrapped {
            self.set_position(0.0, self.is_playing);
            self.loop_copy_queued = false;
            self.ended_emitted = false;
            self.progress_dirty = true;
        }

        if len <= 1 && !self.loop_copy_queued {
            if let Some(path) = self.current_path.clone() {
                match self.build_source(&path, 0.0) {
                    Ok(source) => {
                        if let Some(sink) = self.sink.as_ref() {
                            sink.append(source);
                            self.loop_copy_queued = true;
                        }
                    }
                    Err(err) => log::error!("Failed to queue loop copy of {path}: {err}"),
                }
            }
        }

        self.last_sink_len = self.sink.as_ref().map(Sink::len).unwrap_or(0);
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
        self.reset_loop_tracking();
        self.spectrum.reset();
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn load_song(
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
        self.ensure_output()?;

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

        let target_volume = if can_crossfade { 0.0 } else { track_volume };
        let sink = self.create_sink(&path, start_at_sec, target_volume, !autoplay)?;

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
        self.set_position(start_at_sec, autoplay);
        self.volume = track_volume;
        self.ended_emitted = false;
        self.reset_loop_tracking();
        Ok(())
    }

    pub(crate) fn play(&mut self) -> Result<(), String> {
        self.ensure_output()?;
        if let Some(sink) = &self.sink {
            sink.play();
            if !self.is_playing {
                let position = self.current_position();
                self.set_position(position, true);
            }
        }
        Ok(())
    }

    pub(crate) fn play_from(&mut self, position_sec: f64) -> Result<(), String> {
        self.ensure_output()?;
        self.seek(position_sec)?;
        self.play()
    }

    pub(crate) fn pause(&mut self) {
        if let Some(sink) = &self.sink {
            sink.pause();
        }
        self.clear_fading_sink();
        self.paused_position = self.current_position();
        self.start_instant = None;
        self.is_playing = false;
        self.fade_in = None;
    }

    pub(crate) fn stop(&mut self) {
        self.stop_all();
    }

    pub(crate) fn seek(&mut self, position_sec: f64) -> Result<(), String> {
        if self.current_path.is_none() {
            return Err("No song loaded".to_string());
        }
        let position_sec = position_sec.max(0.0);
        let was_playing = self.is_playing;

        // Fast path: seek the live sink in place. `Sink::try_seek` reports Ok without
        // doing anything when the sink has drained, so treat that as a rebuild.
        let seeked_in_place = match self.sink.as_ref() {
            Some(sink) if !sink.empty() => match self.seek_sink(sink, position_sec) {
                Ok(()) => true,
                Err(err) => {
                    log::warn!("In-place seek to {position_sec:.2}s failed ({err}); rebuilding sink");
                    false
                }
            },
            _ => false,
        };

        if !seeked_in_place {
            return self.rebuild_sink(position_sec, was_playing);
        }

        self.clear_fading_sink();
        if self.fade_in.take().is_some() {
            if let Some(sink) = self.sink.as_ref() {
                sink.set_volume(self.volume);
            }
        }
        self.set_position(position_sec, was_playing);
        self.ended_emitted = false;
        Ok(())
    }

    pub(crate) fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
        if let Some(fade) = self.fade_in.as_mut() {
            // Let the running fade-in land on the new volume instead of jumping.
            fade.to = volume;
        } else if let Some(sink) = &self.sink {
            sink.set_volume(volume);
        }
        // `fading_sink` is owned by the fade-out ramp in `tick()`; never touch it here.
    }

    pub(crate) fn set_rate(&mut self, rate: f32) -> Result<(), String> {
        let rate = rate.max(MIN_RATE);
        // Fold the time elapsed at the old rate into `paused_position` first.
        if self.sink.is_some() {
            let position = self.current_position();
            self.paused_position = position;
            if self.is_playing {
                self.start_instant = Some(Instant::now());
            }
        }
        self.rate_at_start = rate;
        self.params.set_rate(rate);
        Ok(())
    }

    pub(crate) fn set_loop(&mut self, enabled: bool) -> Result<(), String> {
        self.loop_current = enabled;
        if enabled {
            // `tick()` queues the loop copy on the next pass.
            return Ok(());
        }
        if self.loop_copy_queued {
            // The sink has no API to drop a queued source; rebuild without it.
            let position = self.current_position();
            let was_playing = self.is_playing;
            self.rebuild_sink(position, was_playing)?;
        }
        self.loop_copy_queued = false;
        Ok(())
    }

    pub(crate) fn set_eq_gains(&mut self, gains: [f32; EQ_BAND_COUNT]) -> Result<(), String> {
        self.params
            .set_gains(gains.map(|gain| gain.clamp(-EQ_GAIN_LIMIT_DB, EQ_GAIN_LIMIT_DB)));
        Ok(())
    }

    pub(crate) fn set_visualizer_enabled(&mut self, enabled: bool) {
        self.spectrum.set_enabled(enabled);
    }

    pub(crate) fn set_output_device(&mut self, name: Option<String>) -> Result<(), String> {
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

        let opened = device
            .ok_or_else(|| "No output device available".to_string())
            .and_then(|device| OutputStream::try_from_device(&device).map_err(|err| err.to_string()));

        let (stream, handle) = match opened {
            Ok(pair) => pair,
            Err(err) => {
                log::error!("Failed to open output device {name:?}: {err}");
                // Still give a silent engine a chance to come back on the default device.
                let _ = self.ensure_output();
                return Err(err);
            }
        };

        let position = self.current_position();
        let was_playing = self.is_playing;

        self.stream = Some(stream);
        self.handle = Some(handle);

        if self.sink.is_some() {
            self.rebuild_sink(position, was_playing)?;
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_scales_elapsed_by_rate() {
        let position = position_from(10.0, Duration::from_secs(2), 1.5);
        assert!((position - 13.0).abs() < 1e-9);

        let position = position_from(4.0, Duration::from_millis(500), 1.0);
        assert!((position - 4.5).abs() < 1e-9);

        let position = position_from(0.0, Duration::from_secs(4), 0.5);
        assert!((position - 2.0).abs() < 1e-9);
    }

    #[test]
    fn set_rate_clamps_and_snapshots_rate_at_start() {
        let mut audio = NativeAudio::default();
        audio.set_rate(1.5).unwrap();
        assert_eq!(audio.rate(), 1.5);
        assert_eq!(audio.rate_at_start, 1.5);

        audio.set_rate(0.1).unwrap();
        assert_eq!(audio.rate(), MIN_RATE);
    }

    #[test]
    fn eq_gains_are_clamped() {
        let mut audio = NativeAudio::default();
        audio.set_eq_gains([20.0, -20.0, 3.0, 0.0, 0.0]).unwrap();
        let gains = audio.params.gains();
        assert_eq!(gains[0], EQ_GAIN_LIMIT_DB);
        assert_eq!(gains[1], -EQ_GAIN_LIMIT_DB);
        assert_eq!(gains[2], 3.0);
    }

    #[test]
    fn needs_tick_only_when_there_is_work() {
        let mut audio = NativeAudio::default();
        assert!(!audio.needs_tick());
        audio.is_playing = true;
        assert!(audio.needs_tick());
        audio.is_playing = false;
        audio.fade_out = Some(FadeState {
            start: Instant::now(),
            duration: Duration::from_secs(1),
            from: 1.0,
            to: 0.0,
        });
        assert!(audio.needs_tick());
        audio.fade_out = None;
        audio.loop_current = true;
        // Loop without a sink is idle.
        assert!(!audio.needs_tick());
    }
}
