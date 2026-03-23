import type { Song } from '@/types/music';
import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { getAlbumTracklistKey } from '@/services/albumTracklistService';

const cachePath = 'metadata_cache/queue_cache.json';

type QueueCacheEntry = {
  songIds: string[];
  updatedAt: number;
};

type QueueCache = {
  libraryHash: string;
  artists: Record<string, QueueCacheEntry>;
  albums: Record<string, QueueCacheEntry>;
  genres: Record<string, QueueCacheEntry>;
};

const emptyCache = (libraryHash = ''): QueueCache => ({
  libraryHash,
  artists: {},
  albums: {},
  genres: {},
});

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const hashString = (value: string): number => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return hash >>> 0;
};

const computeLibraryHash = (songs: Song[]): string => {
  let hash = 0;
  for (const song of songs) {
    hash ^= hashString(song.id);
  }
  return `${songs.length}-${hash.toString(36)}`;
};

let cacheState: QueueCache | null = null;
let cachePromise: Promise<QueueCache> | null = null;

const loadCache = async (): Promise<QueueCache> => {
  if (cacheState) {
    return cacheState;
  }
  if (!cachePromise) {
    cachePromise = readStorageJson(cachePath, emptyCache()).then((cache) => {
      cacheState = cache;
      return cache;
    });
  }
  return cachePromise;
};

const ensureCacheForLibrary = async (songs: Song[]): Promise<QueueCache> => {
  const cache = await loadCache();
  const hash = computeLibraryHash(songs);
  if (cache.libraryHash !== hash) {
    cacheState = emptyCache(hash);
    await writeStorageJsonDebounced(cachePath, cacheState, 200);
    return cacheState;
  }
  return cache;
};

export const getArtistQueueCacheKey = (artist: string): string => normalizeKey(artist);
export const getGenreQueueCacheKey = (genre: string): string => normalizeKey(genre);
export const getAlbumQueueCacheKey = (artist: string, album: string): string => getAlbumTracklistKey(artist, album);

export const getCachedQueue = async (
  type: 'artists' | 'albums' | 'genres',
  key: string,
  songs: Song[],
): Promise<QueueCacheEntry | null> => {
  if (!key) {
    return null;
  }
  const cache = await ensureCacheForLibrary(songs);
  return cache[type][key] ?? null;
};

export const setCachedQueue = async (
  type: 'artists' | 'albums' | 'genres',
  key: string,
  songIds: string[],
  songs: Song[],
): Promise<void> => {
  if (!key || !songIds.length) {
    return;
  }
  const cache = await ensureCacheForLibrary(songs);
  cache[type][key] = { songIds, updatedAt: Date.now() };
  cacheState = cache;
  await writeStorageJsonDebounced(cachePath, cache, 800);
};

