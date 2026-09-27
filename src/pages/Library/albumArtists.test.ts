import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import { buildAlbumEntries, resolveAlbumArtists, VARIOUS_ARTISTS } from '@/pages/Library/libraryGroups';

let nextId = 0;
const song = (artist: string, album: string, extra: Partial<Song> = {}): Song => {
  nextId += 1;
  return {
    id: `s${nextId}`,
    path: `D:/Music/${nextId}.mp3`,
    source: '',
    filename: `${nextId}.mp3`,
    title: `Track ${nextId}`,
    artist,
    album,
    genre: 'Unknown Genre',
    duration: 200,
    track: nextId,
    addedAt: 0,
    playCount: 1,
    favorite: false,
    ...extra,
  };
};

describe('resolveAlbumArtists (cases from a real library)', () => {
  it('keeps an album together across spellings and a guest-first credit', () => {
    const songs = [
      ...Array.from({ length: 8 }, () => song('JAY-Z, Kanye West', 'Watch The Throne (Deluxe)')),
      ...Array.from({ length: 3 }, () => song('JAŸ-Z, Kanye West', 'Watch The Throne (Deluxe)')),
      song('Kanye West, JAY-Z', 'Watch The Throne (Deluxe)'),
    ];
    expect(resolveAlbumArtists(songs).get('watch the throne (deluxe)')).toBe('JAY-Z');
    expect(buildAlbumEntries(songs, () => undefined)).toHaveLength(1);
  });

  it('files a soundtrack under Various Artists', () => {
    const songs = [
      song('Favored Nations', 'The Music of Grand Theft Auto V, Vol. 1: Original Music'),
      song('Oh No', 'The Music of Grand Theft Auto V, Vol. 1: Original Music'),
    ];
    const entries = buildAlbumEntries(songs, () => undefined);
    expect(entries).toHaveLength(1);
    expect(entries[0].artist).toBe(VARIOUS_ARTISTS);
  });

  it('keeps two artists’ same-named albums apart', () => {
    const songs = [song('Fleetwood Mac', 'Greatest Hits'), song('The Notorious B.I.G.', 'Greatest Hits')];
    expect(resolveAlbumArtists(songs).has('greatest hits')).toBe(false);
    expect(buildAlbumEntries(songs, () => undefined)).toHaveLength(2);
  });

  it('prefers a tagged album artist, and never treats "Ghost" or "Lost" as a soundtrack', () => {
    const tagged = [song('A', 'Mix', { albumArtist: 'DJ Someone' }), song('B', 'Mix', { albumArtist: 'DJ Someone' })];
    expect(resolveAlbumArtists(tagged).get('mix')).toBe('DJ Someone');
    const lost = [song('A', 'Lost'), song('B', 'Lost')];
    expect(resolveAlbumArtists(lost).has('lost')).toBe(false);
  });
});

describe('placeholder albums', () => {
  it('keeps one "Single" card per artist', () => {
    const songs = [song('Prince', 'Single'), song('U2', 'Single'), song('The Verve', 'Single')];
    const entries = buildAlbumEntries(songs, () => undefined);
    expect(entries.map((entry) => entry.artist).sort()).toEqual(['Prince', 'The Verve', 'U2']);
  });
});
