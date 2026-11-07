import { describe, expect, it } from 'vitest';
import { evaluateRules, parseRules, type PlaylistRules } from '@/services/playlistRules';
import type { Song } from '@/types/music';

const DAY = 86_400;
const now = Date.UTC(2026, 10, 2) / 1000;

const song = (id: string, extra: Partial<Song> = {}): Song => ({
  id,
  path: id,
  source: 'local',
  filename: id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  genre: 'Rock',
  duration: 200,
  track: 1,
  addedAt: now - 400 * DAY,
  playCount: 0,
  favorite: false,
  ...extra,
});

const library = [
  song('loud', { genre: 'Rock', playCount: 9, lastPlayed: now - 2 * DAY }),
  song('quiet', { genre: 'Ambient', playCount: 12, favorite: true }),
  song('new', { genre: 'Rock; Indie', playCount: 1, addedAt: now - 3 * DAY, artist: 'Björk, Thom Yorke' }),
  song('long', { genre: 'Progressive Rock', playCount: 6, duration: 11 * 60, year: 1973 }),
];

const rules = (extra: Partial<PlaylistRules>): PlaylistRules => ({ match: 'all', rules: [], sort: 'title', limit: null, ...extra });
const run = (value: PlaylistRules) => evaluateRules(library, value, 'p1', now * 1000);

describe('evaluateRules', () => {
  it('matches the README example: Rock played more than five times', () => {
    const value = rules({
      rules: [
        { field: 'genre', op: 'contains', value: 'rock' },
        { field: 'plays', op: 'atLeast', value: '6' },
      ],
      sort: 'mostPlayed',
    });
    expect(run(value)).toEqual(['loud', 'long']);
  });

  it('reads multi-genre and multi-artist tags, ignoring case and accents', () => {
    expect(run(rules({ rules: [{ field: 'genre', op: 'is', value: 'indie' }] }))).toEqual(['new']);
    expect(run(rules({ rules: [{ field: 'artist', op: 'is', value: 'bjork' }] }))).toEqual(['new']);
  });

  it('handles dates, flags and numbers', () => {
    expect(run(rules({ rules: [{ field: 'added', op: 'inLast', value: '7' }] }))).toEqual(['new']);
    expect(run(rules({ rules: [{ field: 'played', op: 'notInLast', value: '30' }] }))).toEqual(['long', 'new', 'quiet']);
    expect(run(rules({ rules: [{ field: 'favorite', op: 'isTrue', value: '' }] }))).toEqual(['quiet']);
    expect(run(rules({ rules: [{ field: 'duration', op: 'atLeast', value: '10' }] }))).toEqual(['long']);
    expect(run(rules({ rules: [{ field: 'year', op: 'atMost', value: '1980' }] }))).toEqual(['long']);
  });

  it('matches any rule when asked, and limits the result', () => {
    const value = rules({
      match: 'any',
      rules: [
        { field: 'favorite', op: 'isTrue', value: '' },
        { field: 'genre', op: 'is', value: 'Progressive Rock' },
      ],
      sort: 'mostPlayed',
    });
    expect(run(value)).toEqual(['quiet', 'long']);
    expect(run({ ...value, limit: 1 })).toEqual(['quiet']);
  });

  it('treats an unfinished text rule as no filter rather than an empty playlist', () => {
    expect(run(rules({ rules: [{ field: 'album', op: 'contains', value: '  ' }] }))).toHaveLength(4);
  });

  it('keeps a random order steady through the day', () => {
    const value = rules({ sort: 'random' });
    expect(evaluateRules(library, value, 'p1', now * 1000)).toEqual(evaluateRules(library, value, 'p1', now * 1000 + 3_600_000));
  });
});

describe('parseRules', () => {
  it('keeps valid rules and drops broken ones', () => {
    const parsed = parseRules({
      match: 'any',
      sort: 'nonsense',
      limit: -3,
      rules: [
        { field: 'genre', op: 'contains', value: 'jazz' },
        { field: 'genre', op: 'atLeast', value: '3' },
        { field: 'mood', op: 'is', value: 'x' },
      ],
    });
    expect(parsed).toEqual({ match: 'any', sort: 'mostPlayed', limit: null, rules: [{ field: 'genre', op: 'contains', value: 'jazz' }] });
    expect(parseRules('rules')).toBeNull();
  });
});
