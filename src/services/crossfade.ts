import type { AppSettings } from '@/types/music';

/** Shorter songs just cut: a fade would take up too much of them. */
export const CROSSFADE_MIN_DURATION_SEC = 20;

/**
 * Whether the next song should start now. A crossfade has to begin while the current song is still
 * playing: by the time the engine reports the end, there is nothing left to overlap with.
 */
export const shouldStartCrossfade = (
  settings: Pick<AppSettings, 'crossfadeEnabled' | 'gaplessEnabled' | 'crossfadeDurationSec' | 'playbackSpeed'>,
  positionSec: number,
  durationSec: number,
  nextDurationSec: number,
): boolean => {
  if (!settings.crossfadeEnabled || settings.gaplessEnabled) {
    return false;
  }
  if (durationSec < CROSSFADE_MIN_DURATION_SEC || nextDurationSec < CROSSFADE_MIN_DURATION_SEC) {
    return false;
  }
  // Position is in song time, so at 1.5x the same fade uses up 1.5x as much of the song.
  return positionSec >= durationSec - settings.crossfadeDurationSec * (settings.playbackSpeed || 1);
};
