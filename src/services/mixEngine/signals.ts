import type { ListeningProfile, Song, TasteProfile } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';
import { normalizeToken } from '@/utils/text';
import {
  artistKeyForSong,
  canonicalGenre,
  dominantGenre,
  genreHintText,
  normalizeGenreText,
  type CanonicalGenre,
} from './genres';
import { GENRE_HINT_VOCAB, TITLE_HINT_VOCAB, matchHints } from './moods';
import type { ListeningEvent } from './types';

export const DAY_SEC = 86_400;

/** Accepts unix seconds or milliseconds (anything above 1e11 is treated as ms). */
export const toSeconds = (value: number | null | undefined): number | undefined => {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value > 1e11 ? value / 1000 : value;
};

/** 0 night (0-5), 1 morning (6-11), 2 afternoon (12-17), 3 evening (18-23). */
export type Daypart = 0 | 1 | 2 | 3;

export const localHourOf = (unixSec: number, tzOffsetMinutes: number): number => {
  const local = unixSec - tzOffsetMinutes * 60;
  const secondsIntoDay = ((local % DAY_SEC) + DAY_SEC) % DAY_SEC;
  return Math.floor(secondsIntoDay / 3600);
};

export const daypartOfHour = (hour: number): Daypart => {
  if (hour < 6) return 0;
  if (hour < 12) return 1;
  if (hour < 18) return 2;
  return 3;
};

export interface SongSignals {
  song: Song;
  id: string;
  artistKey: string;
  /** Lowercased primary artist, the key used by `ListeningProfile.recentArtists`. */
  artistLower: string;
  albumKey: string;
  /** Normalised raw genre tag (may be empty). */
  rawGenre: string;
  genre: CanonicalGenre | null;
  genreInferred: boolean;
  decade: number;
  year: number;
  duration: number;
  playCount: number;
  favorite: boolean;
  decayedPlays: number;
  recentPlays21d: number;
  skipRate: number;
  completion: number | null;
  /** Infinity when never played. */
  daysSincePlayed: number;
  daysSinceAdded: number;
  isNew: boolean;
  hourAffinity: number;
  daypartShare: [number, number, number, number];
  manualAdds: number;
  trendCount: number;
  familiar: boolean;
  genreHints: ReadonlySet<string>;
  titleHints: ReadonlySet<string>;
}

export interface TasteVector {
  artistShare: ReadonlyMap<string, number>;
  genreShare: ReadonlyMap<string, number>;
  maxArtistShare: number;
  maxGenreShare: number;
}

export interface LibraryStats {
  totalPlays: number;
  coldStart: boolean;
  maxDecayedPlays: number;
  maxPlayCount: number;
  maxDaysSinceAdded: number;
  /** max(2, 60th percentile of decayedPlays over played songs) - the Most Played threshold. */
  mostPlayedThreshold: number;
  artistTrackCount: ReadonlyMap<string, number>;
  maxArtistTrackCount: number;
  localHour: number;
  daypart: Daypart;
  taste: TasteVector;
}

interface EventAggregate {
  decayed: number;
  plays21: number;
  skips: number;
  total: number;
  ratioSum: number;
  ratioCount: number;
  dayparts: [number, number, number, number];
}

const aggregateEvents = (
  events: readonly ListeningEvent[] | undefined,
  nowSec: number,
  tzOffsetMinutes: number,
): Map<string, EventAggregate> => {
  const map = new Map<string, EventAggregate>();
  if (!events?.length) {
    return map;
  }
  for (const event of events) {
    const at = toSeconds(event.at);
    if (at === undefined || !event.songId) {
      continue;
    }
    const ageDays = Math.max(0, (nowSec - at) / DAY_SEC);
    let agg = map.get(event.songId);
    if (!agg) {
      agg = { decayed: 0, plays21: 0, skips: 0, total: 0, ratioSum: 0, ratioCount: 0, dayparts: [0, 0, 0, 0] };
      map.set(event.songId, agg);
    }
    agg.total += 1;
    if (event.skipped) {
      agg.skips += 1;
    } else {
      agg.decayed += Math.exp(-ageDays / 30);
      if (ageDays <= 21) {
        agg.plays21 += 1;
      }
      agg.dayparts[daypartOfHour(localHourOf(at, tzOffsetMinutes))] += 1;
    }
    if (Number.isFinite(event.listenedRatio)) {
      agg.ratioSum += Math.max(0, Math.min(1, event.listenedRatio));
      agg.ratioCount += 1;
    }
  }
  return map;
};

