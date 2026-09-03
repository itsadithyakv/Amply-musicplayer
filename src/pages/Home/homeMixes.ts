import { djb2 as hash } from '@/utils/hash';
import { cancelIdle, requestIdle } from '@/utils/idle';
import type { Song } from '@/types/music';
import { getPrimaryArtistName, splitArtistNames } from '@/utils/artists';
import type { MadeForYouMixCard } from '@/pages/Home/MadeForYouHero';

const MADE_FOR_YOU_REFRESH_DAYS = 3;
const SMART_PLAYLIST_UI_CACHE_LIMIT = 6;

const unknownGenreValues = new Set(['', 'unknown genre', 'unknown', 'other']);

export const getMadeForYouRefreshSeed = (nowMs = Date.now()): number => {
  const day = Math.floor(nowMs / 86_400_000);
  return Math.floor(day / MADE_FOR_YOU_REFRESH_DAYS);
};

export const getNextMadeForYouRefreshMs = (nowMs = Date.now()): number => {
  const day = Math.floor(nowMs / 86_400_000);
  const nextCycleDay = (Math.floor(day / MADE_FOR_YOU_REFRESH_DAYS) + 1) * MADE_FOR_YOU_REFRESH_DAYS;
  return nextCycleDay * 86_400_000;
};

const getAlbumIdentity = (song: Song): string => {
  const artist = getPrimaryArtistName(song.artist).trim().toLowerCase();
  const album = song.album?.trim().toLowerCase();
  return `${artist || 'unknown'}::${album || song.id}`;
};

const getCleanGenre = (song: Song): string | null => {
  const genre = song.genre?.split(/[;,/]/)[0]?.trim() ?? '';
  if (unknownGenreValues.has(genre.toLowerCase())) {
    return null;
  }
  return genre;
};

const scoreSongInterest = (song: Song, nowSec: number): number => {
  const recency = song.lastPlayed ? Math.max(0, 45 - (nowSec - song.lastPlayed) / 86_400) : 0;
  const completion = song.totalPlaySeconds && song.duration ? Math.min(18, (song.totalPlaySeconds / song.duration) * 2) : 0;
  return recency + Math.sqrt(Math.max(0, song.playCount ?? 0)) * 10 + (song.favorite ? 36 : 0) + completion;
};

const pickRotatingArtists = <T,>(artists: T[], seed: number, limit: number, keyFor: (artist: T) => string): T[] => {
  if (artists.length <= limit) {
    return artists;
  }
  const stableAnchor = artists[0];
  const pool = artists.slice(1, Math.min(artists.length, 10));
  const rotated = [...pool].sort((a, b) => hash(`${seed}:${keyFor(a)}`) - hash(`${seed}:${keyFor(b)}`));
  return [stableAnchor, ...rotated].slice(0, limit);
};

export const pickUniqueAlbumSongs = (songs: Song[], seed: number, limit: number): Song[] => {
  const seenAlbums = new Set<string>();
  const selected: Song[] = [];
  const ranked = songs
    .filter((song) => Boolean(song.albumArt))
    .sort((a, b) => hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`));

  for (const song of ranked) {
    const albumKey = getAlbumIdentity(song);
    if (seenAlbums.has(albumKey)) {
      continue;
    }
    seenAlbums.add(albumKey);
    selected.push(song);
    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
};

export const scheduleIdleTask = (task: () => void, timeoutMs = 300): (() => void) => {
  const handle = requestIdle(task, { timeout: timeoutMs, fallbackDelayMs: timeoutMs });
  return () => cancelIdle(handle);
};

export const setBoundedCache = <T,>(cache: Map<string, T>, key: string, value: T) => {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, value);
  if (cache.size > SMART_PLAYLIST_UI_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }
};

type ArtistBucket = { score: number; songs: Song[] };

/** Highest-interest artist with at least two songs, plus their top 12 songs. */
export const buildMoreFromArtist = (songs: Song[], seed: number): { artistName: string; songs: Song[] } | null => {
  if (!songs.length) {
    return null;
  }

  const nowSec = Date.now() / 1000;
  const artistMap = new Map<string, ArtistBucket>();
  for (const song of songs) {
    const songScore = scoreSongInterest(song, nowSec);
    for (const artistName of splitArtistNames(song.artist)) {
      const normalized = artistName.trim();
      if (!normalized || normalized.toLowerCase() === 'unknown artist') {
        continue;
      }
      const entry = artistMap.get(normalized) ?? { score: 0, songs: [] };
      entry.score += songScore;
      entry.songs.push(song);
      artistMap.set(normalized, entry);
    }
  }

  const ranked = Array.from(artistMap.entries())
    .filter(([, entry]) => entry.songs.length >= 2)
    .sort((a, b) => b[1].score - a[1].score);

  const best = ranked[0];
  if (!best) {
    return null;
  }

  const [artistName, entry] = best;
  const ranking = [...entry.songs]
    .sort(
      (a, b) =>
        scoreSongInterest(b, nowSec) - scoreSongInterest(a, nowSec) ||
        hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`),
    )
    .slice(0, 12);

  return { artistName, songs: ranking };
};

