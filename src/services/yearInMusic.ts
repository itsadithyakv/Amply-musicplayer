import type { ListeningEvent } from '@/services/mixEngine/types';
import { localDay } from '@/services/listeningStats';
import type { Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';

/**
 * Amply Encore's data: one compact log per calendar year. The listening log keeps only the latest
 * 5,000 plays (about half a year for a heavy listener), so each play is also added here, where
 * nothing is trimmed. A year's log is small: a few numbers per song played that year.
 */
export interface YearLog {
  year: number;
  plays: number;
  totalSec: number;
  /** Seconds listened per month, January first. */
  byMonthSec: number[];
  /** Plays per local hour of day, 0-23. */
  byHourPlays: number[];
  /** Local days ("YYYY-MM-DD") with any listening, in order. */
  days: string[];
  /** Per song: plays and seconds listened that year. */
  songs: Record<string, { p: number; s: number }>;
}

export const emptyYearLog = (year: number): YearLog => ({
  year,
  plays: 0,
  totalSec: 0,
  byMonthSec: Array.from({ length: 12 }, () => 0),
  byHourPlays: Array.from({ length: 24 }, () => 0),
  days: [],
  songs: {},
});

const toMs = (at: number) => (at < 1e12 ? at * 1000 : at);

export const yearOf = (event: ListeningEvent): number => new Date(toMs(event.at)).getFullYear();

/** Adds one listening event to `log` (in place); `durationSec` covers events from before listenedSec. */
export const addToYearLog = (log: YearLog, event: ListeningEvent, durationSec: number): YearLog => {
  const at = new Date(toMs(event.at));
  const seconds = Math.max(0, event.listenedSec ?? event.listenedRatio * durationSec);
  log.totalSec += seconds;
  log.byMonthSec[at.getMonth()] += seconds;
  const day = localDay(at.getTime());
  if (log.days[log.days.length - 1] !== day && !log.days.includes(day)) {
    log.days.push(day);
    log.days.sort();
  }
  const entry = log.songs[event.songId] ?? { p: 0, s: 0 };
  entry.s += seconds;
  if (!event.skipped) {
    entry.p += 1;
    log.plays += 1;
    log.byHourPlays[at.getHours()] += 1;
  }
  log.songs[event.songId] = entry;
  return log;
};

/** A year's log rebuilt from the listening log, for the plays recorded before yearly logs existed. */
export const yearLogFromEvents = (year: number, events: readonly ListeningEvent[], songsById: ReadonlyMap<string, Song>): YearLog => {
  const log = emptyYearLog(year);
  for (const event of events) {
    if (yearOf(event) === year) {
      addToYearLog(log, event, songsById.get(event.songId)?.duration ?? 0);
    }
  }
  return log;
};

/** A year log read back from storage, or null when it is not one. */
export const parseYearLog = (raw: unknown, year: number): YearLog | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Partial<YearLog>;
  if (
    value.year !== year ||
    typeof value.plays !== 'number' ||
    typeof value.totalSec !== 'number' ||
    !Array.isArray(value.byMonthSec) ||
    value.byMonthSec.length !== 12 ||
    !Array.isArray(value.byHourPlays) ||
    value.byHourPlays.length !== 24 ||
    !Array.isArray(value.days) ||
    !value.songs ||
    typeof value.songs !== 'object'
  ) {
    return null;
  }
  return value as YearLog;
};

export type ListeningPersona = 'nightOwl' | 'earlyBird' | 'daytime' | 'evening';

export interface EncoreEntry {
  key: string;
  label: string;
  sublabel?: string;
  plays: number;
  /** A song from this entry, for artwork. */
  songId?: string;
}

export interface Encore {
  year: number;
  minutes: number;
  plays: number;
  songs: number;
  artists: number;
  topSongs: EncoreEntry[];
  /** The year's most played songs, for the Encore mix. */
  mixSongIds: string[];
  topArtists: EncoreEntry[];
  topGenres: EncoreEntry[];
  persona: ListeningPersona;
  peakHour: number;
  /** 0-11. */
  busiestMonth: number;
  daysListened: number;
  longestStreak: number;
}

const ENCORE_MIX_SIZE = 30;

/** Fewer plays than this and a recap would mostly be noise. */
export const MIN_ENCORE_PLAYS = 20;

const personaFor = (hour: number): ListeningPersona =>
  hour >= 22 || hour < 5 ? 'nightOwl' : hour < 10 ? 'earlyBird' : hour < 17 ? 'daytime' : 'evening';

const longestRun = (days: readonly string[]): number => {
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of days) {
    // Noon avoids daylight-saving edges when stepping a day at a time.
    const at = new Date(`${day}T12:00:00`).getTime();
    run = previous !== null && Math.round((at - previous) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = at;
  }
  return best;
};

const ranked = (counts: Map<string, EncoreEntry>, limit: number): EncoreEntry[] =>
  [...counts.values()].sort((a, b) => b.plays - a.plays || a.label.localeCompare(b.label)).slice(0, limit);

const isKnownGenre = (genre: string) => Boolean(genre.trim()) && !['unknown genre', 'unknown', 'other'].includes(genre.trim().toLowerCase());

/** The recap for one year, or null when there is too little listening to make one. */
export const computeEncore = (log: YearLog, songsById: ReadonlyMap<string, Song>): Encore | null => {
  if (log.plays < MIN_ENCORE_PLAYS) {
    return null;
  }
  const songs = new Map<string, EncoreEntry>();
  const artists = new Map<string, EncoreEntry>();
  const genres = new Map<string, EncoreEntry>();
  for (const [songId, { p }] of Object.entries(log.songs)) {
    const song = songsById.get(songId);
    if (!song || p <= 0) {
      continue; // songs no longer in the library cannot be named
    }
    songs.set(songId, { key: songId, label: song.title, sublabel: song.artist, plays: p, songId });
    const artist = getPrimaryArtistName(song.artist).trim();
    if (artist && artist.toLowerCase() !== 'unknown artist') {
      const key = artist.toLowerCase();
      const entry = artists.get(key) ?? { key, label: artist, plays: 0, songId };
      entry.plays += p;
      artists.set(key, entry);
    }
    const genre = song.genre?.split(/[;,/]/)[0]?.trim() ?? '';
    if (isKnownGenre(genre)) {
      const key = genre.toLowerCase();
      const entry = genres.get(key) ?? { key, label: genre, plays: 0 };
      entry.plays += p;
      genres.set(key, entry);
    }
  }
  const peakHour = log.byHourPlays.reduce((best, plays, hour) => (plays > log.byHourPlays[best] ? hour : best), 0);
  const busiestMonth = log.byMonthSec.reduce((best, sec, month) => (sec > log.byMonthSec[best] ? month : best), 0);
  return {
    year: log.year,
    minutes: Math.round(log.totalSec / 60),
    plays: log.plays,
    songs: songs.size,
    artists: artists.size,
    topSongs: ranked(songs, 5),
    mixSongIds: ranked(songs, ENCORE_MIX_SIZE).map((entry) => entry.key),
    topArtists: ranked(artists, 5),
    topGenres: ranked(genres, 3),
    persona: personaFor(peakHour),
    peakHour,
    busiestMonth,
    daysListened: log.days.length,
    longestStreak: longestRun(log.days),
  };
};