const folderOf = (path: string | undefined): string => {
  if (!path) {
    return '';
  }
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return slash > 0 ? path.slice(0, slash) : '';
};

/** Album identity: tag, else artwork URL, else folder of the file, never the song id. */
const albumKeyFor = (song: Song, artistKey: string): string => {
  const album = normalizeToken(song.album);
  if (album) {
    return `${artistKey}::${album}`;
  }
  if (song.albumArt) {
    return `art::${song.albumArt}`;
  }
  const folder = folderOf(song.path);
  if (folder) {
    return `dir::${folder.toLowerCase()}`;
  }
  return `artist::${artistKey}`;
};

const percentile = (sortedAsc: readonly number[], p: number): number => {
  if (!sortedAsc.length) {
    return 0;
  }
  const index = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))));
  return sortedAsc[index];
};

const buildTaste = (
  signals: readonly SongSignals[],
  tasteProfile: TasteProfile | null | undefined,
): TasteVector => {
  const derivedArtist = new Map<string, number>();
  const derivedGenre = new Map<string, number>();
  let total = 0;
  for (const signal of signals) {
    if (signal.decayedPlays <= 0) {
      continue;
    }
    total += signal.decayedPlays;
    derivedArtist.set(signal.artistKey, (derivedArtist.get(signal.artistKey) ?? 0) + signal.decayedPlays);
    if (signal.genre) {
      derivedGenre.set(signal.genre, (derivedGenre.get(signal.genre) ?? 0) + signal.decayedPlays);
    }
  }
  const artistShare = new Map<string, number>();
  const genreShare = new Map<string, number>();
  if (total > 0) {
    for (const [key, value] of derivedArtist) {
      artistShare.set(key, value / total);
    }
    for (const [key, value] of derivedGenre) {
      genreShare.set(key, value / total);
    }
  }

  const profileArtists = tasteProfile?.topArtists ?? [];
  const profileGenres = tasteProfile?.topGenres ?? [];
  const artistTotal = profileArtists.reduce((sum, entry) => sum + Math.max(0, entry.count), 0);
  const genreTotal = profileGenres.reduce((sum, entry) => sum + Math.max(0, entry.count), 0);
  if (artistTotal > 0) {
    const blended = new Map<string, number>();
    for (const [key, value] of artistShare) {
      blended.set(key, value * 0.5);
    }
    for (const entry of profileArtists) {
      const key = normalizeToken(getPrimaryArtistName(entry.name));
      if (!key) continue;
      blended.set(key, (blended.get(key) ?? 0) + (0.5 * Math.max(0, entry.count)) / artistTotal);
    }
    artistShare.clear();
    for (const [key, value] of blended) artistShare.set(key, value);
  }
  if (genreTotal > 0) {
    const blended = new Map<string, number>();
    for (const [key, value] of genreShare) {
      blended.set(key, value * 0.5);
    }
    for (const entry of profileGenres) {
      const key = canonicalGenre(entry.name);
      if (!key) continue;
      blended.set(key, (blended.get(key) ?? 0) + (0.5 * Math.max(0, entry.count)) / genreTotal);
    }
    genreShare.clear();
    for (const [key, value] of blended) genreShare.set(key, value);
  }

  let maxArtistShare = 0;
  for (const value of artistShare.values()) maxArtistShare = Math.max(maxArtistShare, value);
  let maxGenreShare = 0;
  for (const value of genreShare.values()) maxGenreShare = Math.max(maxGenreShare, value);
  return { artistShare, genreShare, maxArtistShare, maxGenreShare };
};

export interface SignalsResult {
  signals: SongSignals[];
  stats: LibraryStats;
}