/** Up to four genre (or artist-pair fallback) mixes for the "Made for you" section. */
export const buildMadeForYouMixes = (songs: Song[], seed: number): MadeForYouMixCard[] => {
  if (!songs.length) {
    return [];
  }

  const nowSec = Date.now() / 1000;
  const genreMap = new Map<string, Map<string, ArtistBucket>>();

  for (const song of songs) {
    const genre = getCleanGenre(song);
    if (!genre) {
      continue;
    }
    const songScore = scoreSongInterest(song, nowSec);
    const artistNames = splitArtistNames(song.artist).filter(
      (artistName) => artistName.trim() && artistName.trim().toLowerCase() !== 'unknown artist',
    );
    if (!artistNames.length) {
      continue;
    }
    const artistMap = genreMap.get(genre) ?? new Map<string, ArtistBucket>();
    for (const artistName of artistNames) {
      const entry = artistMap.get(artistName) ?? { score: 0, songs: [] };
      entry.score += songScore;
      entry.songs.push(song);
      artistMap.set(artistName, entry);
    }
    genreMap.set(genre, artistMap);
  }

  const mixes: Array<MadeForYouMixCard & { score: number }> = [];
  for (const [genre, artistMap] of genreMap.entries()) {
    const artists = Array.from(artistMap.entries())
      .filter(([, entry]) => entry.songs.length)
      .sort((a, b) => b[1].score - a[1].score);

    if (artists.length < 2) {
      continue;
    }

    const selectedArtists = pickRotatingArtists(artists, hash(`${seed}:${genre}`), 4, ([artistName]) => artistName);
    const candidateMap = new Map<string, Song>();
    let totalScore = 0;
    for (const [, entry] of selectedArtists) {
      totalScore += entry.score;
      for (const song of entry.songs) {
        candidateMap.set(song.id, song);
      }
    }

    const candidates = Array.from(candidateMap.values()).sort(
      (a, b) =>
        scoreSongInterest(b, nowSec) - scoreSongInterest(a, nowSec) ||
        hash(`${seed}:${genre}:${a.id}`) - hash(`${seed}:${genre}:${b.id}`),
    );
    const songIds = candidates.slice(0, 40).map((song) => song.id);
    if (songIds.length < 3) {
      continue;
    }

    const coverSongs = pickUniqueAlbumSongs(candidates, hash(`${genre}:${seed}`), 4);
    const artistNames = selectedArtists.map(([artistName]) => artistName);
    mixes.push({
      id: `home-made-for-you-${genre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: `${artistNames[0]} + ${artistNames[1]} Mix`,
      subtitle: artistNames.slice(0, 3).join(', '),
      genre,
      songIds,
      coverSongs,
      backgroundArtwork: coverSongs[0]?.albumArt,
      score: totalScore,
    });
  }

  const existingIds = new Set(mixes.map((mix) => mix.id));
  if (mixes.length < 4) {
    const artistFallbacks = new Map<string, ArtistBucket>();
    for (const song of songs) {
      for (const artistName of splitArtistNames(song.artist)) {
        const key = artistName.trim();
        if (!key || key.toLowerCase() === 'unknown artist') {
          continue;
        }
        const entry = artistFallbacks.get(key) ?? { score: 0, songs: [] };
        entry.score += scoreSongInterest(song, nowSec);
        entry.songs.push(song);
        artistFallbacks.set(key, entry);
      }
    }
    const rankedArtists = [...artistFallbacks.entries()].sort((a, b) => b[1].score - a[1].score);
    for (let index = 0; index < rankedArtists.length - 1 && mixes.length < 4; index += 2) {
      const first = rankedArtists[index];
      const second = rankedArtists[index + 1];
      if (!first || !second) {
        break;
      }
      const [firstName, firstEntry] = first;
      const [secondName, secondEntry] = second;
      const id = `home-made-for-you-artist-${firstName}-${secondName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      if (existingIds.has(id)) {
        continue;
      }
      const candidates = [...firstEntry.songs, ...secondEntry.songs].sort(
        (a, b) =>
          scoreSongInterest(b, nowSec) - scoreSongInterest(a, nowSec) ||
          hash(`${seed}:${id}:${a.id}`) - hash(`${seed}:${id}:${b.id}`),
      );
      const songIds = [...new Set(candidates.map((song) => song.id))].slice(0, 40);
      if (songIds.length < 3) {
        continue;
      }
      const coverSongs = pickUniqueAlbumSongs(candidates, hash(`${id}:${seed}`), 4);
      existingIds.add(id);
      mixes.push({
        id,
        title: `${firstName} + ${secondName} Mix`,
        subtitle: [firstName, secondName].join(', '),
        genre: 'Made for you',
        songIds,
        coverSongs,
        backgroundArtwork: coverSongs[0]?.albumArt,
        score: firstEntry.score + secondEntry.score,
      });
    }
  }

  return mixes
    .sort((a, b) => b.score - a.score || hash(`${seed}:${a.id}`) - hash(`${seed}:${b.id}`))
    .slice(0, 4)
    .map(({ score: _score, ...mix }) => mix);
};
