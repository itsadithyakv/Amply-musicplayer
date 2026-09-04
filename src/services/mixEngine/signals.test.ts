import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import { DAY, NOW, TZ } from './fixtures';
import { computeSignals, localHourOf, toSeconds } from './signals';
import { dayKeyFor, idsWithinDays, previousEntry, withTodayEntry } from './history';

const song = (overrides: Partial<Song>): Song => ({
  id: 'x',
  path: '/m/x.mp3',
  source: 'local',
  filename: 'x.mp3',
  title: 'Sunny Morning',
  artist: 'Band feat. Guest',
  album: '',
  genre: 'Ambient',
  duration: 200,
  track: 1,
  addedAt: NOW - 100 * DAY,
  playCount: 0,
  favorite: false,
  ...overrides,
});

describe('signals', () => {
  it('converts milliseconds and seconds alike', () => {
    expect(toSeconds(NOW)).toBe(NOW);
    expect(toSeconds(NOW * 1000)).toBe(NOW);
    expect(toSeconds(undefined)).toBeUndefined();
  });

  it('uses local hours for the listening profile', () => {
    // 12:00 UTC is 17:30 in IST (offset -330).
    expect(localHourOf(NOW, TZ)).toBe(17);
    expect(localHourOf(NOW, 0)).toBe(12);
    expect(localHourOf(NOW, 300)).toBe(7);
  });

  it('computes decayed plays from events and falls back to playCount otherwise', () => {
    const withEvents = computeSignals({
      songs: [song({ id: 'e', playCount: 3, lastPlayed: NOW - DAY })],
      nowSec: NOW,
      tzOffsetMinutes: TZ,
      events: [
        { songId: 'e', at: NOW * 1000, listenedRatio: 1, skipped: false },
        { songId: 'e', at: (NOW - 30 * DAY) * 1000, listenedRatio: 0.5, skipped: false },
        { songId: 'e', at: (NOW - 2 * DAY) * 1000, listenedRatio: 0, skipped: true },
      ],
    }).signals[0];
    expect(withEvents.decayedPlays).toBeCloseTo(1 + Math.exp(-1), 5);
    expect(withEvents.recentPlays21d).toBe(1);
    expect(withEvents.skipRate).toBeCloseTo(1 / 3, 5);
    expect(withEvents.completion).toBeCloseTo(0.5, 5);

    const fallback = computeSignals({
      songs: [song({ id: 'f', playCount: 10, lastPlayed: NOW - 60 * DAY })],
      nowSec: NOW,
      tzOffsetMinutes: TZ,
    }).signals[0];
    expect(fallback.decayedPlays).toBeCloseTo(10 * Math.exp(-1), 5);
    expect(fallback.recentPlays21d).toBe(0);
  });

  it('clamps the completion fallback to plays x duration (old data double counts)', () => {
    const signal = computeSignals({
      songs: [song({ id: 'c', playCount: 2, duration: 100, totalPlaySeconds: 900, lastPlayed: NOW - DAY })],
      nowSec: NOW,
      tzOffsetMinutes: TZ,
    }).signals[0];
    expect(signal.completion).toBe(1);
  });

  it('keys untagged albums by artwork, then folder, never by song id', () => {
    const { signals } = computeSignals({
      songs: [
        song({ id: 'a', album: '', albumArt: 'amplyart://cover.jpg', path: 'D:/music/folder/a.mp3' }),
        song({ id: 'b', album: '', albumArt: 'amplyart://cover.jpg', path: 'D:/music/other/b.mp3' }),
        song({ id: 'c', album: '', path: 'D:/music/folder/c.mp3' }),
        song({ id: 'd', album: '', path: 'D:/music/folder/d.mp3' }),
      ],
      nowSec: NOW,
      tzOffsetMinutes: TZ,
    });
    expect(signals[0].albumKey).toBe(signals[1].albumKey);
    expect(signals[2].albumKey).toBe(signals[3].albumKey);
    expect(signals[2].albumKey).not.toBe(signals[0].albumKey);
    expect(signals[0].artistKey).toBe('band');
  });

  it('marks new songs, infers genres and exposes mood hints', () => {
    const { signals, stats } = computeSignals({
      songs: [
        song({ id: 'n', addedAt: NOW - 3 * DAY, artist: 'Solo', genre: 'Melodic Death Metal' }),
        song({ id: 'm', addedAt: NOW - 300 * DAY, artist: 'Solo', genre: 'Death Metal' }),
        song({ id: 'u', addedAt: NOW - 300 * DAY, artist: 'Solo', genre: 'Unknown Genre' }),
      ],
      nowSec: NOW,
      tzOffsetMinutes: TZ,
    });
    expect(signals[0].isNew).toBe(true);
    expect(signals[1].isNew).toBe(false);
    expect(signals[2].genre).toBe('Metal');
    expect(signals[2].genreInferred).toBe(true);
    expect(signals[2].genreHints.has('metal')).toBe(true);
    expect(signals[0].titleHints.has('sun')).toBe(false);
    expect(stats.coldStart).toBe(true);
  });

  it('reads the taste profile instead of only writing it', () => {
    const { stats } = computeSignals({
      songs: [song({ id: 'a', artist: 'Loved', genre: 'Jazz' }), song({ id: 'b', artist: 'Other', genre: 'Pop' })],
      nowSec: NOW,
      tzOffsetMinutes: TZ,
      tasteProfile: {
        updatedAt: NOW,
        topArtists: [{ name: 'Loved', count: 10 }],
        topGenres: [{ name: 'Smooth Jazz', count: 10 }],
        dayparts: { morning: 0, afternoon: 0, evening: 0, night: 0 },
        skipRate: 0,
        completionRate: 0,
        explorationRate: 0,
      },
    });
    expect(stats.taste.artistShare.get('loved')).toBeGreaterThan(0);
    expect(stats.taste.genreShare.get('Jazz')).toBeGreaterThan(0);
    expect(stats.taste.artistShare.get('other') ?? 0).toBe(0);
  });
});

describe('history helpers', () => {
  it('derives the local day key', () => {
    expect(dayKeyFor(NOW, TZ)).toBe('2026-09-04');
    // 20:00 UTC on the 4th is already the 5th at UTC+5:30.
    expect(dayKeyFor(NOW + 8 * 3600, TZ)).toBe('2026-09-05');
  });

  it('finds yesterday, windows and prepends today trimmed to 14', () => {
    let history = {};
    for (let day = 1; day <= 20; day += 1) {
      history = withTodayEntry(history, 'mix', `2026-08-${String(day).padStart(2, '0')}`, [`s${day}`]);
    }
    const entries = (history as Record<string, Array<{ dayKey: string }>>).mix;
    expect(entries).toHaveLength(14);
    expect(entries[0].dayKey).toBe('2026-08-20');
    expect(previousEntry(history, 'mix', '2026-08-20')?.dayKey).toBe('2026-08-19');
    expect(previousEntry(history, 'mix', '2026-08-21')?.dayKey).toBe('2026-08-20');
    const recent = idsWithinDays(history, 'mix', '2026-08-21', 7);
    expect(recent.has('s20')).toBe(true);
    expect(recent.has('s14')).toBe(true);
    expect(recent.has('s13')).toBe(false);
  });
});
