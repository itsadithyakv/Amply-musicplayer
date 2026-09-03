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
    biquad_peaking, BiquadSource, SpectrumLevels, SpectrumSource, AUDIO_SPECTRUM_BANDS,
    EQ_BAND_FREQUENCIES,
};

trait ReadSeek: Read + Seek + Send + Sync {}
impl<T: Read + Seek + Send + Sync> ReadSeek for T {}

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
    pub(crate) preloaded: HashMap<String, Vec<u8>>,
    current_path: Option<String>,
    pub(crate) duration_sec: f64,
    pub(crate) paused_position: f64,
    pub(crate) start_instant: Option<Instant>,
    pub(crate) is_playing: bool,
    pub(crate) loop_current: bool,
    eq_gains: [f32; 5],
    rate: f32,
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
            is_playing: false,
            loop_current: false,
            eq_gains: [0.0; 5],
            rate: 1.0,
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
    SetEqGains { gains: [f32; 5], reply: mpsc::Sender<Result<(), String>> },
    SetVisualizerEnabled { enabled: bool, reply: mpsc::Sender<Result<(), String>> },
    SetOutputDevice { name: Option<String>, reply: mpsc::Sender<Result<(), String>> },
    Preload { paths: Vec<String>, reply: mpsc::Sender<Result<(), String>> },
}

impl NativeAudio {
    pub(crate) fn new() -> Self {
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
                    eq_gains: [0.0; 5],
                    rate: 1.0,
                volume: 0.85,
                ended_emitted: false,
                fade_in: None,
                fade_out: None,
                spectrum: Arc::new(SpectrumLevels::default()),
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
        let source = SpectrumSource::new(source, Arc::clone(&self.spectrum));

        if loop_current {
            Ok(Box::new(source.repeat_infinite()))
        } else {
            Ok(Box::new(source))
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

    pub(crate) fn current_position(&self) -> f64 {
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

    pub(crate) fn tick(&mut self) {
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

    pub(crate) fn play(&mut self) -> Result<(), String> {
        if let Some(sink) = &self.sink {
            sink.play();
            self.start_instant = Some(Instant::now());
            self.is_playing = true;
        }
        Ok(())
    }

    pub(crate) fn play_from(&mut self, position_sec: f64) -> Result<(), String> {
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

    pub(crate) fn set_volume(&mut self, volume: f32) {
        self.volume = volume;
        if let Some(sink) = &self.sink {
            sink.set_volume(volume);
        }
        if let Some(sink) = &self.fading_sink {
            sink.set_volume(volume);
        }
    }

    pub(crate) fn set_rate(&mut self, rate: f32) -> Result<(), String> {
        self.rate = rate.max(0.25);
        if self.sink.is_some() {
            let position = self.current_position();
            let was_playing = self.is_playing;
            self.rebuild_sink(position, was_playing)?;
        }
        Ok(())
    }

    pub(crate) fn set_loop(&mut self, enabled: bool) -> Result<(), String> {
        self.loop_current = enabled;
        if self.sink.is_some() {
            let position = self.current_position();
            let was_playing = self.is_playing;
            self.rebuild_sink(position, was_playing)?;
        }
        Ok(())
    }

    pub(crate) fn set_eq_gains(&mut self, gains: [f32; 5]) -> Result<(), String> {
        self.eq_gains = gains.map(|gain| gain.clamp(-12.0, 12.0));
        if self.sink.is_some() {
            let position = self.current_position();
            let was_playing = self.is_playing;
            self.rebuild_sink(position, was_playing)?;
        }
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

        let device = device.ok_or_else(|| "No output device available".to_string())?;
        let (stream, handle) = OutputStream::try_from_device(&device).map_err(|err| err.to_string())?;

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
