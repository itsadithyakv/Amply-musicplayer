import { isMoreMixPlaylistId } from '@/services/mixEngine';
import type { AppSettings } from '@/types/music';

/**
 * What Amply Pro adds. Free plays a library of up to 200 songs from one folder (an older, bigger
 * library keeps all of it), shows lyrics for 10 songs a day, keeps 5 playlists and always lets you get
 * your data out (M3U, backups); Pro lifts those limits and adds fine control, audiophile playback,
 * extra discovery and desktop extras. Anyone can try all of it free for 7 days, once.
 *
 * Saved settings always hold what the user chose. Free installs run on `limitSettings`, so a Pro
 * choice is never overwritten and comes back as it was when Pro is bought.
 */
export const PRO_FEATURES = [
  'unlimitedLibrary',
  'unlimitedLyrics',
  'unlimitedPlaylists',
  'libraryFolders',
  'artistInfo',
  'themes',
  'smartRules',
  'encore',
  'miniPlayer',
  'equalizer',
  'crossfade',
  'audiophile',
  'moreMixes',
  'mixRefresh',
  'fullStats',
  'tagEditor',
  'duplicateFinder',
  'gameMode',
  'mixTuning',
  'timerAndSpeed',
  'lyricsTools',
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
const NORMAL_SPEED = 1;

/** Free installs keep this many custom playlists and library folders (more made earlier are kept). */
export const FREE_PLAYLIST_LIMIT = 5;
export const FREE_FOLDER_LIMIT = 1;

export const isProEqPreset = (preset: EqPreset): boolean => PRO_EQ_PRESETS.has(preset);
export const isProVisualizerTheme = (theme: VisualizerTheme): boolean => theme !== FREE_VISUALIZER_THEME;
export const isProStatsRange = (range: string): boolean => range !== '7d';

/** Genre and mood mixes; the twelve core mixes are free. */
export const isProMix = (playlistId: string): boolean => isMoreMixPlaylistId(playlistId);

const limited = new WeakMap<AppSettings, AppSettings>();

/**
 * The settings a free install runs on. Returns the same object when nothing is limited, and the same
 * limited object for the same settings, so a subscribed selector does not see a change.
 */
export const limitSettings = (settings: AppSettings): AppSettings => {
  let result = limited.get(settings);
  if (!result) {
    result = computeLimitSettings(settings);
    limited.set(settings, result);
  }
  return result;
};

const computeLimitSettings = (settings: AppSettings): AppSettings => {
  const lockedEq = isProEqPreset(settings.eqPreset);
  const unchanged =
    !lockedEq &&
    !settings.gaplessEnabled &&
    settings.volumeNormalization === 'off' &&
    !settings.outputDeviceName &&
    settings.playbackSpeed === NORMAL_SPEED &&
    settings.accentColor === 'amber' &&
    !settings.trueBlack &&
    !settings.crossfadeEnabled &&
    !settings.gameMode &&
    !settings.miniNowPlayingOverlay &&
    !settings.onlineRecommendationsEnabled &&
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
    // Audiophile playback: gapless, loudness levelling and a chosen output device.
    gaplessEnabled: false,
    volumeNormalization: 'off',
    outputDeviceName: undefined,
    playbackSpeed: NORMAL_SPEED,
    crossfadeEnabled: false,
    gameMode: false,
    miniNowPlayingOverlay: false,
    onlineRecommendationsEnabled: false,
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
  // Gapless and track levelling are on out of the box; only a deliberate choice counts as "using" it.
  if (settings.volumeNormalization === 'album' || settings.outputDeviceName) inUse.push('audiophile');
  if (settings.playbackSpeed !== NORMAL_SPEED) inUse.push('timerAndSpeed');
  if (settings.lyricsVisualsEnabled && isProVisualizerTheme(settings.lyricsVisualTheme)) inUse.push('visualizerStyles');
  return inUse;
};
