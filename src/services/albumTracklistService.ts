import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/services/storageService';

export type AlbumTrack = {
  position: number;
  title: string;
};

export type AlbumTracklist = {
  key: string;
  album: string;
  artist: string;
  tracks: AlbumTrack[];
  source: 'musicbrainz';
  fetchedAt: number;
};

export type AlbumTracklistCache = Record<string, AlbumTracklist>;

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const normalizeTrackTitle = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/feat\.?[^-()]*$/g, '')
    .replace(/featuring[^-()]*$/g, '')
    .replace(/\bft\.?[^-()]*$/g, '')
    .replace(/\s-\s.*$/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\b(remaster(ed)?|mono|stereo|bonus track|explicit|clean)\b/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const getAlbumTracklistKey = (artist: string, album: string): string => {
  return `${slugify(artist || 'unknown-artist')}--${slugify(album || 'unknown-album')}`;
};

export const loadAlbumTracklistCache = async (): Promise<AlbumTracklistCache> => {
  if (!isTauri()) {
    return {};
  }
  return invoke<AlbumTracklistCache>('load_album_tracklist_cache_rust');
};

export const readCachedAlbumTracklist = async (
  artist: string,
  album: string,
): Promise<AlbumTracklist | null> => {
  if (!isTauri()) {
    return null;
  }
  if (!artist?.trim() || !album?.trim()) {
    return null;
  }
  return invoke<AlbumTracklist | null>('read_cached_album_tracklist_rust', { artist, album });
};

export const loadAlbumTracklist = async (artist: string, album: string): Promise<AlbumTracklist | null> => {
  if (!isTauri()) {
    return null;
  }
  if (!artist?.trim() || !album?.trim()) {
    return null;
  }

  return invoke<AlbumTracklist | null>('load_album_tracklist_rust', { artist, album });
};
