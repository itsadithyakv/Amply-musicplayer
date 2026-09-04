import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import { GENRE_TAXONOMY, canonicalGenre, genreSlug, inferGenreForSong, isUnknownGenreLabel } from './genres';

const cases: Array<[string, string | null]> = [
  ['Pop', 'Pop'],
  ['K-Pop', 'Pop'],
  ['Synth-pop', 'Pop'],
  ['Dance Pop', 'Pop'],
  ['Rock', 'Rock'],
  ['Alternative', 'Rock'],
  ['Alt-Country', 'Country'],
  ['Alternative Hip Hop', 'Hip-Hop'],
  ['Trip Hop', 'Electronic'],
  ['Post-Punk', 'Punk'],
  ['Pop Punk', 'Punk'],
  ['Melodic Death Metal', 'Metal'],
  ['Symphonic Metal', 'Metal'],
  ['Folk Rock', 'Folk'],
  ['Indie Rock', 'Indie'],
  ['Warehouse Techno', 'Electronic'],
  ['Drum & Bass', 'Electronic'],
  ['Ambient Techno', 'Ambient'],
  ['Lo-Fi', 'Ambient'],
  ['R&B', 'R&B'],
  ['Rhythm and Blues', 'R&B'],
  ['Neo Soul', 'R&B'],
  ['Delta Blues', 'Blues'],
  ['Smooth Jazz', 'Jazz'],
  ['Orchestral', 'Classical'],
  ['Bluegrass', 'Country'],
  ['Singer-Songwriter', 'Folk'],
  ['Reggaeton', 'Latin'],
  ['Dancehall', 'Reggae'],
  ['Nu-Disco', 'Funk/Disco'],
  ['Funk', 'Funk/Disco'],
  ['Film Score', 'Soundtrack'],
  ['Bollywood', 'World'],
  ['Afrobeats', 'World'],
  ['Gospel', 'Gospel'],
  ['Rock; Pop', 'Rock'],
  // False positives the old `includes` matcher produced.
  ['Waltz', null],
  ['Warehouse', null],
  ['Trapeze', null],
  ['Popular Science', null],
  ['Unknown Genre', null],
  ['unknown', null],
  ['', null],
  ['N/A', null],
];

describe('canonicalGenre', () => {
  it.each(cases)('%s -> %s', (raw, expected) => {
    expect(canonicalGenre(raw)).toBe(expected);
  });

  it('only ever returns taxonomy labels', () => {
    for (const [raw] of cases) {
      const genre = canonicalGenre(raw);
      if (genre !== null) {
        expect(GENRE_TAXONOMY).toContain(genre);
      }
    }
  });

  it('never yields an "Unknown Genre" bucket', () => {
    expect(isUnknownGenreLabel('Unknown Genre')).toBe(true);
    expect(canonicalGenre('unknown genre')).toBeNull();
    expect(GENRE_TAXONOMY.some((genre) => /unknown/i.test(genre))).toBe(false);
  });

  it('keeps the old slug rules for mix ids', () => {
    expect(genreSlug('Hip-Hop')).toBe('hip-hop');
    expect(genreSlug('R&B')).toBe('r-b');
    expect(genreSlug('Funk/Disco')).toBe('funk-disco');
  });
});

describe('inferGenreForSong', () => {
  const song = (id: string, genre: string, artist = 'Band'): Song => ({
    id,
    path: `/m/${id}.mp3`,
    source: 'local',
    filename: `${id}.mp3`,
    title: id,
    artist,
    album: 'A',
    genre,
    duration: 200,
    track: 1,
    addedAt: 0,
    playCount: 0,
    favorite: false,
  });

  it('uses the artist dominant canonical genre when the song is untagged', () => {
    const siblings = [song('a', 'Melodic Death Metal'), song('b', 'Black Metal'), song('c', 'Pop')];
    const untagged = song('d', 'Unknown Genre');
    const byArtist = new Map([['band', [...siblings, untagged]]]);
    expect(inferGenreForSong(untagged, byArtist)).toBe('Metal');
  });

  it('returns null without a majority', () => {
    const siblings = [song('a', 'Pop'), song('b', 'Jazz')];
    const untagged = song('d', '');
    expect(inferGenreForSong(untagged, new Map([['band', [...siblings, untagged]]]))).toBeNull();
  });

  it('prefers the song own tag', () => {
    expect(inferGenreForSong(song('x', 'Jazz'), new Map([['band', [song('a', 'Pop')]]]))).toBe('Jazz');
  });
});
