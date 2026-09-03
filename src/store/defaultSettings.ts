import type { AppSettings, OnlineRecommendationProvider } from '@/types/music';

export const DEFAULT_SETTINGS: AppSettings = {
  libraryPath: 'music',
  appTheme: 'light',
  crossfadeEnabled: false,
  crossfadeDurationSec: 6,
  gaplessEnabled: true,
  playbackSpeed: 1,
  outputDeviceName: undefined,
  eqPreset: 'flat',
  eqBands: [0, 0, 0, 0, 0],
  launchOnStartup: false,
  gameMode: false,
  miniNowPlayingOverlay: false,
  overlaySpinningArtwork: true,
  overlayAutoHide: true,
  lyricsVisualsEnabled: false,
  lyricsVisualTheme: 'ember',
  metadataFetchPaused: false,
  discoveryIntensity: 0.35,
  randomnessIntensity: 0.3,
  pauseMixRegenDuringPlayback: true,
  onlineRecommendationsEnabled: false,
  lastFmApiKey: '',
  onlineRecommendationProviderOrder: ['lastfm', 'musicbrainz'],
  autoPauseOnFocus: true,
  autoPauseIgnoreApps: [],
  autoPauseIgnoreFullscreen: true,
};

const EQ_PRESETS = new Set<AppSettings['eqPreset']>(['flat', 'warm', 'bass', 'treble', 'vocal', 'club', 'custom']);
const LYRICS_THEMES = new Set<AppSettings['lyricsVisualTheme']>(['ember', 'aurora', 'mono']);
const PROVIDERS = new Set<OnlineRecommendationProvider>(['lastfm', 'musicbrainz']);

const num = (value: unknown, fallback: number, min: number, max: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
};

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback);

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/**
 * Coerce an arbitrary persisted object into a fully-populated, valid AppSettings.
 * Unknown keys are dropped, invalid values fall back to DEFAULT_SETTINGS.
 */
export const normalizeSettings = (input: unknown): AppSettings => {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const eqBandsRaw = Array.isArray(raw.eqBands) ? raw.eqBands : d.eqBands;
  const eqBands = Array.from({ length: 5 }, (_, i) => num(eqBandsRaw[i], 0, -12, 12));
  const providerOrder = Array.isArray(raw.onlineRecommendationProviderOrder)
    ? raw.onlineRecommendationProviderOrder.filter((p): p is OnlineRecommendationProvider =>
        PROVIDERS.has(p as OnlineRecommendationProvider),
      )
    : [];
  const eqPreset = raw.eqPreset as AppSettings['eqPreset'];
  const lyricsTheme = raw.lyricsVisualTheme as AppSettings['lyricsVisualTheme'];
  const outputDeviceName = typeof raw.outputDeviceName === 'string' && raw.outputDeviceName ? raw.outputDeviceName : undefined;

  return {
    libraryPath: str(raw.libraryPath, d.libraryPath),
    appTheme: raw.appTheme === 'dark' ? 'dark' : 'light',
    crossfadeEnabled: bool(raw.crossfadeEnabled, d.crossfadeEnabled),
    crossfadeDurationSec: num(raw.crossfadeDurationSec, d.crossfadeDurationSec, 1, 20),
    gaplessEnabled: bool(raw.gaplessEnabled, d.gaplessEnabled),
    playbackSpeed: num(raw.playbackSpeed, d.playbackSpeed, 0.5, 2),
    outputDeviceName,
    eqPreset: EQ_PRESETS.has(eqPreset) ? eqPreset : d.eqPreset,
    eqBands,
    launchOnStartup: bool(raw.launchOnStartup, d.launchOnStartup),
    gameMode: bool(raw.gameMode, d.gameMode),
    miniNowPlayingOverlay: bool(raw.miniNowPlayingOverlay, d.miniNowPlayingOverlay),
    overlaySpinningArtwork: bool(raw.overlaySpinningArtwork, d.overlaySpinningArtwork),
    overlayAutoHide: bool(raw.overlayAutoHide, d.overlayAutoHide),
    lyricsVisualsEnabled: bool(raw.lyricsVisualsEnabled, d.lyricsVisualsEnabled),
    lyricsVisualTheme: LYRICS_THEMES.has(lyricsTheme) ? lyricsTheme : d.lyricsVisualTheme,
    metadataFetchPaused: bool(raw.metadataFetchPaused, d.metadataFetchPaused),
    discoveryIntensity: num(raw.discoveryIntensity, d.discoveryIntensity, 0, 1),
    randomnessIntensity: num(raw.randomnessIntensity, d.randomnessIntensity, 0, 1),
    pauseMixRegenDuringPlayback: bool(raw.pauseMixRegenDuringPlayback, d.pauseMixRegenDuringPlayback),
    onlineRecommendationsEnabled: bool(raw.onlineRecommendationsEnabled, d.onlineRecommendationsEnabled),
    lastFmApiKey: str(raw.lastFmApiKey, d.lastFmApiKey ?? ''),
    onlineRecommendationProviderOrder: providerOrder.length ? providerOrder : [...d.onlineRecommendationProviderOrder],
    autoPauseOnFocus: bool(raw.autoPauseOnFocus, d.autoPauseOnFocus),
    autoPauseIgnoreApps: strArray(raw.autoPauseIgnoreApps),
    autoPauseIgnoreFullscreen: bool(raw.autoPauseIgnoreFullscreen, d.autoPauseIgnoreFullscreen),
  };
};
