import type { Song } from '@/types/music';

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

const scoreSongForQuery = (song: Song, query: string): number => {
  const tokens = tokenize(query);
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

export const filterAndRankSongs = (songs: Song[], query: string): Song[] => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return songs;
  }

  return songs
    .map((song) => ({ song, score: scoreSongForQuery(song, normalizedQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.song);
};
