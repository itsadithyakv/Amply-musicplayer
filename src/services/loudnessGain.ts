import type { Song } from '@/types/music';

export type VolumeNormalization = 'off' | 'track' | 'album';

/** Measured by the Rust side (EBU R128) for files without ReplayGain tags. */
export interface MeasuredLoudness {
  lufs: number;
  peak: number;
}

/** The level every song is brought to: what Spotify and YouTube call "normal". */
const TARGET_LUFS = -14;
/** ReplayGain gains aim at -18 LUFS; this moves them onto the same target as measured songs. */
const REPLAYGAIN_TO_TARGET_DB = TARGET_LUFS - -18;
/** Quiet songs are raised at most this much, and never past their peak (no clipping). */
const MAX_BOOST_DB = 6;
const MAX_CUT_DB = -20;

/**
 * Gain in dB that brings `song` to the target loudness, or 0 when there is nothing to go on.
 * Tagged ReplayGain wins (album gain in album mode, when present); otherwise the measurement.
 * Positive gain is capped so the loudest sample stays at or below full scale.
 */
export const computeGainDb = (
  mode: VolumeNormalization,
  song: Pick<Song, 'replayGain' | 'replayGainAlbum' | 'replayPeak'>,
  measured: MeasuredLoudness | null | undefined,
): number => {
  if (mode === 'off') {
    return 0;
  }
  let gain: number | null = null;
  let peak: number | null = null;
  const tagged = mode === 'album' ? song.replayGainAlbum ?? song.replayGain : song.replayGain;
  if (typeof tagged === 'number' && Number.isFinite(tagged)) {
    gain = tagged + REPLAYGAIN_TO_TARGET_DB;
    peak = song.replayPeak ?? null;
  } else if (measured && Number.isFinite(measured.lufs)) {
    gain = TARGET_LUFS - measured.lufs;
    peak = measured.peak;
  }
  if (gain === null) {
    return 0;
  }
  let limited = Math.min(Math.max(gain, MAX_CUT_DB), MAX_BOOST_DB);
  if (limited > 0 && peak && peak > 0) {
    limited = Math.min(limited, -20 * Math.log10(peak));
  }
  return Math.round(limited * 100) / 100;
};

export const dbToFactor = (db: number): number => 10 ** (db / 20);
