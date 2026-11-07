import { isMoreMixPlaylistId } from '@/services/mixEngine';
import type { AppSettings } from '@/types/music';

/**
 * What Amply Pro adds. Free plays a library of up to 200 songs (an older, bigger library keeps all of
 * it), shows lyrics for 10 songs a day and always lets you get your data out (M3U, backups); Pro
 * lifts those limits and adds fine control, extra discovery and desktop extras.
 *
 * Saved settings always hold what the user chose. Free installs run on `limitSettings`, so a Pro
 * choice is never overwritten and comes back as it was when Pro is bought.
 */
export const PRO_FEATURES = [
  'unlimitedLibrary',
  'unlimitedLyrics',
  'artistInfo',
  'themes',
  'smartRules',
  'encore',
  'miniPlayer',
  'equalizer',
  'crossfade',
  'moreMixes',
  'mixRefresh',
  'fullStats',
  'tagEditor',
  'duplicateFinder',
  'gameMode',
  'mixTuning',
  'albumNormalization',
  'visualizerStyles',
] as const;

export type ProFeature = (typeof PRO_FEATURES)[number];

type EqPreset = AppSettings['eqPreset'];
type VisualizerTheme = AppSettings['lyricsVisualTheme'];

const PRO_EQ_PRESETS: ReadonlySet<EqPreset> = new Set<EqPreset>(['warm', 'club', 'custom']);
const FLAT_BANDS: readonly number[] = Object.freeze([0, 0, 0, 0, 0]);
const FREE_VISUALIZER_THEME: VisualizerTheme = 'ember';
const FREE_DISCOVERY = 0.35;
const FREE_RANDOMNESS = 0.3;

export const isProEqPreset = (preset: EqPreset): boolean => PRO_EQ_PRESETS.has(preset);
export const isProVisualizerTheme = (theme: VisualizerTheme): boolean => theme !== FREE_VISUALIZER_THEME;
export const isProStatsRange = (range: string): boolean => range !== '7d';

/** Genre and mood mixes; the twelve core mixes are free. */
export const isProMix = (playlistId: string): boolean => isMoreMixPlaylistId(playlistId);

/**
 * The settings a free install runs on. Returns the same object when nothing is limited, so a
 * subscribed selector does not see a change.
 */
export const limitSettings = (settings: AppSettings): AppSettings => {
  const lockedEq = isProEqPreset(settings.eqPreset);
  const unchanged =
    !lockedEq &&
    settings.accentColor === 'amber' &&
    !settings.trueBlack &&
    !settings.crossfadeEnabled &&
    !settings.gameMode &&
    !settings.miniNowPlayingOverlay &&
    !settings.onlineRecommendationsEnabled &&
    settings.volumeNormalization !== 'album' &&
    !isProVisualizerTheme(settings.lyricsVisualTheme) &&
    settings.discoveryIntensity === FREE_DISCOVERY &&
    settings.randomnessIntensity === FREE_RANDOMNESS;
  if (unchanged) {
    return settings;
  }
  return {
    ...settings,
    accentColor: 'amber',
    trueBlack: false,
    eqPreset: lockedEq ? 'flat' : settings.eqPreset,
    eqBands: lockedEq ? (FLAT_BANDS as number[]) : settings.eqBands,
    // Turning crossfade on turned gapless off; without crossfade, gapless is the default again.
    gaplessEnabled: settings.crossfadeEnabled ? true : settings.gaplessEnabled,
    crossfadeEnabled: false,
    gameMode: false,
    miniNowPlayingOverlay: false,
    onlineRecommendationsEnabled: false,
    volumeNormalization: settings.volumeNormalization === 'album' ? 'track' : settings.volumeNormalization,
    lyricsVisualTheme: FREE_VISUALIZER_THEME,
    discoveryIntensity: FREE_DISCOVERY,
    randomnessIntensity: FREE_RANDOMNESS,
  };
};

/** The Pro features these saved settings were actively using, for the notice after the change. */
export const proFeaturesInUse = (settings: AppSettings): ProFeature[] => {
  const inUse: ProFeature[] = [];
  if (settings.miniNowPlayingOverlay) inUse.push('miniPlayer');
  if (isProEqPreset(settings.eqPreset)) inUse.push('equalizer');
  if (settings.crossfadeEnabled) inUse.push('crossfade');
  if (settings.gameMode) inUse.push('gameMode');
  if (settings.onlineRecommendationsEnabled || settings.discoveryIntensity !== FREE_DISCOVERY || settings.randomnessIntensity !== FREE_RANDOMNESS) {
    inUse.push('mixTuning');
  }
  if (settings.volumeNormalization === 'album') inUse.push('albumNormalization');
  if (settings.lyricsVisualsEnabled && isProVisualizerTheme(settings.lyricsVisualTheme)) inUse.push('visualizerStyles');
  return inUse;
};
