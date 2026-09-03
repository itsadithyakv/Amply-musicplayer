import { readStorageJson, writeStorageJson, writeStorageJsonDebounced } from '@/services/storageService';

const cachePath = 'metadata_cache/cache_index.json';
const CHECKPOINT_EVERY_CACHED_ITEMS = 100;
const MAX_DIRTY_FLUSH_DELAY_MS = 15000;
let dirtyCount = 0;
let lastPersistAt = 0;

type MetadataCacheIndex = {
  songs: Record<string, { lyrics?: true; genre?: true }>;
  artists: Record<string, true>;
  albums: Record<string, true>;
};

let memoryIndex: MetadataCacheIndex | null = null;

const ensureIndex = async (): Promise<MetadataCacheIndex> => {
  if (memoryIndex) {
    return memoryIndex;
  }
  const loaded = await readStorageJson<MetadataCacheIndex>(cachePath, { songs: {}, artists: {}, albums: {} });
  memoryIndex = {
    songs: loaded.songs ?? {},
    artists: loaded.artists ?? {},
    albums: loaded.albums ?? {},
  };
  return memoryIndex;
};

const persistIndex = (index: MetadataCacheIndex): void => {
  const now = Date.now();
  if (dirtyCount >= CHECKPOINT_EVERY_CACHED_ITEMS || now - lastPersistAt >= MAX_DIRTY_FLUSH_DELAY_MS) {
    dirtyCount = 0;
    lastPersistAt = now;
    void writeStorageJson(cachePath, index);
    return;
  }

  void writeStorageJsonDebounced(cachePath, index, 1500);
};

export const loadMetadataCacheIndex = async (): Promise<MetadataCacheIndex> => {
  return ensureIndex();
};

export const resetMetadataCacheIndex = (): void => {
  memoryIndex = null;
  dirtyCount = 0;
  lastPersistAt = 0;
};

export const markSongCached = async (songId: string, key: 'lyrics' | 'genre'): Promise<void> => {
  const index = await ensureIndex();
  const entry = index.songs[songId] ?? {};
  if (entry[key] === true) {
    return;
  }
  entry[key] = true;
  index.songs[songId] = entry;
  dirtyCount += 1;
  persistIndex(index);
};

export const markArtistCached = async (artistKey: string): Promise<void> => {
  if (!artistKey) {
    return;
  }
  const index = await ensureIndex();
  if (index.artists[artistKey]) {
    return;
  }
  index.artists[artistKey] = true;
  dirtyCount += 1;
  persistIndex(index);
};

export const isSongCached = (index: MetadataCacheIndex, songId: string, key: 'lyrics' | 'genre'): boolean => {
  return index.songs[songId]?.[key] === true;
};

