use std::f32::consts::PI;
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc,
};
use std::time::Duration;

use rodio::source::SeekError;
use rodio::Source;

pub(crate) const EQ_BAND_FREQUENCIES: [f32; 5] = [60.0, 250.0, 1000.0, 4000.0, 12000.0];
pub(crate) const EQ_BAND_COUNT: usize = EQ_BAND_FREQUENCIES.len();

/// Gains below this magnitude (in dB) are treated as "flat" and use identity coefficients.
const EQ_IDENTITY_THRESHOLD_DB: f32 = 0.01;

/// Parameters shared between the audio thread and the live source chain.
///
/// The engine stores into these atomics; the DSP stages read them while
/// producing samples so EQ and rate changes apply without rebuilding the sink.
pub(crate) struct SharedParams {
    gains: [AtomicU32; EQ_BAND_COUNT],
    generation: AtomicU32,
    rate: AtomicU32,
}

impl Default for SharedParams {
    fn default() -> Self {
        Self {
            gains: std::array::from_fn(|_| AtomicU32::new(0.0f32.to_bits())),
            generation: AtomicU32::new(0),
            rate: AtomicU32::new(1.0f32.to_bits()),
        }
    }
}

impl SharedParams {
    pub(crate) fn set_gains(&self, gains: [f32; EQ_BAND_COUNT]) {
        for (slot, gain) in self.gains.iter().zip(gains) {
            slot.store(gain.to_bits(), Ordering::Relaxed);
        }
        // Release pairs with the Acquire load in `generation()` so a stage that
        // observes the new generation also observes the new gains.
        self.generation.fetch_add(1, Ordering::Release);
    }

    #[cfg(test)]
    pub(crate) fn gains(&self) -> [f32; EQ_BAND_COUNT] {
        std::array::from_fn(|index| self.gain(index))
    }

    pub(crate) fn gain(&self, band: usize) -> f32 {
        self.gains
            .get(band)
            .map(|slot| f32::from_bits(slot.load(Ordering::Relaxed)))
            .unwrap_or(0.0)
    }

    pub(crate) fn generation(&self) -> u32 {
        self.generation.load(Ordering::Acquire)
    }

    pub(crate) fn set_rate(&self, rate: f32) {
        self.rate.store(rate.to_bits(), Ordering::Relaxed);
    }

    pub(crate) fn rate(&self) -> f32 {
        f32::from_bits(self.rate.load(Ordering::Relaxed))
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct BiquadCoeffs {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
}

impl BiquadCoeffs {
    /// Pass-through coefficients: `y = x`.
    pub(crate) const IDENTITY: BiquadCoeffs = BiquadCoeffs {
        b0: 1.0,
        b1: 0.0,
        b2: 0.0,
        a1: 0.0,
        a2: 0.0,
    };

    pub(crate) fn is_identity(&self) -> bool {
        *self == Self::IDENTITY
    }
}

#[derive(Clone, Copy, Debug, Default)]
struct BiquadState {
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

/// Coefficients for one EQ band at the given gain; flat bands become identity so
/// every stage can stay in the chain permanently.
pub(crate) fn eq_band_coeffs(sample_rate: u32, band: usize, gain_db: f32) -> BiquadCoeffs {
    match EQ_BAND_FREQUENCIES.get(band) {
        Some(freq) if gain_db.abs() >= EQ_IDENTITY_THRESHOLD_DB => {
            biquad_peaking(sample_rate, *freq, 1.0, gain_db)
        }
        _ => BiquadCoeffs::IDENTITY,
    }
}

/// One peaking-EQ stage whose gain follows `SharedParams` live.
pub(crate) struct BiquadSource<S>
where
    S: Source<Item = f32>,
{
    inner: S,
    params: Arc<SharedParams>,
    band: usize,
    sample_rate: u32,
    seen_generation: u32,
    coeffs: BiquadCoeffs,
    states: Vec<BiquadState>,
    channels: usize,
    channel_index: usize,
}

impl<S> BiquadSource<S>
where
    S: Source<Item = f32>,
{
    pub(crate) fn new(inner: S, params: Arc<SharedParams>, band: usize) -> Self {
        let channels = inner.channels().max(1) as usize;
        let sample_rate = inner.sample_rate().max(1);
        // Read the generation before the gain so a concurrent update is either
        // fully visible now or re-applied on the next `next()`.
        let seen_generation = params.generation();
        let coeffs = eq_band_coeffs(sample_rate, band, params.gain(band));
        Self {
            inner,
            params,
            band,
            sample_rate,
            seen_generation,
            coeffs,
            states: vec![BiquadState::default(); channels],
            channels,
            channel_index: 0,
        }
    }

    #[inline]
    fn refresh_coeffs(&mut self) {
        let generation = self.params.generation();
        if generation != self.seen_generation {
            self.seen_generation = generation;
            self.coeffs = eq_band_coeffs(self.sample_rate, self.band, self.params.gain(self.band));
        }
    }

    fn reset_state(&mut self) {
        for state in &mut self.states {
            *state = BiquadState::default();
        }
        self.channel_index = 0;
    }

    #[cfg(test)]
    fn coeffs(&self) -> BiquadCoeffs {
        self.coeffs
    }
}

impl<S> Iterator for BiquadSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        self.refresh_coeffs();

        let channel = self.channel_index;
        self.channel_index = (self.channel_index + 1) % self.channels;

        if self.coeffs.is_identity() {
            // Keep history consistent so a later gain change starts from real state.
            let state = &mut self.states[channel];
            state.x2 = state.x1;
            state.x1 = sample;
            state.y2 = state.y1;
            state.y1 = sample;
            return Some(sample);
        }

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

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
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

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        let result = self.inner.try_seek(pos);
        if result.is_ok() {
            self.reset_state();
        }
        result
    }
}

/// Playback-rate wrapper mirroring rodio's `Speed`, but reading its factor from
/// `SharedParams` so the rate can change while the source is playing.
///
/// Like rodio's `Speed`, it reports `sample_rate() * factor`, divides
/// `total_duration` by the factor, and expects `try_seek` positions in *output*
/// time (it multiplies by the factor before forwarding). The mixer re-reads
/// `sample_rate()` at each frame boundary, so a rate change takes effect there.
pub(crate) struct SharedSpeed<S> {
    input: S,
    params: Arc<SharedParams>,
}

impl<S> SharedSpeed<S>
where
    S: Source<Item = f32>,
{
    pub(crate) fn new(input: S, params: Arc<SharedParams>) -> Self {
        Self { input, params }
    }

    #[inline]
    fn factor(&self) -> f32 {
        self.params.rate()
    }
}

impl<S> Iterator for SharedSpeed<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<f32> {
        self.input.next()
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.input.size_hint()
    }
}

