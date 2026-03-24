import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';

const cachePath = 'metadata_cache/cache_index.json';
const MIN_DIRTY_BEFORE_FLUSH = 20;
const MAX_DIRTY_FLUSH_DELAY_MS = 15000;
let dirtyCount = 0;
let lastPersistAt = 0;

export type MetadataCacheIndex = {
  songs: Record<string, { lyrics?: true; genre?: true; loudness?: true }>;
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
  if (dirtyCount < MIN_DIRTY_BEFORE_FLUSH && now - lastPersistAt < MAX_DIRTY_FLUSH_DELAY_MS) {
    return;
  }
  dirtyCount = 0;
  lastPersistAt = now;
  void writeStorageJsonDebounced(cachePath, index, 1500);
};

export const loadMetadataCacheIndex = async (): Promise<MetadataCacheIndex> => {
  return ensureIndex();
};

export const markSongCached = async (songId: string, key: 'lyrics' | 'genre' | 'loudness'): Promise<void> => {
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

export const markAlbumCached = async (albumKey: string): Promise<void> => {
  if (!albumKey) {
    return;
  }
  const index = await ensureIndex();
  if (index.albums[albumKey]) {
    return;
  }
  index.albums[albumKey] = true;
  dirtyCount += 1;
  persistIndex(index);
};

export const isSongCached = (index: MetadataCacheIndex, songId: string, key: 'lyrics' | 'genre' | 'loudness'): boolean => {
  return index.songs[songId]?.[key] === true;
};

export const isArtistCached = (index: MetadataCacheIndex, artistKey: string): boolean => {
  return Boolean(index.artists[artistKey]);
};

export const isAlbumCached = (index: MetadataCacheIndex, albumKey: string): boolean => {
  return Boolean(index.albums[albumKey]);
};

export const primeMetadataIndex = (index: MetadataCacheIndex, apply: (draft: MetadataCacheIndex) => void): void => {
  const beforeSongs = Object.keys(index.songs).length;
  const beforeArtists = Object.keys(index.artists).length;
  const beforeAlbums = Object.keys(index.albums).length;
  apply(index);
  const afterSongs = Object.keys(index.songs).length;
  const afterArtists = Object.keys(index.artists).length;
  const afterAlbums = Object.keys(index.albums).length;
  if (afterSongs !== beforeSongs || afterArtists !== beforeArtists || afterAlbums !== beforeAlbums) {
    dirtyCount += Math.max(1, afterSongs - beforeSongs, afterArtists - beforeArtists, afterAlbums - beforeAlbums);
  }
  persistIndex(index);
};
