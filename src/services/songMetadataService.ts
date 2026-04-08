import { invoke } from '@tauri-apps/api/core';
import { markSongCached } from '@/services/metadataCacheIndex';
import type { Song } from '@/types/music';
import { isTauri } from '@/services/storageService';

const cachePath = 'metadata_cache/song_genre_cache.json';

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const normalize = (value: string): string => value.trim().toLowerCase();

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

export type SongGenreLoadResult =
  | { status: 'ready'; genre: string; fromCache: boolean; cachePath: string }
  | { status: 'missing'; cachePath: string }
  | { status: 'no-internet'; cachePath: string };

export const hydrateSongsWithCachedGenres = async (songs: Song[]): Promise<Song[]> => {
  if (!isTauri()) {
    return songs;
  }

  const cache = await invoke<Record<string, { genre: string; fetchedAt: number }>>('load_song_genre_cache_rust');

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

  if (!isTauri()) {
    return {
      status: 'missing',
      cachePath: `storage/${cachePath}`,
    };
  }

  const result = await invoke<{
    status: 'ready' | 'missing' | 'no-internet';
    genre?: string | null;
    fromCache?: boolean | null;
    cachePath: string;
  }>('load_song_genre_rust', {
    song: {
      id: song.id ?? null,
      title: song.title,
      artist: song.artist,
      album: song.album ?? null,
      duration: song.duration ?? null,
      genre: song.genre ?? null,
    },
  });

  if (result.status === 'ready' && result.genre) {
    if (song.id) {
      void markSongCached(song.id, 'genre');
    }
    return {
      status: 'ready',
      genre: result.genre,
      fromCache: Boolean(result.fromCache),
      cachePath: result.cachePath,
    };
  }

  return { status: result.status, cachePath: result.cachePath };
};

export { cachePath };
