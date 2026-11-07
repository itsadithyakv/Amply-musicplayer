import { describe, expect, it } from 'vitest';
import type { ListeningEvent } from '@/services/mixEngine/types';
import { addToYearLog, computeEncore, emptyYearLog, MIN_ENCORE_PLAYS, parseYearLog, yearLogFromEvents } from '@/services/yearInMusic';
import type { Song } from '@/types/music';

const song = (id: string, artist: string, genre: string): Song => ({
  id,
  path: id,
  source: 'local',
  filename: id,
  title: `Song ${id}`,
  artist,
  album: 'Album',
  genre,
  duration: 200,
  track: 1,
  addedAt: 0,
  playCount: 0,
  favorite: false,
});

const songs = new Map([
  ['a', song('a', 'Radiohead', 'Rock')],
  ['b', song('b', 'Radiohead, Björk', 'Alternative; Rock')],
  ['c', song('c', 'Daft Punk', 'Electronic')],
]);

const at = (month: number, day: number, hour: number) => new Date(2026, month, day, hour, 0, 0).getTime();
const play = (songId: string, when: number, skipped = false): ListeningEvent => ({ songId, at: when, listenedRatio: skipped ? 0.1 : 1, listenedSec: skipped ? 20 : 200, skipped });

describe('year logs', () => {
  it('count plays, seconds, hours, months and days', () => {
    const log = emptyYearLog(2026);
    addToYearLog(log, play('a', at(0, 5, 23)), 200);
    addToYearLog(log, play('a', at(0, 5, 23)), 200);
    addToYearLog(log, play('c', at(2, 9, 8), true), 200);
    expect(log.plays).toBe(2);
    expect(log.totalSec).toBe(420);
    expect(log.byHourPlays[23]).toBe(2);
    expect(log.byMonthSec[0]).toBe(400);
    expect(log.days).toEqual(['2026-01-05', '2026-03-09']);
    expect(log.songs.a).toEqual({ p: 2, s: 400 });
    expect(log.songs.c).toEqual({ p: 0, s: 20 });
  });

  it('rebuild a year from the listening log, leaving other years out', () => {
    const events = [play('a', at(0, 1, 12)), play('b', new Date(2025, 11, 31, 12).getTime())];
    expect(yearLogFromEvents(2026, events, songs).plays).toBe(1);
  });

  it('reject anything that is not a year log', () => {
    expect(parseYearLog({ year: 2026 }, 2026)).toBeNull();
    expect(parseYearLog(emptyYearLog(2025), 2026)).toBeNull();
    expect(parseYearLog(emptyYearLog(2026), 2026)).not.toBeNull();
  });
});

describe('computeEncore', () => {
  const log = emptyYearLog(2026);
  // 12 nights of Radiohead in January, 8 evenings of Daft Punk in March, then a streak in May.
  for (let i = 0; i < 12; i += 1) addToYearLog(log, play('a', at(0, 1 + i, 23)), 200);
  for (let i = 0; i < 8; i += 1) addToYearLog(log, play('c', at(2, 1 + i * 2, 19)), 200);
  for (let i = 0; i < 3; i += 1) addToYearLog(log, play('b', at(4, 10 + i, 23)), 200);

  it('ranks songs, artists and genres and reads the habits', () => {
    const encore = computeEncore(log, songs)!;
    expect(encore.plays).toBe(23);
    expect(encore.topSongs[0]).toMatchObject({ key: 'a', plays: 12 });
    expect(encore.topArtists[0]).toMatchObject({ label: 'Radiohead', plays: 15 });
    expect(encore.topGenres[0]).toMatchObject({ label: 'Rock', plays: 12 });
    expect(encore.persona).toBe('nightOwl');
    expect(encore.busiestMonth).toBe(0);
    expect(encore.longestStreak).toBe(12);
    expect(encore.daysListened).toBe(23);
  });

  it('waits for enough listening', () => {
    const small = emptyYearLog(2026);
    for (let i = 0; i < MIN_ENCORE_PLAYS - 1; i += 1) addToYearLog(small, play('a', at(0, 1, 12)), 200);
    expect(computeEncore(small, songs)).toBeNull();
  });
});
