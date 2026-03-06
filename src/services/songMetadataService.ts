import { readStorageJson, writeStorageJson } from '@/services/storageService';
import type { Song } from '@/types/music';

const cachePath = 'metadata_cache/song_genre_cache.json';

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const normalize = (value: string): string => value.trim().toLowerCase();

const isUnknownGenre = (value: string | undefined): boolean => {
  if (!value?.trim()) {
    return true;
  }

  return normalize(value) === 'unknown genre';
};

const cacheKeyForSong = (song: Song): string => {
  return `${slugify(song.artist || 'unknown-artist')}--${slugify(song.title || song.id)}`;
};

const isCloseMatch = (candidate: string, target: string): boolean => {
  const left = normalize(candidate);
  const right = normalize(target);
  return left === right || left.includes(right) || right.includes(left);
};

interface ItunesSongHit {
  trackName?: string;
  artistName?: string;
  primaryGenreName?: string;
}

const scoreHit = (song: Song, hit: ItunesSongHit): number => {
  let score = 0;

  if (hit.trackName && isCloseMatch(hit.trackName, song.title)) {
    score += 5;
  }

  if (hit.artistName && isCloseMatch(hit.artistName, song.artist)) {
    score += 5;
  }

  if (hit.primaryGenreName) {
    score += 1;
  }

  return score;
};

const fetchGenre = async (song: Song): Promise<string | null> => {
  const endpoint = `https://itunes.apple.com/search?term=${encodeURIComponent(`${song.artist} ${song.title}`.trim())}&entity=song&limit=8`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { results?: ItunesSongHit[] };
  const hits = payload.results ?? [];
  if (!hits.length) {
    return null;
  }

  const ranked = [...hits].sort((a, b) => scoreHit(song, b) - scoreHit(song, a));
  const genre = ranked[0]?.primaryGenreName?.trim();

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
    await writeStorageJson(cachePath, nextCache);

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
