import { describe, expect, it } from 'vitest';
import { isProEqPreset, isProMix, isProStatsRange, isProVisualizerTheme, limitSettings, proFeaturesInUse } from '@/services/proFeatures';
import { CROSSFADE_MIN_DURATION_SEC, shouldStartCrossfade } from '@/services/crossfade';
import { DEFAULT_SETTINGS } from '@/store/defaultSettings';
import type { AppSettings } from '@/types/music';

const everyProSetting: AppSettings = {
  ...DEFAULT_SETTINGS,
  crossfadeEnabled: true,
  gaplessEnabled: false,
  eqPreset: 'custom',
  eqBands: [6, 3, 0, -3, -6],
  gameMode: true,
  miniNowPlayingOverlay: true,
  onlineRecommendationsEnabled: true,
  volumeNormalization: 'album',
  lyricsVisualsEnabled: true,
  lyricsVisualTheme: 'aurora',
  discoveryIntensity: 0.9,
  randomnessIntensity: 0.9,
};

describe('limitSettings', () => {
  it('leaves free settings as the very same object', () => {
    expect(limitSettings(DEFAULT_SETTINGS)).toBe(DEFAULT_SETTINGS);
    const bass: AppSettings = { ...DEFAULT_SETTINGS, eqPreset: 'bass', eqBands: [4, 2, 0, 0, 0] };
    expect(limitSettings(bass)).toBe(bass);
  });

  it('runs a free install on free behaviour', () => {
    const limited = limitSettings(everyProSetting);
    expect(limited.crossfadeEnabled).toBe(false);
    // Crossfade had switched gapless off; without it, playback must not fall back to neither.
    expect(limited.gaplessEnabled).toBe(true);
    expect(limited.eqPreset).toBe('flat');
    expect(limited.eqBands).toEqual([0, 0, 0, 0, 0]);
    expect(limited.gameMode).toBe(false);
    expect(limited.miniNowPlayingOverlay).toBe(false);
    expect(limited.onlineRecommendationsEnabled).toBe(false);
    expect(limited.volumeNormalization).toBe('track');
    expect(limited.lyricsVisualTheme).toBe('ember');
    expect(limited.discoveryIntensity).toBe(DEFAULT_SETTINGS.discoveryIntensity);
    expect(limited.randomnessIntensity).toBe(DEFAULT_SETTINGS.randomnessIntensity);
  });

  it('keeps the free choices that sit beside locked ones', () => {
    const limited = limitSettings({ ...everyProSetting, volumeNormalization: 'off', playbackSpeed: 1.25, appTheme: 'dark' });
    expect(limited.volumeNormalization).toBe('off');
    expect(limited.playbackSpeed).toBe(1.25);
    expect(limited.appTheme).toBe('dark');
  });

  it('never changes what was saved', () => {
    const saved = { ...everyProSetting };
    limitSettings(saved);
    expect(saved).toEqual(everyProSetting);
  });

  it('is stable, so a selector reading through it settles', () => {
    expect(limitSettings(everyProSetting).eqBands).toBe(limitSettings(everyProSetting).eqBands);
  });
});

describe('the free and Pro line', () => {
  it('reports only the Pro features actually in use', () => {
    expect(proFeaturesInUse(DEFAULT_SETTINGS)).toEqual([]);
    expect(proFeaturesInUse({ ...DEFAULT_SETTINGS, miniNowPlayingOverlay: true })).toEqual(['miniPlayer']);
    // A chosen style with the visualizer off is not something the user would miss.
    expect(proFeaturesInUse({ ...DEFAULT_SETTINGS, lyricsVisualTheme: 'mono', lyricsVisualsEnabled: false })).toEqual([]);
    expect(proFeaturesInUse(everyProSetting)).toHaveLength(7);
  });

  it('keeps the core mixes free and locks genre and mood mixes', () => {
    for (const id of ['smart_daily_mix', 'smart_on_repeat', 'smart_explore', 'smart_favorites', 'custom_123']) {
      expect(isProMix(id)).toBe(false);
    }
    for (const id of ['smart_genre_mix_rock', 'smart_focus_mix', 'smart_late_night_mix']) {
      expect(isProMix(id)).toBe(true);
    }
  });

  it('draws the line at the presets, themes and ranges in the upgrade dialog', () => {
    expect((['flat', 'bass', 'treble', 'vocal'] as const).some(isProEqPreset)).toBe(false);
    expect((['warm', 'club', 'custom'] as const).every(isProEqPreset)).toBe(true);
    expect(isProVisualizerTheme('ember')).toBe(false);
    expect(isProVisualizerTheme('aurora')).toBe(true);
    expect(isProStatsRange('7d')).toBe(false);
    expect(isProStatsRange('all')).toBe(true);
  });
});

describe('shouldStartCrossfade', () => {
  const on = { crossfadeEnabled: true, gaplessEnabled: false, crossfadeDurationSec: 6, playbackSpeed: 1 };

  it('starts the next song one fade before the end, so they overlap', () => {
    expect(shouldStartCrossfade(on, 193.9, 200, 200)).toBe(false);
    expect(shouldStartCrossfade(on, 194, 200, 200)).toBe(true);
  });

  it('allows for playback speed', () => {
    expect(shouldStartCrossfade({ ...on, playbackSpeed: 1.5 }, 191, 200, 200)).toBe(true);
  });

  it('stays out of the way when it does not apply', () => {
    expect(shouldStartCrossfade({ ...on, crossfadeEnabled: false }, 199, 200, 200)).toBe(false);
    expect(shouldStartCrossfade({ ...on, gaplessEnabled: true }, 199, 200, 200)).toBe(false);
    expect(shouldStartCrossfade(on, CROSSFADE_MIN_DURATION_SEC - 2, CROSSFADE_MIN_DURATION_SEC - 1, 200)).toBe(false);
    expect(shouldStartCrossfade(on, 199, 200, CROSSFADE_MIN_DURATION_SEC - 1)).toBe(false);
  });
});
