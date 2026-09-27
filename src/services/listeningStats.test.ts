import { describe, expect, it } from 'vitest';
import type { Song } from '@/types/music';
import type { ListeningEvent } from '@/services/mixEngine/types';
import { computeListeningStats, formatListeningTime, localDay } from '@/services/listeningStats';

const DAY = 86_400_000;
const now = new Date(2026, 8, 27, 20, 0, 0).getTime();

const song = (id: string, artist: string, extra: Partial<Song> = {}): Song => ({
  id,
  path: id,
  source: '',
  filename: id,
  title: `Song ${id}`,
  artist,
  album: 'Album',
  genre: 'Rock',
  duration: 200,
  track: 1,
  addedAt: 0,
  playCount: 0,
  favorite: false,
  ...extra,
});

const songs = new Map([
  ['a', song('a', 'Radiohead', { playCount: 10, totalPlaySeconds: 2000 })],
  ['b', song('b', 'Radiohead, Björk', { playCount: 3, totalPlaySeconds: 600, genre: 'Unknown Genre' })],
  ['c', song('c', 'Daft Punk', { playCount: 1, totalPlaySeconds: 200, genre: 'Electronic' })],
]);

const event = (songId: string, daysAgo: number, extra: Partial<ListeningEvent> = {}): ListeningEvent => ({
  songId,
  at: now - daysAgo * DAY,
  listenedRatio: 1,
  listenedSec: 200,
  skipped: false,
  ...extra,
});

describe('computeListeningStats', () => {
  const events = [
    event('a', 0),
    event('a', 1),
    event('b', 2),
    event('c', 3, { skipped: true, listenedSec: 10, listenedRatio: 0.05 }),
    event('a', 12),
    // Older events recorded only the ratio.
    event('c', 20, { listenedSec: undefined, listenedRatio: 0.5 }),
  ];

  it('counts a week from the log, skips excluded from plays but not from time', () => {
    const stats = computeListeningStats(events, songs, '7d', now);
    expect(stats.plays).toBe(3);
    expect(stats.totalSec).toBe(610);
    expect(stats.byDay).toHaveLength(7);
    expect(stats.byDay[6]).toEqual({ day: localDay(now), sec: 200 });
    expect(stats.topArtists[0]).toMatchObject({ label: 'Radiohead', plays: 3 });
    expect(stats.topSongs[0]).toMatchObject({ key: 'a', plays: 2 });
    expect(stats.topGenres.map((entry) => entry.label)).toEqual(['Rock']);
  });

  it('uses the ratio for older events', () => {
    expect(computeListeningStats(events, songs, '30d', now).totalSec).toBe(200 * 4 + 10 + 100);
  });

  it('takes lifetime totals for all time', () => {
    const stats = computeListeningStats(events, songs, 'all', now);
    expect(stats.plays).toBe(14);
    expect(stats.totalSec).toBe(2800);
    expect(stats.topArtists[0]).toMatchObject({ label: 'Radiohead', plays: 13 });
  });

  it('counts the streak back from today', () => {
    expect(computeListeningStats(events, songs, '7d', now).streakDays).toBe(4);
    // Nothing yet today: the streak still counts from yesterday.
    expect(computeListeningStats(events.slice(1), songs, '7d', now).streakDays).toBe(3);
  });

  it('formats listening time', () => {
    expect(formatListeningTime(12_300)).toBe('3 h 25 min');
    expect(formatListeningTime(2_520)).toBe('42 min');
  });
});
