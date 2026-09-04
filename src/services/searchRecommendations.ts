import type { OnlineRecommendationSignal, OnlineRecommendationSignalsBySong } from '@/services/recommendationIndex';
import type { Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';
import { normalizeToken } from '@/utils/text';

export interface RecommendationItem {
  song: Song;
  /** Short human reason shown under the card ("Because you listen to X"). */
  reason: string;
  score: number;
}

export interface SearchRecommendations {
  title: string;
  caption: string;
  items: RecommendationItem[];
  /** True when at least one online signal contributed to the ranking. */
  usedOnlineSignals: boolean;
}

const UNKNOWN_GENRES = new Set(['', 'unknown genre', 'unknown', 'other']);
const MAX_PER_ARTIST = 2;
const DAY_SEC = 86_400;

const artistKeyOf = (song: Song): string => normalizeToken(getPrimaryArtistName(song.artist));

const genreTokensOf = (song: Song): string[] =>
  (song.genre ?? '')
    .split(/[;,/]/)
    .map((part) => normalizeToken(part))
    .filter((part) => !UNKNOWN_GENRES.has(part));

const trackKeyOf = (artist: string, title: string): string => `${normalizeToken(artist)}::${normalizeToken(title)}`;

const signalTags = (signal: OnlineRecommendationSignal | undefined): string[] =>
  signal && signal.status === 'ready'
    ? [...signal.tags, ...signal.genres, ...signal.moods].map((tag) => normalizeToken(tag)).filter(Boolean)
    : [];

const interestScore = (song: Song, nowSec: number): number => {
  const recency = song.lastPlayed ? Math.max(0, 30 - (nowSec - song.lastPlayed) / DAY_SEC) : 0;
  return recency + Math.sqrt(Math.max(0, song.playCount ?? 0)) * 8 + (song.favorite ? 24 : 0);
};

/** Songs the listener has shown the most interest in recently; the seeds for "Recommended for you". */
export const pickSeedSongs = (songs: Song[], limit = 10, nowSec = Math.floor(Date.now() / 1000)): Song[] => {
  const seenArtists = new Map<string, number>();
  return [...songs]
    .map((song) => ({ song, score: interestScore(song, nowSec) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter(({ song }) => {
      const key = artistKeyOf(song);
      const count = seenArtists.get(key) ?? 0;
      if (count >= 3) {
        return false;
      }
      seenArtists.set(key, count + 1);
      return true;
    })
    .slice(0, limit)
    .map((entry) => entry.song);
};

const addWeight = (map: Map<string, number>, key: string, weight: number): void => {
  if (!key) {
    return;
  }
  map.set(key, Math.max(map.get(key) ?? 0, weight));
};

/**
 * Ranks library songs against a set of seed songs using artist/genre affinity plus any online
 * signals (tags, similar artists, similar tracks) cached for the seeds. Pure and deterministic.
 */
export const buildRecommendations = (
  songs: Song[],
  seeds: Song[],
  signals: OnlineRecommendationSignalsBySong,
  options: { limit?: number; exclude?: Set<string>; nowSec?: number } = {},
): { items: RecommendationItem[]; usedOnlineSignals: boolean } => {
  const limit = options.limit ?? 12;
  const nowSec = options.nowSec ?? Math.floor(Date.now() / 1000);
  if (!seeds.length) {
    return { items: [], usedOnlineSignals: false };
  }

  const seedIds = new Set(seeds.map((song) => song.id));
  const seedArtists = new Map<string, { weight: number; name: string }>();
  const seedGenres = new Map<string, number>();
  const seedTags = new Map<string, number>();
  const similarArtists = new Map<string, { score: number; via: string }>();
  const similarTracks = new Map<string, { score: number; via: string }>();
  let usedOnlineSignals = false;

  seeds.forEach((seed, index) => {
    const weight = 1 - index / (seeds.length * 1.5);
    const artistName = getPrimaryArtistName(seed.artist);
    const artistKey = normalizeToken(artistName);
    if (artistKey && !seedArtists.has(artistKey)) {
      seedArtists.set(artistKey, { weight, name: artistName });
    }
    for (const genre of genreTokensOf(seed)) {
      addWeight(seedGenres, genre, weight);
    }
    const signal = signals[seed.id];
    for (const tag of signalTags(signal)) {
      addWeight(seedTags, tag, weight);
    }
    if (signal?.status === 'ready') {
      for (const similar of signal.similarArtists) {
        const key = normalizeToken(similar.name);
        if (key && !seedArtists.has(key)) {
          const current = similarArtists.get(key);
          if (!current || current.score < similar.score * weight) {
            similarArtists.set(key, { score: similar.score * weight, via: artistName });
          }
        }
      }
      for (const track of signal.similarTracks) {
        const key = trackKeyOf(track.artist, track.title);
        const current = similarTracks.get(key);
        if (!current || current.score < track.score * weight) {
          similarTracks.set(key, { score: track.score * weight, via: seed.title });
        }
      }
    }
  });

  const scored: RecommendationItem[] = [];
  for (const song of songs) {
    if (seedIds.has(song.id) || options.exclude?.has(song.id)) {
      continue;
    }
    const artistName = getPrimaryArtistName(song.artist);
    const artistKey = normalizeToken(artistName);
    let best = 0;
    let reason = '';
    let score = 0;

    const sameArtist = seedArtists.get(artistKey);
    if (sameArtist) {
      const part = 1.2 * sameArtist.weight;
      score += part;
      if (part > best) {
        best = part;
        reason = `More from ${sameArtist.name}`;
      }
    }

    const similarArtist = similarArtists.get(artistKey);
    if (similarArtist) {
      const part = 1.6 * similarArtist.score;
      score += part;
      usedOnlineSignals = true;
      if (part > best) {
        best = part;
        reason = `Similar to ${similarArtist.via}`;
      }
    }

    const similarTrack = similarTracks.get(trackKeyOf(artistName, song.title));
    if (similarTrack) {
      const part = 2.5 * similarTrack.score;
      score += part;
      usedOnlineSignals = true;
      if (part > best) {
        best = part;
        reason = `Fans of ${similarTrack.via} also play this`;
      }
    }

    let genrePart = 0;
    let genreName = '';
    for (const genre of genreTokensOf(song)) {
      const weight = seedGenres.get(genre);
      if (weight && weight * 0.7 > genrePart) {
        genrePart = weight * 0.7;
        genreName = song.genre.split(/[;,/]/)[0]?.trim() ?? genre;
      }
    }
    score += genrePart;
    if (genrePart > best) {
      best = genrePart;
      reason = `More ${genreName}`;
    }

    const ownTags = signalTags(signals[song.id]);
    if (ownTags.length && seedTags.size) {
      let overlap = 0;
      for (const tag of new Set(ownTags)) {
        overlap += seedTags.get(tag) ?? 0;
      }
      const part = Math.min(2, overlap * 0.35);
      if (part > 0) {
        score += part;
        usedOnlineSignals = true;
        if (part > best) {
          best = part;
          reason = 'Shares a vibe with your favourites';
        }
      }
    }

    if (score <= 0) {
      continue;
    }

    // Prefer things the listener has not worn out; keep favourites slightly ahead.
    if (!song.lastPlayed) {
      score += 0.4;
    } else if (nowSec - song.lastPlayed < 3 * DAY_SEC) {
      score -= 0.8;
    }
    if (song.favorite) {
      score += 0.2;
    }
    scored.push({ song, reason, score });
  }

  scored.sort((a, b) => b.score - a.score || a.song.title.localeCompare(b.song.title));

  const perArtist = new Map<string, number>();
  const items: RecommendationItem[] = [];
  for (const entry of scored) {
    const key = artistKeyOf(entry.song);
    const count = perArtist.get(key) ?? 0;
    if (count >= MAX_PER_ARTIST) {
      continue;
    }
    perArtist.set(key, count + 1);
    items.push(entry);
    if (items.length >= limit) {
      break;
    }
  }
  return { items, usedOnlineSignals };
};

const listNames = (names: string[]): string => {
  const unique = [...new Set(names.filter(Boolean))].slice(0, 3);
  if (unique.length <= 1) {
    return unique[0] ?? '';
  }
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
};

/** "Recommended for you" (empty query) or "More like these" (seeded by the current results). */
export const getSearchRecommendations = (
  librarySongs: Song[],
  query: string,
  results: Song[],
  signals: OnlineRecommendationSignalsBySong,
  nowSec = Math.floor(Date.now() / 1000),
): SearchRecommendations | null => {
  const trimmed = query.trim();
  if (trimmed.length >= 2) {
    const seeds = results.slice(0, 5);
    if (!seeds.length) {
      return null;
    }
    const { items, usedOnlineSignals } = buildRecommendations(librarySongs, seeds, signals, {
      limit: 10,
      exclude: new Set(results.map((song) => song.id)),
      nowSec,
    });
    if (!items.length) {
      return null;
    }
    return {
      title: 'More like these',
      caption: `Close to ${listNames(seeds.map((song) => getPrimaryArtistName(song.artist)))}`,
      items,
      usedOnlineSignals,
    };
  }

  const seeds = pickSeedSongs(librarySongs, 10, nowSec);
  if (!seeds.length) {
    return null;
  }
  const { items, usedOnlineSignals } = buildRecommendations(librarySongs, seeds, signals, { limit: 12, nowSec });
  if (!items.length) {
    return null;
  }
  return {
    title: 'Recommended for you',
    caption: `Because you listen to ${listNames(seeds.map((song) => getPrimaryArtistName(song.artist)))}`,
    items,
    usedOnlineSignals,
  };
};
