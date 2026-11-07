import { afterEach, describe, expect, it } from 'vitest';
import { allowedLibraryPaths, folderCount, hasPlaylistRoom, ownPlaylistCount, requireFolderRoom, requirePlaylistRoom } from '@/services/collectionLimits';
import { FREE_PLAYLIST_LIMIT } from '@/services/proFeatures';
import { buildProRequestParams, validateProRequest } from '@/services/proRequest';
import { writePreference } from '@/services/preferences';
import { BROWSER_TRIAL_PREFERENCE, useProStore } from '@/store/proStore';
import type { Playlist } from '@/types/music';

const playlist = (n: number, extra: Partial<Playlist> = {}): Playlist => ({
  id: `custom_${n}`,
  name: `List ${n}`,
  type: 'custom',
  description: '',
  songIds: [],
  updatedAt: 0,
  ...extra,
});

afterEach(() => {
  useProStore.setState({ isPro: false, owned: false, paywall: null });
});

describe('playlists on the free plan', () => {
  const five = Array.from({ length: FREE_PLAYLIST_LIMIT }, (_, i) => playlist(i));

  it('keeps five of your own; rule playlists and mixes do not count', () => {
    expect(ownPlaylistCount([...five.slice(0, 4), playlist(9, { rules: { match: 'all', conditions: [] } as never }), playlist(10, { type: 'smart' })])).toBe(4);
    expect(hasPlaylistRoom(five.slice(0, 4), false)).toBe(true);
    expect(hasPlaylistRoom(five, false)).toBe(false);
    expect(hasPlaylistRoom(five, true)).toBe(true);
  });

  it('opens the upgrade dialog for the sixth', () => {
    expect(requirePlaylistRoom(five)).toBe(false);
    expect(useProStore.getState().paywall).toEqual({ kind: 'feature', feature: 'unlimitedPlaylists' });
  });
});

describe('library folders on the free plan', () => {
  it('counts real folders, not the placeholder', () => {
    expect(folderCount(['music'])).toBe(0);
    expect(folderCount(['C:\\Music', 'D:/More', '\\\\nas\\share', 'music'])).toBe(3);
  });

  it('lets the first folder in and asks for Pro at the second', () => {
    expect(allowedLibraryPaths(['music'], ['C:/Music'], false)).toEqual({ paths: ['C:/Music'], dropped: 0 });
    expect(allowedLibraryPaths(['C:/Music'], ['C:/Music', 'D:/More', 'E:/Old'], false)).toEqual({ paths: ['C:/Music'], dropped: 2 });
    expect(requireFolderRoom(['C:/Music'])).toBe(false);
    expect(useProStore.getState().paywall).toEqual({ kind: 'feature', feature: 'libraryFolders' });
  });

  it('never drops folders a library already had, and lets you swap one', () => {
    expect(allowedLibraryPaths(['C:/A', 'D:/B'], ['C:/A', 'D:/B'], false).paths).toEqual(['C:/A', 'D:/B']);
    expect(allowedLibraryPaths(['C:/A'], ['E:/New'], false)).toEqual({ paths: ['E:/New'], dropped: 0 });
    expect(allowedLibraryPaths(['C:/A'], ['C:/A', 'D:/B'], true).dropped).toBe(0);
  });
});

describe('asking for a free code', () => {
  it('needs an email and a word about the situation', () => {
    expect(validateProRequest({ email: '', note: '' })).toEqual({ email: 'emailMissing', note: 'noteShort' });
    expect(validateProRequest({ email: 'me@example', note: 'short' })).toEqual({ email: 'emailInvalid', note: 'noteShort' });
    expect(validateProRequest({ email: 'me@example.com', note: 'I am a student and money is tight.' })).toEqual({});
  });

  it('sends only what the person wrote, plus version and language', () => {
    const params = buildProRequestParams({ email: ' me@example.com ', note: 'Student, no card yet.' }, { appVersion: '1.8.1', language: 'en' }, 'AMP-TEST');
    expect(params.reply_to).toBe('me@example.com');
    expect(params.kind).toBe('Pro code request');
    expect(params.details).toContain('Student, no card yet.');
    expect(params.app_log).toBe('Not included');
    expect(params.library_size).toBe('Not included');
  });
});

describe('the trial', () => {
  it('counts as Pro while it lasts, and only then', async () => {
    writePreference(BROWSER_TRIAL_PREFERENCE, '');
    await useProStore.getState().refresh();
    expect(useProStore.getState().trial.available).toBe(true);
    expect(await useProStore.getState().startTrial()).toBe(true);
    expect(useProStore.getState().isPro).toBe(true);
    expect(useProStore.getState().owned).toBe(false);

    // Eight days ago: over, and it does not come back.
    writePreference(BROWSER_TRIAL_PREFERENCE, String(Math.floor(Date.now() / 1000) - 8 * 86_400));
    await useProStore.getState().refresh();
    expect(useProStore.getState().isPro).toBe(false);
    expect(await useProStore.getState().startTrial()).toBe(false);
    expect(useProStore.getState().trial.available).toBe(false);
    writePreference(BROWSER_TRIAL_PREFERENCE, '');
  });
});
