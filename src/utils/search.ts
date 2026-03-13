import type { Song } from '@/types/music';

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const tokenize = (value: string): string[] => normalize(value).split(' ').filter(Boolean);

const fieldScore = (field: string, queryTokens: string[]): number => {
  if (!field) {
    return 0;
  }
  const normalizedField = normalize(field);
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

export const scoreSongForQuery = (song: Song, query: string): number => {
  const tokens = tokenize(query);
  if (!tokens.length) {
    return 0;
  }

  let score = 0;
  score += fieldScore(song.title, tokens) * 3;
  score += fieldScore(song.artist, tokens) * 2;
  score += fieldScore(song.album, tokens) * 1.5;
  score += fieldScore(song.genre ?? '', tokens);

  const combined = normalize(`${song.title} ${song.artist} ${song.album} ${song.genre ?? ''}`);
  if (combined) {
    const allTokensMatch = tokens.every((token) => combined.includes(token));
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
