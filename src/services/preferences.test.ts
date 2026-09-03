import { beforeEach, describe, expect, it } from 'vitest';
import { PREFERENCE_PREFIX, clearPreferences, oneOf, readPreference, writePreference } from '@/services/preferences';

const isTab = oneOf(['songs', 'albums'] as const);

beforeEach(() => {
  window.localStorage.clear();
  clearPreferences();
});

describe('preferences', () => {
  it('validates stored values and falls back', () => {
    window.localStorage.setItem(PREFERENCE_PREFIX + 'tab', 'garbage');
    expect(readPreference('tab', isTab, 'songs')).toBe('songs');
    writePreference('tab', 'albums');
    expect(readPreference('tab', isTab, 'songs')).toBe('albums');
    expect(window.localStorage.getItem(PREFERENCE_PREFIX + 'tab')).toBe('albums');
  });

  it('clearPreferences removes only prefixed keys', () => {
    writePreference('a', 'x');
    window.localStorage.setItem('unrelated', '1');
    clearPreferences();
    expect(window.localStorage.getItem(PREFERENCE_PREFIX + 'a')).toBeNull();
    expect(window.localStorage.getItem('unrelated')).toBe('1');
    expect(readPreference('a', (v): v is string => typeof v === 'string', 'fallback')).toBe('fallback');
  });
});
