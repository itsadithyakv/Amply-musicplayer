import { invoke } from '@tauri-apps/api/core';
import { waitForMetadataIdle } from '@/services/metadataActivityGate';
import { markAlbumCached } from '@/services/metadataCacheIndex';
import { isTauri } from '@/services/storageService';

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const cacheKey = (artist: string, album: string): string => {
  return `${slugify(artist || 'unknown-artist')}--${slugify(album || 'unknown-album')}`;
};

export type AlbumArtworkCache = Record<string, string>;

export const getAlbumArtworkCacheKey = (artist: string, album: string): string => cacheKey(artist, album);

export const loadAlbumArtworkCache = async (): Promise<AlbumArtworkCache> => {
  if (!isTauri()) {
    return {};
  }
  return invoke<AlbumArtworkCache>('load_album_artwork_cache_rust');
};

export const readCachedAlbumArtwork = async (artist: string, album: string): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }
  if (!artist?.trim() || !album?.trim()) {
    return null;
  }
  const cached = await invoke<string | null>('read_cached_album_artwork_rust', { artist, album });
  if (cached) {
    void markAlbumCached(cacheKey(artist, album));
  }
  return cached;
};

export const loadAlbumArtwork = async (artist: string, album: string): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }
  if (!artist?.trim() || !album?.trim()) {
    return null;
  }

  try {
    await waitForMetadataIdle();
  } catch {
    // Ignore idle wait errors
  }

  const art = await invoke<string | null>('load_album_artwork_rust', { artist, album });
  if (art) {
    void markAlbumCached(cacheKey(artist, album));
  }
  return art;
};
