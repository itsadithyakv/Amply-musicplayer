import { describe, expect, it } from 'vitest';
import { computeGainDb, dbToFactor } from '@/services/loudnessGain';

describe('computeGainDb', () => {
  it('brings measured songs to -14 LUFS (real values from a library)', () => {
    // "20 Min": -7.6 LUFS, peak 1.0 -> 6.4 dB quieter.
    expect(computeGainDb('track', {}, { lufs: -7.6, peak: 1 })).toBe(-6.4);
    // "(You're The) Devil In Disguise": -15.5 LUFS, peak 0.769 -> +1.5 dB fits under the peak.
    expect(computeGainDb('track', {}, { lufs: -15.5, peak: 0.769 })).toBe(1.5);
  });

  it('never boosts past the peak or beyond +6 dB', () => {
    // Needs +10 dB but the peak allows only ~2.3 dB.
    expect(computeGainDb('track', {}, { lufs: -24, peak: 0.769 })).toBeCloseTo(2.28, 1);
    expect(computeGainDb('track', {}, { lufs: -30, peak: 0.1 })).toBe(6);
  });

  it('prefers ReplayGain tags, shifted from -18 to -14 LUFS, album gain in album mode', () => {
    const song = { replayGain: -8, replayGainAlbum: -6, replayPeak: 0.9 };
    expect(computeGainDb('track', song, { lufs: -5, peak: 1 })).toBe(-4);
    expect(computeGainDb('album', song, null)).toBe(-2);
    expect(computeGainDb('album', { replayGain: -8 }, null)).toBe(-4);
  });

  it('does nothing when off or when nothing is known', () => {
    expect(computeGainDb('off', { replayGain: -8 }, { lufs: -5, peak: 1 })).toBe(0);
    expect(computeGainDb('track', {}, null)).toBe(0);
  });

  it('converts dB to a linear factor', () => {
    expect(dbToFactor(0)).toBe(1);
    expect(dbToFactor(-6)).toBeCloseTo(0.501, 3);
  });
});
