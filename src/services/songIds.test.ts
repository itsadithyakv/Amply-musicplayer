import { describe, expect, it } from 'vitest';
import { withUniqueIds } from '@/services/songIds';
import type { Song } from '@/types/music';

const song = (id: string, path: string): Song => ({
  id,
  path,
  source: 'local',
  filename: path.split(/[//]/).pop() ?? path,
  title: id,
  artist: 'Artist',
  album: 'Album',
  genre: 'Pop',
  duration: 200,
  track: 1,
  addedAt: 0,
  playCount: 0,
  favorite: false,
});

describe('withUniqueIds', () => {
  it('gives two files that fold to the same id their own ids', () => {
    const songs = withUniqueIds([song('d__a_b_x_mp3', 'D:/a b/x.mp3'), song('d__a_b_x_mp3', 'D:/a_b/x.mp3')], new Map());
    expect(songs[0].id).toBe('d__a_b_x_mp3');
    expect(songs[1].id).toMatch(/^d__a_b_x_mp3_[0-9a-f]{8}$/);
  });

  it('keeps the id a file already has, so its plays and playlists stay attached', () => {
    const taken = new Map([['d__a_b_x_mp3', 'D:/a_b/x.mp3']]);
    const songs = withUniqueIds([song('d__a_b_x_mp3', 'D:/a b/x.mp3'), song('d__a_b_x_mp3', 'D:/a_b/x.mp3')], taken);
    expect(songs[1].id).toBe('d__a_b_x_mp3');
    expect(songs[0].id).not.toBe('d__a_b_x_mp3');
  });

  it('treats the same path in another case or slash style as the same file', () => {
    const taken = new Map([['d__music_x_mp3', String.raw`D:\Music\x.mp3`]]);
    expect(withUniqueIds([song('d__music_x_mp3', 'd:/music/x.mp3')], taken)[0].id).toBe('d__music_x_mp3');
  });

  it('hashes like the Rust side', () => {
    // FNV-1a of "abc" is 0x1a47e90b.
    expect(withUniqueIds([song('x', 'abc')], new Map([['x', 'other']]))[0].id).toBe('x_1a47e90b');
  });
});
