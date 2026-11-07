import { afterEach, describe, expect, it } from 'vitest';
import { decideLibraryGrant, FREE_SONG_LIMIT, freeSongIds, isLibraryUnlimited, lockedSongIds, playableSongs, useLibraryGrant } from '@/services/libraryAccess';
import { canShowLyrics, FREE_LYRICS_PER_DAY, localDay } from '@/services/lyricsAllowance';
import { useProStore } from '@/store/proStore';
import type { Song } from '@/types/music';

const song = (n: number, addedAt: number): Song => ({
  id: `s${n}`,
  path: `C:/Music/${String(n).padStart(4, '0')}.mp3`,
  source: 'local',
  filename: `${n}.mp3`,
  title: `Song ${n}`,
  artist: 'Artist',
  album: 'Album',
  genre: 'Rock',
  duration: 200,
  track: 1,
  addedAt,
  playCount: 0,
  favorite: false,
});

// 260 songs: the newest first, so "first added" is not the list order.
const library = Array.from({ length: 260 }, (_, i) => song(i, 10_000 - i));

afterEach(() => {
  useLibraryGrant.setState({ unlimited: null });
  useProStore.setState({ isPro: false });
});

describe('the free library', () => {
  it('plays the first songs added, whatever order the list is in', () => {
    const free = freeSongIds(library);
    expect(free.size).toBe(FREE_SONG_LIMIT);
    expect(free.has('s259')).toBe(true); // added first
    expect(free.has('s0')).toBe(false); // added last
    expect(freeSongIds([...library].reverse())).toEqual(free);
  });

  it('keeps the same songs when more are added later', () => {
    const before = freeSongIds(library);
    const after = freeSongIds([...library, song(999, 20_000)]);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('breaks ties on the date added by path, so a fresh scan is stable', () => {
    const sameTime = Array.from({ length: 210 }, (_, i) => song(i, 5));
    const free = freeSongIds([...sameTime].reverse());
    expect(free.has('s0')).toBe(true);
    expect(free.has('s209')).toBe(false);
  });

  it('locks nothing when unlimited or under the limit', () => {
    expect(lockedSongIds(library, true).size).toBe(0);
    expect(lockedSongIds(library.slice(0, FREE_SONG_LIMIT), false).size).toBe(0);
    expect(lockedSongIds(library, false).size).toBe(60);
  });

  it('mixes only playable songs, judged against the whole library', () => {
    useLibraryGrant.setState({ unlimited: false });
    const subset = library.slice(0, 20); // the 20 newest: all locked
    expect(playableSongs(subset, library)).toEqual([]);
    expect(playableSongs(library)).toHaveLength(FREE_SONG_LIMIT);
  });
});

describe('the library grant', () => {
  it('lets an install that already had songs keep all of them, and remembers it', async () => {
    await decideLibraryGrant(true);
    expect(useLibraryGrant.getState().unlimited).toBe(true);
    useLibraryGrant.setState({ unlimited: null });
    await decideLibraryGrant(false); // a later launch with an empty cache keeps the first decision
    expect(useLibraryGrant.getState().unlimited).toBe(true);
  });

  it('treats an undecided grant and Pro as unlimited', () => {
    expect(isLibraryUnlimited()).toBe(true);
    useLibraryGrant.setState({ unlimited: false });
    expect(isLibraryUnlimited()).toBe(false);
    useProStore.setState({ isPro: true });
    expect(isLibraryUnlimited()).toBe(true);
  });
});

describe('daily lyrics', () => {
  const day = localDay(new Date(2026, 10, 7));
  const ids = Array.from({ length: FREE_LYRICS_PER_DAY }, (_, i) => `song${i}`);

  it('shows lyrics for a new song until the day is used up', () => {
    expect(canShowLyrics('new', false, { day, ids: ids.slice(0, 3) })).toBe(true);
    expect(canShowLyrics('new', false, { day, ids })).toBe(false);
  });

  it('lets a song already shown today show again, and Pro show anything', () => {
    expect(canShowLyrics('song4', false, { day, ids })).toBe(true);
    expect(canShowLyrics('new', true, { day, ids })).toBe(true);
  });

  it('names days by local date', () => {
    expect(day).toBe('2026-11-07');
  });
});
