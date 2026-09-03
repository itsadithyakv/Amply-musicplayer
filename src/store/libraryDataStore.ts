import { useMemo } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import type { Playlist, Song, SongSnapshot } from '@/types/music';

export type LibraryVersions = {
  libraryVersion: number;
  activityVersion: number;
  playlistVersion: number;
  artworkVersion: number;
};

let cachedSongsSnapshotRef: Song[] | null = null;
let cachedSongsSnapshotActivityVersion = -1;
let cachedSongsSnapshot: SongSnapshot[] = [];

export const getSongSnapshot = (songId: string): SongSnapshot | undefined =>
  useLibraryStore.getState().getSongById(songId);

export const getSongsByIds = (songIds: string[]): SongSnapshot[] => {
  const songsById = useLibraryStore.getState().getSongsById();
  return songIds.map((songId) => songsById.get(songId)).filter((song): song is SongSnapshot => song !== undefined);
};

export const getSongsSnapshot = (): SongSnapshot[] => {
  const state = useLibraryStore.getState();
  if (
    cachedSongsSnapshotRef === state.songs &&
    cachedSongsSnapshotActivityVersion === state.activityVersion
  ) {
    return cachedSongsSnapshot;
  }

  const songsById = state.getSongsById();
  cachedSongsSnapshotRef = state.songs;
  cachedSongsSnapshotActivityVersion = state.activityVersion;
  cachedSongsSnapshot = state.songs.map((song) => songsById.get(song.id) ?? song);
  return cachedSongsSnapshot;
};

export const getPlaylistsSnapshot = (): Playlist[] => useLibraryStore.getState().playlists;

export const getCustomPlaylistsSnapshot = (): Playlist[] => useLibraryStore.getState().customPlaylists;

export const getLibraryVersions = (): LibraryVersions => {
  const state = useLibraryStore.getState();
  return {
    libraryVersion: state.libraryVersion,
    activityVersion: state.activityVersion,
    playlistVersion: state.playlistVersion,
    artworkVersion: state.artworkVersion,
  };
};

export const useLibraryVersions = (): LibraryVersions => {
  const libraryVersion = useLibraryStore((state) => state.libraryVersion);
  const activityVersion = useLibraryStore((state) => state.activityVersion);
  const playlistVersion = useLibraryStore((state) => state.playlistVersion);
  const artworkVersion = useLibraryStore((state) => state.artworkVersion);

  return useMemo(
    () => ({
      libraryVersion,
      activityVersion,
      playlistVersion,
      artworkVersion,
    }),
    [activityVersion, artworkVersion, libraryVersion, playlistVersion],
  );
};
