import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import { filterPlaylistSongs, indexPlaylistSongs } from './playlistComposerModel';

const song = (index: number): Song => ({
  id: `song-${index}`,
  path: `C:/music/${index}.flac`,
  source: 'local',
  filename: `${index}.flac`,
  title: index === 24_999 ? 'Needle in the library' : `Track ${index}`,
  artist: `Artist ${index % 50}`,
  album: `Album ${index % 200}`,
  genre: 'Music',
  duration: 180,
  track: index,
  addedAt: index,
  playCount: index % 100,
  favorite: index % 7 === 0,
});

describe('playlist composer model', () => {
  const songs = Array.from({ length: 25_000 }, (_, index) => song(index));
  const indexed = indexPlaylistSongs(songs);

  it('does not cap large libraries', () => {
    expect(filterPlaylistSongs(indexed, '', 'all')).toHaveLength(25_000);
  });

  it('searches every indexed track', () => {
    expect(filterPlaylistSongs(indexed, 'needle in the library', 'all').map((item) => item.id)).toEqual(['song-24999']);
  });

  it('filters favorites and preserves their library order', () => {
    const favorites = filterPlaylistSongs(indexed, '', 'favorites');
    expect(favorites.length).toBeGreaterThan(3_000);
    expect(favorites.every((item) => item.favorite)).toBe(true);
    expect(favorites[0]?.id).toBe('song-0');
  });

  it('sorts recent and most-played views without mutating the index', () => {
    expect(filterPlaylistSongs(indexed, '', 'recent')[0]?.id).toBe('song-24999');
    expect(filterPlaylistSongs(indexed, '', 'most_played')[0]?.playCount).toBe(99);
    expect(indexed[0]?.song.id).toBe('song-0');
  });
});
