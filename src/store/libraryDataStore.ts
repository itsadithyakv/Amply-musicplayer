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

let cachedStructuralSnapshotRef: Song[] | null = null;
let cachedStructuralSnapshotLibraryVersion = -1;
let cachedStructuralSnapshotArtworkVersion = -1;
let cachedStructuralSnapshot: SongSnapshot[] = [];

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

/**
 * Songs snapshot that only rebuilds when the library structure or artwork changes
 * (`libraryVersion` / `artworkVersion`), not on every favourite or play. Use it for derived data
 * that does not depend on activity fields: search indexing, artwork frequency, genre options.
 */
export const getSongsSnapshotStructural = (): SongSnapshot[] => {
  const state = useLibraryStore.getState();
  if (
    cachedStructuralSnapshotRef === state.songs &&
    cachedStructuralSnapshotLibraryVersion === state.libraryVersion &&
    cachedStructuralSnapshotArtworkVersion === state.artworkVersion
  ) {
    return cachedStructuralSnapshot;
  }

  const songsById = state.getSongsById();
  cachedStructuralSnapshotRef = state.songs;
  cachedStructuralSnapshotLibraryVersion = state.libraryVersion;
  cachedStructuralSnapshotArtworkVersion = state.artworkVersion;
  cachedStructuralSnapshot = state.songs.map((song) => songsById.get(song.id) ?? song);
  return cachedStructuralSnapshot;
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
