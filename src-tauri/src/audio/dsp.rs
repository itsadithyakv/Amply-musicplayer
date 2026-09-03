use std::f32::consts::PI;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
};
use std::time::Duration;

use rodio::Source;

pub(crate) const EQ_BAND_FREQUENCIES: [f32; 5] = [60.0, 250.0, 1000.0, 4000.0, 12000.0];

#[derive(Clone, Copy, Debug)]
pub(crate) struct BiquadCoeffs {
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

pub(crate) struct BiquadSource<S>
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
    pub(crate) fn new(inner: S, coeffs: BiquadCoeffs) -> Self {
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

pub(crate) const AUDIO_SPECTRUM_BANDS: usize = 8;
const AUDIO_SPECTRUM_CUTOFFS: [f32; AUDIO_SPECTRUM_BANDS - 1] =
    [120.0, 250.0, 500.0, 1_000.0, 2_000.0, 4_000.0, 8_000.0];
const AUDIO_SPECTRUM_GAIN: [f32; AUDIO_SPECTRUM_BANDS] =
    [4.2, 4.8, 5.3, 5.8, 6.3, 6.8, 7.3, 7.8];

pub(crate) struct SpectrumLevels {
    bands: [AtomicU32; AUDIO_SPECTRUM_BANDS],
    enabled: AtomicBool,
}

impl Default for SpectrumLevels {
    fn default() -> Self {
        Self {
            bands: std::array::from_fn(|_| AtomicU32::new(0.0f32.to_bits())),
            enabled: AtomicBool::new(false),
        }
    }
}

impl SpectrumLevels {
    fn publish(&self, values: [f32; AUDIO_SPECTRUM_BANDS]) {
        for (band, value) in self.bands.iter().zip(values) {
            band.store(value.to_bits(), Ordering::Relaxed);
        }
    }

    pub(crate) fn snapshot(&self) -> [f32; AUDIO_SPECTRUM_BANDS] {
        std::array::from_fn(|index| f32::from_bits(self.bands[index].load(Ordering::Relaxed)))
    }

    pub(crate) fn reset(&self) {
        self.publish([0.0; AUDIO_SPECTRUM_BANDS]);
    }

    pub(crate) fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
        if !enabled {
            self.reset();
        }
    }
}

pub(crate) struct SpectrumSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,
    levels: Arc<SpectrumLevels>,
    channels: usize,
    channel_index: usize,
    mono_sum: f32,
    low_pass: [f32; AUDIO_SPECTRUM_BANDS - 1],
    envelope: [f32; AUDIO_SPECTRUM_BANDS],
    alpha: [f32; AUDIO_SPECTRUM_BANDS - 1],
    frames_until_publish: usize,
    publish_interval: usize,
    analysis_enabled: bool,
}

impl<S> SpectrumSource<S>
where
    S: Source<Item = f32>,
{
    pub(crate) fn new(inner: S, levels: Arc<SpectrumLevels>) -> Self {
        let channels = inner.channels().max(1) as usize;
        let sample_rate = inner.sample_rate().max(1) as f32;
        let alpha = AUDIO_SPECTRUM_CUTOFFS.map(|cutoff| {
            1.0 - (-2.0 * PI * cutoff.min(sample_rate * 0.45) / sample_rate).exp()
        });
        let publish_interval = (sample_rate as usize / 60).max(1);
        Self {
            inner,
            levels,
            channels,
            channel_index: 0,
            mono_sum: 0.0,
            low_pass: [0.0; AUDIO_SPECTRUM_BANDS - 1],
            envelope: [0.0; AUDIO_SPECTRUM_BANDS],
            alpha,
            frames_until_publish: publish_interval,
            publish_interval,
            analysis_enabled: false,
        }
    }

    fn analyze_frame(&mut self, mono: f32) {
        let enabled = self.levels.enabled.load(Ordering::Relaxed);
        if !enabled {
            if self.analysis_enabled {
                self.low_pass.fill(0.0);
                self.envelope.fill(0.0);
                self.analysis_enabled = false;
            }
            return;
        }
        self.analysis_enabled = true;
        let mut band_values = [0.0; AUDIO_SPECTRUM_BANDS];
        let mut previous_low = 0.0;
        for (index, low_pass) in self.low_pass.iter_mut().enumerate() {
            *low_pass += self.alpha[index] * (mono - *low_pass);
            band_values[index] = (*low_pass - previous_low).abs();
            previous_low = *low_pass;
        }
        band_values[AUDIO_SPECTRUM_BANDS - 1] = (mono - previous_low).abs();

        for (envelope, band_value) in self.envelope.iter_mut().zip(band_values.iter()) {
            let speed = if *band_value > *envelope { 0.34 } else { 0.012 };
            *envelope += (*band_value - *envelope) * speed;
        }

        self.frames_until_publish = self.frames_until_publish.saturating_sub(1);
        if self.frames_until_publish == 0 {
            self.frames_until_publish = self.publish_interval;
            let normalized = std::array::from_fn(|index| {
                (self.envelope[index] * AUDIO_SPECTRUM_GAIN[index]).sqrt().clamp(0.0, 1.0)
            });
            self.levels.publish(normalized);
        }
    }
}

impl<S> Iterator for SpectrumSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        self.mono_sum += sample;
        self.channel_index += 1;
        if self.channel_index >= self.channels {
            let mono = self.mono_sum / self.channels as f32;
            self.channel_index = 0;
            self.mono_sum = 0.0;
            self.analyze_frame(mono);
        }
        Some(sample)
    }
}

impl<S> Source for SpectrumSource<S>
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

pub(crate) fn biquad_peaking(sample_rate: u32, freq: f32, q: f32, gain_db: f32) -> BiquadCoeffs {
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
