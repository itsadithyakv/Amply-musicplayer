import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { markSongCached } from '@/services/metadataCacheIndex';
import type { Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';

const cachePath = 'metadata_cache/song_genre_cache.json';

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const normalize = (value: string): string => value.trim().toLowerCase();

const stripParens = (value: string): string =>
  value.replace(/\s*[\(\[].*?[\)\]]/g, ' ').replace(/\s+/g, ' ').trim();

const normalizeTitle = (value: string): string => {
  const cleaned = stripParens(value).split(' - ')[0] ?? value;
  return cleaned.trim().toLowerCase();
};

const normalizeArtist = (value: string): string => {
  return stripParens(value)
    .replace(/\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/gi, ' ')
    .replace(/&|\+|\/|×| x /gi, ',')
    .replace(/\s+&\s+/g, ',')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
};

const splitArtists = (value: string): string[] => {
  const normalized = normalizeArtist(value);
  return normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
};

export const isUnknownGenre = (value: string | undefined): boolean => {
  if (!value?.trim()) {
    return true;
  }

  const normalized = normalize(value);
  return (
    normalized === 'unknown genre' ||
    normalized === 'unknown' ||
    normalized === 'n/a' ||
    normalized === 'na' ||
    normalized === 'none' ||
    normalized === 'unspecified' ||
    normalized === 'various' ||
    normalized === 'other'
  );
};

const cacheKeyForSong = (song: Song): string => {
  return `${slugify(song.artist || 'unknown-artist')}--${slugify(song.title || song.id)}`;
};

const isCloseMatch = (candidate: string, target: string): boolean => {
  const left = normalizeTitle(candidate);
  const right = normalizeTitle(target);

  if (!left || !right) {
    return false;
  }

  if (left === right) {
    return true;
  }

  if (left.length < 3 || right.length < 3) {
    return false;
  }

  return left.includes(right) || right.includes(left);
};

const isExactMatch = (candidate: string, target: string): boolean => normalizeTitle(candidate) === normalizeTitle(target);

const isArtistCloseMatch = (candidate: string, target: string): boolean => {
  const leftParts = splitArtists(candidate);
  const rightParts = splitArtists(target);

  if (!leftParts.length || !rightParts.length) {
    return false;
  }

  for (const left of leftParts) {
    for (const right of rightParts) {
      if (left === right) {
        return true;
      }
      if (left.length >= 3 && right.length >= 3 && (left.includes(right) || right.includes(left))) {
        return true;
      }
    }
  }

  return false;
};

interface ItunesSongHit {
  trackName?: string;
  artistName?: string;
  primaryGenreName?: string;
}

const scoreHit = (song: Song, hit: ItunesSongHit): number => {
  const artistForMatch = getPrimaryArtistName(song.artist) ?? song.artist;
  let score = 0;
  const trackMatch = hit.trackName ? isCloseMatch(hit.trackName, song.title) : false;
  const artistMatch = hit.artistName ? isArtistCloseMatch(hit.artistName, artistForMatch) : false;

  if (!trackMatch || !artistMatch) {
    return 0;
  }

  if (hit.trackName) {
    score += isExactMatch(hit.trackName, song.title) ? 6 : 4;
  }

  if (hit.artistName) {
    score += isExactMatch(hit.artistName, artistForMatch) ? 6 : 4;
  }

  if (hit.primaryGenreName) {
    score += 1;
  }

  return score;
};

const fetchGenre = async (song: Song): Promise<string | null> => {
  const primaryArtist = getPrimaryArtistName(song.artist) ?? song.artist;
  const endpoint = `https://itunes.apple.com/search?term=${encodeURIComponent(
    `${primaryArtist} ${song.title}`.trim(),
  )}&entity=song&limit=8`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { results?: ItunesSongHit[] };
  const hits = payload.results ?? [];
  if (!hits.length) {
    return null;
  }

  const MIN_SCORE = 7;
  const ranked = [...hits]
    .map((hit) => ({ hit, score: scoreHit(song, hit) }))
    .filter((entry) => entry.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) {
    return null;
  }
  const genre = ranked[0]?.hit.primaryGenreName?.trim();

  if (!genre || isUnknownGenre(genre)) {
    return null;
  }

  return genre;
};

type SongGenreCacheEntry = {
  genre: string;
  fetchedAt: number;
};

type SongGenreCache = Record<string, SongGenreCacheEntry>;

export type SongGenreLoadResult =
  | { status: 'ready'; genre: string; fromCache: boolean; cachePath: string }
  | { status: 'missing'; cachePath: string }
  | { status: 'no-internet'; cachePath: string };

export const hydrateSongsWithCachedGenres = async (songs: Song[]): Promise<Song[]> => {
  const cache = await readStorageJson<SongGenreCache>(cachePath, {});

  return songs.map((song) => {
    if (!isUnknownGenre(song.genre)) {
      return song;
    }

    const cachedGenre = cache[cacheKeyForSong(song)]?.genre?.trim();
    if (!cachedGenre || isUnknownGenre(cachedGenre)) {
      return song;
    }

    return {
      ...song,
      genre: cachedGenre,
    };
  });
};

export const loadSongGenre = async (song: Song): Promise<SongGenreLoadResult> => {
  if (!isUnknownGenre(song.genre)) {
    if (song.id) {
      void markSongCached(song.id, 'genre');
    }
    return {
      status: 'ready',
      genre: song.genre,
      fromCache: true,
      cachePath: `storage/${cachePath}`,
    };
  }

  const cache = await readStorageJson<SongGenreCache>(cachePath, {});
  const key = cacheKeyForSong(song);
  const cached = cache[key];
  if (cached?.genre && !isUnknownGenre(cached.genre)) {
    if (song.id) {
      void markSongCached(song.id, 'genre');
    }
    return {
      status: 'ready',
      genre: cached.genre,
      fromCache: true,
      cachePath: `storage/${cachePath}`,
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      status: 'no-internet',
      cachePath: `storage/${cachePath}`,
    };
  }

  try {
    const fetchedGenre = await fetchGenre(song);
    if (!fetchedGenre) {
      return {
        status: 'missing',
        cachePath: `storage/${cachePath}`,
      };
    }

    const nextCache: SongGenreCache = {
      ...cache,
      [key]: {
        genre: fetchedGenre,
        fetchedAt: Math.floor(Date.now() / 1000),
      },
    };
    await writeStorageJsonDebounced(cachePath, nextCache);
    if (song.id) {
      void markSongCached(song.id, 'genre');
    }

    return {
      status: 'ready',
      genre: fetchedGenre,
      fromCache: false,
      cachePath: `storage/${cachePath}`,
    };
  } catch {
    return {
      status: 'no-internet',
      cachePath: `storage/${cachePath}`,
    };
  }
};