export interface SignalsOptions {
  songs: readonly Song[];
  nowSec: number;
  tzOffsetMinutes: number;
  events?: readonly ListeningEvent[];
  listeningProfile?: ListeningProfile | null;
  tasteProfile?: TasteProfile | null;
}

/** Precompute every normalised field and behavioural signal once per song. */
export const computeSignals = (options: SignalsOptions): SignalsResult => {
  const { songs, nowSec, tzOffsetMinutes, listeningProfile, tasteProfile } = options;
  const eventAgg = aggregateEvents(options.events, nowSec, tzOffsetMinutes);
  const localHour = localHourOf(nowSec, tzOffsetMinutes);
  const daypart = daypartOfHour(localHour);
  const hourly = listeningProfile?.hourly?.length === 24 ? listeningProfile.hourly : null;
  let maxHourly = 0;
  if (hourly) {
    for (const value of hourly) maxHourly = Math.max(maxHourly, value);
  }
  const hourAffinityNow = hourly && maxHourly > 0 ? hourly[localHour] / maxHourly : 0;
  const recentArtists = listeningProfile?.recentArtists ?? {};

  const hintCache = new Map<string, { raw: string; hints: ReadonlySet<string> }>();
  const artistGenreCounts = new Map<string, Map<string, number>>();
  const artistTrackCount = new Map<string, number>();

  const signals: SongSignals[] = new Array(songs.length);
  let totalPlays = 0;
  let maxDecayedPlays = 0;
  let maxPlayCount = 0;
  let maxDaysSinceAdded = 0;

  for (let index = 0; index < songs.length; index += 1) {
    const song = songs[index];
    const artistKey = artistKeyForSong(song);
    const artistLower = getPrimaryArtistName(song.artist).trim().toLowerCase();
    const playCount = Math.max(0, song.playCount ?? 0);
    const lastPlayed = toSeconds(song.lastPlayed);
    const addedAt = toSeconds(song.addedAt) ?? nowSec;
    const daysSincePlayed = lastPlayed === undefined ? Number.POSITIVE_INFINITY : Math.max(0, (nowSec - lastPlayed) / DAY_SEC);
    const daysSinceAdded = Math.max(0, (nowSec - addedAt) / DAY_SEC);
    const duration = Math.max(0, song.duration ?? 0);
    const agg = eventAgg.get(song.id);

    let decayedPlays: number;
    let recentPlays21d: number;
    let skipRate: number;
    let completion: number | null;
    const daypartShare: [number, number, number, number] = [0, 0, 0, 0];
    if (agg) {
      decayedPlays = agg.decayed;
      recentPlays21d = agg.plays21;
      skipRate = agg.total > 0 ? agg.skips / agg.total : 0;
      completion = agg.ratioCount > 0 ? agg.ratioSum / agg.ratioCount : null;
      const plays = agg.total - agg.skips;
      if (plays > 0) {
        for (let part = 0; part < 4; part += 1) daypartShare[part] = agg.dayparts[part] / plays;
      }
    } else {
      const ageForDecay = Number.isFinite(daysSincePlayed) ? daysSincePlayed : 90;
      decayedPlays = playCount > 0 ? playCount * Math.exp(-ageForDecay / 60) : 0;
      if (playCount > 0 && daysSincePlayed <= 21) {
        const ownershipDays = Math.max(21, daysSinceAdded);
        recentPlays21d = Math.max(1, Math.round((playCount * 21) / ownershipDays));
      } else {
        recentPlays21d = 0;
      }
      const skips = Math.max(0, song.skipCount ?? 0);
      skipRate = skips > 0 ? Math.min(1, skips / Math.max(1, playCount + skips)) : 0;
      if (duration > 0 && playCount > 0 && (song.totalPlaySeconds ?? 0) > 0) {
        const denominator = playCount * duration;
        // Old data double-counts seconds; never trust more than plays x duration.
        completion = Math.min(denominator, song.totalPlaySeconds ?? 0) / denominator;
      } else {
        completion = null;
      }
      if (lastPlayed !== undefined) {
        daypartShare[daypartOfHour(localHourOf(lastPlayed, tzOffsetMinutes))] = 1;
      }
    }
    const playsForSongCount = agg ? Math.max(playCount, agg.total - agg.skips) : playCount;

    let cached = hintCache.get(song.genre ?? '');
    if (!cached) {
      const raw = normalizeGenreText(song.genre);
      cached = { raw, hints: matchHints(raw, GENRE_HINT_VOCAB) };
      hintCache.set(song.genre ?? '', cached);
    }
    const ownGenre = canonicalGenre(song.genre);
    if (ownGenre) {
      let counts = artistGenreCounts.get(artistKey);
      if (!counts) {
        counts = new Map();
        artistGenreCounts.set(artistKey, counts);
      }
      counts.set(ownGenre, (counts.get(ownGenre) ?? 0) + 1);
    }
    artistTrackCount.set(artistKey, (artistTrackCount.get(artistKey) ?? 0) + 1);

    const year = song.year && song.year >= 1900 && song.year <= 2100 ? song.year : 0;
    const trendCount = recentArtists[artistLower]?.count ?? 0;

    totalPlays += playsForSongCount;
    maxDecayedPlays = Math.max(maxDecayedPlays, decayedPlays);
    maxPlayCount = Math.max(maxPlayCount, playsForSongCount);
    maxDaysSinceAdded = Math.max(maxDaysSinceAdded, daysSinceAdded);

    signals[index] = {
      song,
      id: song.id,
      artistKey,
      artistLower,
      albumKey: albumKeyFor(song, artistKey),
      rawGenre: cached.raw,
      genre: ownGenre,
      genreInferred: false,
      decade: year ? Math.floor(year / 10) * 10 : 0,
      year,
      duration,
      playCount: playsForSongCount,
      favorite: Boolean(song.favorite),
      decayedPlays,
      recentPlays21d,
      skipRate,
      completion,
      daysSincePlayed,
      daysSinceAdded,
      isNew: daysSinceAdded < 21,
      hourAffinity: hourAffinityNow * daypartShare[daypart],
      daypartShare,
      manualAdds: Math.max(0, song.manualQueueAdds ?? 0),
      trendCount,
      familiar: playsForSongCount >= 2 || decayedPlays >= 1,
      genreHints: cached.hints,
      titleHints: matchHints(normalizeGenreText(song.title), TITLE_HINT_VOCAB),
    };
  }

  // Second pass: infer missing genres from the artist's dominant bucket, then let the canonical
  // name contribute mood hints ("Ambient" -> "ambient") on top of the raw tag's hints.
  const dominantCache = new Map<string, CanonicalGenre | null>();
  const mergedHintCache = new Map<string, ReadonlySet<string>>();
  for (const signal of signals) {
    if (!signal.genre) {
      let inferred = dominantCache.get(signal.artistKey);
      if (inferred === undefined) {
        const counts = artistGenreCounts.get(signal.artistKey);
        inferred = counts ? dominantGenre(counts) : null;
        dominantCache.set(signal.artistKey, inferred);
      }
      if (!inferred) {
        continue;
      }
      signal.genre = inferred;
      signal.genreInferred = true;
    }
    const key = `${signal.rawGenre}|${signal.genre}`;
    let merged = mergedHintCache.get(key);
    if (!merged) {
      const set = new Set(signal.genreHints);
      for (const hint of matchHints(genreHintText(signal.genre), GENRE_HINT_VOCAB)) set.add(hint);
      merged = set;
      mergedHintCache.set(key, merged);
    }
    signal.genreHints = merged;
  }

  const playedDecayed = signals
    .filter((signal) => signal.playCount > 0)
    .map((signal) => signal.decayedPlays)
    .sort((a, b) => a - b);
  let maxArtistTrackCount = 0;
  for (const value of artistTrackCount.values()) maxArtistTrackCount = Math.max(maxArtistTrackCount, value);

  const stats: LibraryStats = {
    totalPlays,
    coldStart: totalPlays === 0,
    maxDecayedPlays,
    maxPlayCount,
    maxDaysSinceAdded,
    mostPlayedThreshold: Math.max(2, percentile(playedDecayed, 0.6)),
    artistTrackCount,
    maxArtistTrackCount,
    localHour,
    daypart,
    taste: buildTaste(signals, tasteProfile),
  };
  return { signals, stats };
};
