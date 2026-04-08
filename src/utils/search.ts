import { invoke } from '@tauri-apps/api/core';
import type { Song } from '@/types/music';
import { isTauri } from '@/services/storageService';

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value: string): string[] => normalize(value).split(' ').filter(Boolean);

type NormalizedSongFields = {
  title: string;
  artist: string;
  album: string;
  genre: string;
  combined: string;
};

const songFieldCache = new WeakMap<Song, NormalizedSongFields>();

const getNormalizedFields = (song: Song): NormalizedSongFields => {
  const cached = songFieldCache.get(song);
  if (cached) {
    return cached;
  }
  const title = normalize(song.title);
  const artist = normalize(song.artist);
  const album = normalize(song.album);
  const genre = normalize(song.genre ?? '');
  const combined = normalize(`${song.title} ${song.artist} ${song.album} ${song.genre ?? ''}`);
  const next = {
    title,
    artist,
    album,
    genre,
    combined,
  };
  songFieldCache.set(song, next);
  return next;
};

export const warmSearchIndex = (songs: Song[], startIndex = 0, chunkSize = 400): number => {
  const end = Math.min(songs.length, startIndex + chunkSize);
  if (isTauri()) {
    return end;
  }
  for (let i = startIndex; i < end; i += 1) {
    getNormalizedFields(songs[i]);
  }
  return end;
};

const fieldScore = (normalizedField: string, queryTokens: string[]): number => {
  if (!normalizedField) {
    return 0;
  }

  let score = 0;
  for (const token of queryTokens) {
    if (!token) {
      continue;
    }
    if (normalizedField === token) {
      score += 8;
    } else if (normalizedField.startsWith(token)) {
      score += 4;
    } else if (normalizedField.includes(token)) {
      score += 2;
    }
  }
  return score;
};

const compareMatches = (a: { song: Song; score: number }, b: { song: Song; score: number }): number => {
  const scoreDiff = b.score - a.score;
  if (scoreDiff !== 0) {
    return scoreDiff;
  }

  const titleDiff = a.song.title.localeCompare(b.song.title);
  if (titleDiff !== 0) {
    return titleDiff;
  }

  const artistDiff = a.song.artist.localeCompare(b.song.artist);
  if (artistDiff !== 0) {
    return artistDiff;
  }

  const albumDiff = a.song.album.localeCompare(b.song.album);
  if (albumDiff !== 0) {
    return albumDiff;
  }

  return a.song.id.localeCompare(b.song.id);
};

const scoreSongForQuery = (song: Song, tokens: string[]): number => {
  if (!tokens.length) {
    return 0;
  }

  const normalized = getNormalizedFields(song);
  let score = 0;
  score += fieldScore(normalized.title, tokens) * 3;
  score += fieldScore(normalized.artist, tokens) * 2;
  score += fieldScore(normalized.album, tokens) * 1.5;
  score += fieldScore(normalized.genre, tokens);

  if (normalized.combined) {
    const allTokensMatch = tokens.every((token) => normalized.combined.includes(token));
    if (allTokensMatch) {
      score += 6;
    }
  }

  return score;
};

const filterAndRankSongsLocal = (songs: Song[], query: string, limit = Number.POSITIVE_INFINITY): Song[] => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return songs;
  }

  const tokens = tokenize(normalizedQuery);
  if (!tokens.length) {
    return songs;
  }

  const finiteLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : Number.POSITIVE_INFINITY;
  const matches: Array<{ song: Song; score: number }> = [];

  for (const song of songs) {
    const score = scoreSongForQuery(song, tokens);
    if (score <= 0) {
      continue;
    }

    if (!Number.isFinite(finiteLimit)) {
      matches.push({ song, score });
      continue;
    }

    const candidate = { song, score };
    let insertAt = matches.findIndex((entry) => compareMatches(candidate, entry) < 0);
    if (insertAt === -1) {
      if (matches.length >= finiteLimit) {
        continue;
      }
      insertAt = matches.length;
    }

    matches.splice(insertAt, 0, candidate);
    if (matches.length > finiteLimit) {
      matches.pop();
    }
  }

  matches.sort(compareMatches);

  return matches.map((entry) => entry.song);
};

export const filterAndRankSongs = async (
  songs: Song[],
  query: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<Song[]> => {
  if (!isTauri()) {
    return filterAndRankSongsLocal(songs, query, limit);
  }

  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return [];
  }

  const finiteLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : undefined;

  try {
    const ids = await invoke<string[]>('search_filter_rank_rust', {
      songs: songs.map((song) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        genre: song.genre ?? null,
      })),
      query: normalizedQuery,
      limit: finiteLimit ?? null,
    });

    const songMap = new Map(songs.map((song) => [song.id, song]));
    return ids.map((id) => songMap.get(id)).filter((entry): entry is Song => Boolean(entry));
  } catch {
    return filterAndRankSongsLocal(songs, query, limit);
  }
};
