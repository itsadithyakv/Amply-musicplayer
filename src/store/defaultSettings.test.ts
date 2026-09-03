import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings } from '@/store/defaultSettings';

describe('normalizeSettings', () => {
  it('returns defaults for garbage input', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps valid values and rejects invalid ones', () => {
    const result = normalizeSettings({
      appTheme: 'dark',
      playbackSpeed: 9,
      eqBands: [1, 2, 'x', 40],
      eqPreset: 'not-a-preset',
      lyricsVisualTheme: 'aurora',
      onlineRecommendationProviderOrder: ['musicbrainz', 'bogus'],
      autoPauseIgnoreApps: ['chrome.exe', 3],
      discoveryIntensity: -1,
      outputDeviceName: '',
      unknownKey: true,
    });
    expect(result.appTheme).toBe('dark');
    expect(result.playbackSpeed).toBe(2);
    expect(result.eqBands).toEqual([1, 2, 0, 12, 0]);
    expect(result.eqPreset).toBe('flat');
    expect(result.lyricsVisualTheme).toBe('aurora');
    expect(result.onlineRecommendationProviderOrder).toEqual(['musicbrainz']);
    expect(result.autoPauseIgnoreApps).toEqual(['chrome.exe']);
    expect(result.discoveryIntensity).toBe(0);
    expect(result.outputDeviceName).toBeUndefined();
    expect('unknownKey' in result).toBe(false);
  });

  it('does not share array references with the defaults', () => {
    const result = normalizeSettings({});
    expect(result.eqBands).not.toBe(DEFAULT_SETTINGS.eqBands);
    expect(result.onlineRecommendationProviderOrder).not.toBe(DEFAULT_SETTINGS.onlineRecommendationProviderOrder);
  });
});
