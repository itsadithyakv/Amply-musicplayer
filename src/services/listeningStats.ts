import type { ListeningEvent } from '@/services/mixEngine/types';
import type { Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';

export type StatsRange = '7d' | '30d' | 'all';

export interface RankedEntry {
  key: string;
  label: string;
  sublabel?: string;
  plays: number;
}

export interface ListeningStats {
  /** Seconds listened in the range. */
  totalSec: number;
  plays: number;
  songs: number;
  artists: number;
  /** Consecutive days with listening, ending today (or yesterday, if nothing yet today). */
  streakDays: number;
  /** Seconds per local day, oldest first; covers the range (the last 30 days for "all"). */
  byDay: Array<{ day: string; sec: number }>;
  /** Plays per local hour of day, 0-23. */
  byHour: number[];
  topSongs: RankedEntry[];
  topArtists: RankedEntry[];
  topGenres: RankedEntry[];
}

const DAY_MS = 86_400_000;
const TOP_N = 8;

/** Local calendar day "YYYY-MM-DD" of a millisecond timestamp. */
export const localDay = (ms: number): string => {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const toMs = (at: number) => (at < 1e12 ? at * 1000 : at);

const top = (counts: Map<string, RankedEntry>): RankedEntry[] =>
  [...counts.values()].sort((a, b) => b.plays - a.plays || a.label.localeCompare(b.label)).slice(0, TOP_N);

const bump = (counts: Map<string, RankedEntry>, key: string, label: string, plays: number, sublabel?: string) => {
  if (!key || plays <= 0) {
    return;
  }
  const entry = counts.get(key) ?? { key, label, sublabel, plays: 0 };
  entry.plays += plays;
  counts.set(key, entry);
};

const isKnownGenre = (genre: string) => Boolean(genre.trim()) && genre.trim().toLowerCase() !== 'unknown genre';

/**
 * Listening statistics for a range. Windows (7 / 30 days) come from the listening log; "all time"
 * uses each song's lifetime totals, which predate and outlast the capped log. A play is a listen
 * that was not a skip, matching how the player counts plays.
 */
export const computeListeningStats = (
  events: readonly ListeningEvent[],
  songsById: ReadonlyMap<string, Song>,
  range: StatsRange,
  now: number = Date.now(),
): ListeningStats => {
  const days = range === '7d' ? 7 : 30;
  const since = now - days * DAY_MS;
  const secondsOf = (event: ListeningEvent) =>
    event.listenedSec ?? event.listenedRatio * (songsById.get(event.songId)?.duration ?? 0);

  const inWindow = events.filter((event) => toMs(event.at) >= since && toMs(event.at) <= now);
  const listened = inWindow.filter((event) => !event.skipped);

  // Seconds per day for the chart (always a window).
  const dayTotals = new Map<string, number>();
  for (const event of inWindow) {
    const day = localDay(toMs(event.at));
    dayTotals.set(day, (dayTotals.get(day) ?? 0) + secondsOf(event));
  }
  const byDay = Array.from({ length: days }, (_, index) => {
    const day = localDay(now - (days - 1 - index) * DAY_MS);
    return { day, sec: Math.round(dayTotals.get(day) ?? 0) };
  });

  const byHour = Array.from({ length: 24 }, () => 0);
  for (const event of range === 'all' ? events.filter((entry) => !entry.skipped) : listened) {
    byHour[new Date(toMs(event.at)).getHours()] += 1;
  }

  // Streak: count back from today over days with any listening in the log.
  const activeDays = new Set(events.map((event) => localDay(toMs(event.at))));
  let streakDays = 0;
  let cursor = activeDays.has(localDay(now)) ? now : now - DAY_MS;
  while (activeDays.has(localDay(cursor))) {
    streakDays += 1;
    cursor -= DAY_MS;
  }

  const songCounts = new Map<string, RankedEntry>();
  const artistCounts = new Map<string, RankedEntry>();
  const genreCounts = new Map<string, RankedEntry>();
  let totalSec = 0;
  let plays = 0;

  const tally = (song: Song, songPlays: number) => {
    bump(songCounts, song.id, song.title, songPlays, song.artist);
    const artist = getPrimaryArtistName(song.artist);
    bump(artistCounts, artist.toLowerCase(), artist, songPlays);
    if (isKnownGenre(song.genre)) {
      bump(genreCounts, song.genre.trim().toLowerCase(), song.genre.trim(), songPlays);
    }
  };

  if (range === 'all') {
    for (const song of songsById.values()) {
      totalSec += song.totalPlaySeconds ?? 0;
      plays += song.playCount ?? 0;
      tally(song, song.playCount ?? 0);
    }
  } else {
    for (const event of inWindow) {
      totalSec += secondsOf(event);
    }
    plays = listened.length;
    for (const event of listened) {
      const song = songsById.get(event.songId);
      if (song) {
        tally(song, 1);
      }
    }
  }

  return {
    totalSec: Math.round(totalSec),
    plays,
    songs: songCounts.size,
    artists: artistCounts.size,
    streakDays,
    byDay,
    byHour,
    topSongs: top(songCounts),
    topArtists: top(artistCounts),
    topGenres: top(genreCounts),
  };
};

/** "3 h 25 min", "42 min", "0 min". */
export const formatListeningTime = (seconds: number): string => {
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
};
