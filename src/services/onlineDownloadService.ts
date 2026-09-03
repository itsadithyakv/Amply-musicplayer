import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/services/storageService';

export interface OnlineTrackResult {
  id: string;
  provider: string;
  title: string;
  artist: string;
  album?: string | null;
  year?: string | null;
  duration?: number | null;
  license?: string | null;
  sourceUrl: string;
  artworkUrl?: string | null;
  downloadLabel: string;
}

export interface OnlineDownloadedTrack {
  path: string;
  filename: string;
  folder: string;
}

export const searchOnlineTracks = async (query: string): Promise<OnlineTrackResult[]> => {
  if (!isTauri()) {
    return [];
  }
  return invoke<OnlineTrackResult[]>('online_search_tracks', { query });
};

export const downloadOnlineTrack = async (
  item: Pick<OnlineTrackResult, 'id' | 'title' | 'artist'>,
  libraryPath?: string,
): Promise<OnlineDownloadedTrack> => {
  if (!isTauri()) {
    throw new Error('Downloads are only available in the desktop app.');
  }
  return invoke<OnlineDownloadedTrack>('online_download_track', {
    item,
    libraryPath: libraryPath?.trim() || null,
  });
};
