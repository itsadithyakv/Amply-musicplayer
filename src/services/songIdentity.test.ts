import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import { findMovedSongs, remapSongIdList } from '@/services/songIdentity';

const song = (id: string, extra: Partial<Song> = {}): Song => ({
  id,
  path: id,
  source: '',
  filename: `${id}.mp3`,
  title: 'Take My Breath Away',
  artist: 'Berlin',
  album: 'Top Gun',
  genre: 'Pop',
  duration: 251.4,
  track: 1,
  addedAt: 0,
  playCount: 0,
  favorite: false,
  ...extra,
});

describe('findMovedSongs', () => {
  it('pairs a moved or renamed file with its old id', () => {
    const moved = findMovedSongs([song('d__music_old_mp3', { size: 5000 })], [song('d__music_new_folder_old_mp3', { size: 5000 })]);
    expect(moved.get('d__music_old_mp3')).toBe('d__music_new_folder_old_mp3');
  });

  it('refuses a different file with the same tags but another size', () => {
    expect(findMovedSongs([song('a', { size: 5000 })], [song('b', { size: 7000 })]).size).toBe(0);
  });

  it('matches when the old record predates size tracking', () => {
    expect(findMovedSongs([song('a')], [song('b', { size: 7000 })]).get('a')).toBe('b');
  });

  it('leaves ambiguous pairs alone', () => {
    expect(findMovedSongs([song('a')], [song('b'), song('c')]).size).toBe(0);
    expect(findMovedSongs([song('a'), song('x')], [song('b')]).size).toBe(0);
  });

  it('never pairs different songs', () => {
    expect(findMovedSongs([song('a')], [song('b', { title: 'The Metro' })]).size).toBe(0);
    expect(findMovedSongs([song('a')], [song('b', { duration: 260 })]).size).toBe(0);
  });

  it('ignores songs without a readable duration', () => {
    expect(findMovedSongs([song('a', { duration: 0 })], [song('b', { duration: 0 })]).size).toBe(0);
  });
});

describe('remapSongIdList', () => {
  it('replaces moved ids in place and drops duplicates', () => {
    const moved = new Map([['a', 'b']]);
    expect(remapSongIdList(['x', 'a', 'b', 'y'], moved)).toEqual(['x', 'b', 'y']);
  });
});
