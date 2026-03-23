import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';

const cachePath = 'metadata_cache/cache_index.json';

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
  void writeStorageJsonDebounced(cachePath, index, 1500);
};

export const loadMetadataCacheIndex = async (): Promise<MetadataCacheIndex> => {
  return ensureIndex();
};

export const markSongCached = async (songId: string, key: 'lyrics' | 'genre' | 'loudness'): Promise<void> => {
  const index = await ensureIndex();
  const entry = index.songs[songId] ?? {};
  entry[key] = true;
  index.songs[songId] = entry;
  persistIndex(index);
};

export const markArtistCached = async (artistKey: string): Promise<void> => {
  if (!artistKey) {
    return;
  }
  const index = await ensureIndex();
  index.artists[artistKey] = true;
  persistIndex(index);
};

export const markAlbumCached = async (albumKey: string): Promise<void> => {
  if (!albumKey) {
    return;
  }
  const index = await ensureIndex();
  index.albums[albumKey] = true;
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
  apply(index);
  persistIndex(index);
};