impl<S> Source for SharedSpeed<S>
where
    S: Source<Item = f32>,
{
    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        self.input.current_frame_len()
    }

    #[inline]
    fn channels(&self) -> u16 {
        self.input.channels()
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        (self.input.sample_rate() as f32 * self.factor()) as u32
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.input.total_duration().map(|d| d.div_f32(self.factor()))
    }

    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        let pos_accounting_for_speedup = pos.mul_f32(self.factor());
        self.input.try_seek(pos_accounting_for_speedup)
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

    pub(crate) fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
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

    fn reset_state(&mut self) {
        self.channel_index = 0;
        self.mono_sum = 0.0;
        self.low_pass.fill(0.0);
        self.envelope.fill(0.0);
        self.frames_until_publish = self.publish_interval;
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

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.inner.size_hint()
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

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        let result = self.inner.try_seek(pos);
        if result.is_ok() {
            self.reset_state();
        }
        result
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

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    const SAMPLE_RATE: u32 = 48_000;

    fn sine(freq: f32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|index| (2.0 * PI * freq * index as f32 / SAMPLE_RATE as f32).sin())
            .collect()
    }

    fn params(gains: [f32; EQ_BAND_COUNT], rate: f32) -> Arc<SharedParams> {
        let params = Arc::new(SharedParams::default());
        params.set_gains(gains);
        params.set_rate(rate);
        params
    }

    fn eq_chain(
        data: Vec<f32>,
        params: &Arc<SharedParams>,
    ) -> Box<dyn Source<Item = f32> + Send> {
        let mut current: Box<dyn Source<Item = f32> + Send> =
            Box::new(SamplesBuffer::new(1, SAMPLE_RATE, data));
        for band in 0..EQ_BAND_COUNT {
            current = Box::new(BiquadSource::new(current, Arc::clone(params), band));
        }
        current
    }

    fn max_abs_diff(a: &[f32], b: &[f32]) -> f32 {
        assert_eq!(a.len(), b.len());
        a.iter()
            .zip(b)
            .map(|(x, y)| (x - y).abs())
            .fold(0.0, f32::max)
    }

    #[test]
    fn identity_biquad_passes_samples_through() {
        let input = sine(1_000.0, 4_800);
        let params = params([0.0; EQ_BAND_COUNT], 1.0);
        let output: Vec<f32> = eq_chain(input.clone(), &params).collect();
        assert_eq!(output.len(), input.len());
        assert!(max_abs_diff(&input, &output) < 1e-6);

        let stage = BiquadSource::new(
            SamplesBuffer::new(1, SAMPLE_RATE, vec![0.0f32; 4]),
            Arc::clone(&params),
            2,
        );
        assert!(stage.coeffs().is_identity());
    }

    #[test]
    fn boosted_band_changes_samples() {
        let input = sine(1_000.0, 4_800);
        let mut gains = [0.0; EQ_BAND_COUNT];
        gains[2] = 6.0; // 1 kHz band
        let params = params(gains, 1.0);
        let output: Vec<f32> = eq_chain(input.clone(), &params).collect();
        assert!(max_abs_diff(&input, &output) > 0.1);

        // Settled amplitude should be close to +6 dB (~2x).
        let peak = output[2_400..].iter().fold(0.0f32, |acc, v| acc.max(v.abs()));
        assert!(peak > 1.6 && peak < 2.4, "peak was {peak}");
    }

    #[test]
    fn biquad_picks_up_live_gain_change() {
        let input = sine(1_000.0, 9_600);
        let params = params([0.0; EQ_BAND_COUNT], 1.0);
        let mut chain = eq_chain(input.clone(), &params);

        let first: Vec<f32> = chain.by_ref().take(4_800).collect();
        assert!(max_abs_diff(&input[..4_800], &first) < 1e-6);

        let mut gains = [0.0; EQ_BAND_COUNT];
        gains[2] = 12.0;
        params.set_gains(gains);

        let second: Vec<f32> = chain.collect();
        assert_eq!(second.len(), 4_800);
        assert!(max_abs_diff(&input[4_800..], &second) > 0.5);
    }

    #[test]
    fn shared_speed_reports_scaled_sample_rate_and_follows_rate_changes() {
        let params = params([0.0; EQ_BAND_COUNT], 1.0);
        let inner = SamplesBuffer::new(2, SAMPLE_RATE, vec![0.0f32; 96_000]); // 1 s stereo
        let mut speed = SharedSpeed::new(inner, Arc::clone(&params));

        assert_eq!(speed.sample_rate(), SAMPLE_RATE);
        assert_eq!(speed.total_duration(), Some(Duration::from_secs(1)));

        params.set_rate(1.5);
        assert_eq!(speed.sample_rate(), 72_000);
        let total = speed.total_duration().unwrap();
        assert!((total.as_secs_f64() - 1.0 / 1.5).abs() < 1e-6);

        // Seeking takes output time and multiplies by the factor, like rodio's Speed:
        // 400 ms of output at 1.5x == 600 ms into the source.
        speed.try_seek(Duration::from_millis(400)).unwrap();
        let remaining = speed.count();
        assert_eq!(remaining, 96_000 - 600 * 48 * 2);
    }

    #[test]
    fn biquad_try_seek_resets_state_and_forwards() {
        let ramp: Vec<f32> = (0..2_000).map(|index| index as f32 / 2_000.0).collect();
        let mut gains = [0.0; EQ_BAND_COUNT];
        gains[2] = 6.0;
        let params = params(gains, 1.0);

        let mut fresh = BiquadSource::new(
            SamplesBuffer::new(1, SAMPLE_RATE, ramp.clone()),
            Arc::clone(&params),
            2,
        );
        let expected: Vec<f32> = fresh.by_ref().take(16).collect();

        let mut seeked = BiquadSource::new(
            SamplesBuffer::new(1, SAMPLE_RATE, ramp),
            Arc::clone(&params),
            2,
        );
        let _warm_up: Vec<f32> = seeked.by_ref().take(500).collect();
        seeked.try_seek(Duration::ZERO).unwrap();
        for state in &seeked.states {
            assert_eq!(state.x1, 0.0);
            assert_eq!(state.x2, 0.0);
            assert_eq!(state.y1, 0.0);
            assert_eq!(state.y2, 0.0);
        }
        let after: Vec<f32> = seeked.by_ref().take(16).collect();
        assert!(max_abs_diff(&expected, &after) < 1e-6);
    }

    #[test]
    fn spectrum_try_seek_forwards_and_resets() {
        let levels = Arc::new(SpectrumLevels::default());
        levels.set_enabled(true);
        let inner = SamplesBuffer::new(1, SAMPLE_RATE, sine(440.0, 4_800));
        let mut spectrum = SpectrumSource::new(inner, levels);
        let _warm_up: Vec<f32> = spectrum.by_ref().take(2_400).collect();
        assert!(spectrum.envelope.iter().any(|v| *v > 0.0));
        spectrum.try_seek(Duration::ZERO).unwrap();
        assert!(spectrum.envelope.iter().all(|v| *v == 0.0));
        assert_eq!(spectrum.count(), 4_800);
    }
}
