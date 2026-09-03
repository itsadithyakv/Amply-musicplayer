import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react';
import type { LibraryTab, Song } from '@/types/music';
import { useLibraryStore } from '@/store/libraryStore';
import {
  getHomeView,
  getLibraryTabView,
  getPlaylistCardViews,
  getPlaylistDetailView,
  getSearchView,
  type HomeView,
  type LibraryTabView,
  type PlaylistCardView,
  type PlaylistDetailView,
  type SearchView,
} from '@/services/libraryRepository';
import { useAlbumArtFrequency } from '@/hooks/useAlbumArtFrequency';
import { filterAndRankSongs } from '@/utils/search';
import { usePlayerStore } from '@/store/playerStore';
import {
  getCustomPlaylistsSnapshot,
  getPlaylistsSnapshot,
  getSongSnapshot,
  getSongsByIds,
  getSongsSnapshot,
  type LibraryVersions,
  useLibraryVersions,
} from '@/store/libraryDataStore';
import { recordBudgetLatency } from '@/services/perfDiagnostics';

/**
 * The libraryDataStore getters cache internally and return stable references until the underlying
 * data changes; React only needs a reason to call them again. Threading the version counters through
 * makes that dependency explicit (for React and for exhaustive-deps) instead of listing deps the memo
 * body never reads.
 */
const readVersioned = <T>(read: () => T, ..._versions: number[]): T => read();

const useLibraryContentVersions = (): LibraryVersions => {
  const libraryVersion = useLibraryStore((state) => state.libraryVersion);
  const activityVersion = useLibraryStore((state) => state.activityVersion);
  const playlistVersion = useLibraryStore((state) => state.playlistVersion);
  const artworkVersion = useLibraryStore((state) => state.artworkVersion);

  return useMemo(
    () => ({
      libraryVersion,
      activityVersion,
      artworkVersion,
      playlistVersion,
    }),
    [activityVersion, artworkVersion, libraryVersion, playlistVersion],
  );
};

export const useHomeView = (): HomeView => {
  const versions = useLibraryVersions();
  const songs = useMemo(
    () => readVersioned(getSongsSnapshot, versions.activityVersion, versions.artworkVersion, versions.libraryVersion),
    [versions.activityVersion, versions.artworkVersion, versions.libraryVersion],
  );
  const playlists = useMemo(
    () => readVersioned(getPlaylistsSnapshot, versions.libraryVersion, versions.playlistVersion),
    [versions.libraryVersion, versions.playlistVersion],
  );
  return useMemo(
    () => getHomeView({ songs, playlists, versions }),
    [playlists, songs, versions],
  );
};

export const useLibraryTabView = (tab: LibraryTab): LibraryTabView => {
  const versions = useLibraryContentVersions();
  const songs = useMemo(
    () => readVersioned(getSongsSnapshot, versions.activityVersion, versions.artworkVersion, versions.libraryVersion),
    [versions.activityVersion, versions.artworkVersion, versions.libraryVersion],
  );
  return useMemo(() => getLibraryTabView({ songs, tab, versions }), [songs, tab, versions]);
};

export const usePlaylistDetailView = (playlistId?: string): PlaylistDetailView => {
  const versions = useLibraryVersions();
  const songs = useMemo(
    () => readVersioned(getSongsSnapshot, versions.activityVersion, versions.artworkVersion, versions.libraryVersion),
    [versions.activityVersion, versions.artworkVersion, versions.libraryVersion],
  );
  const playlists = useMemo(
    () => readVersioned(getPlaylistsSnapshot, versions.libraryVersion, versions.playlistVersion),
    [versions.libraryVersion, versions.playlistVersion],
  );
  const albumArtFrequency = useAlbumArtFrequency(songs);
  return useMemo(
    () => getPlaylistDetailView({ songs, playlists, playlistId, albumArtFrequency, versions }),
    [albumArtFrequency, playlistId, playlists, songs, versions],
  );
};

export const usePlaylistCardsView = (): PlaylistCardView[] => {
  const versions = useLibraryVersions();
  const songs = useMemo(
    () => readVersioned(getSongsSnapshot, versions.activityVersion, versions.artworkVersion, versions.libraryVersion),
    [versions.activityVersion, versions.artworkVersion, versions.libraryVersion],
  );
  const playlists = useMemo(
    () => readVersioned(getPlaylistsSnapshot, versions.libraryVersion, versions.playlistVersion),
    [versions.libraryVersion, versions.playlistVersion],
  );
  const albumArtFrequency = useAlbumArtFrequency(songs);
  return useMemo(
    () => getPlaylistCardViews({ songs, playlists, albumArtFrequency, versions }),
    [albumArtFrequency, playlists, songs, versions],
  );
};

export const useSearchRouteView = (): SearchView => {
  const query = useLibraryStore((state) => state.searchQuery);
  const versions = useLibraryContentVersions();
  const songs = useMemo(
    () => readVersioned(getSongsSnapshot, versions.activityVersion, versions.artworkVersion, versions.libraryVersion),
    [versions.activityVersion, versions.artworkVersion, versions.libraryVersion],
  );
  const deferredQuery = useDeferredValue(query);
  const [results, setResults] = useState<Song[]>([]);

  useEffect(() => {
    let alive = true;
    let debounceHandle: number | null = null;
    const trimmed = deferredQuery.trim();
    if (!trimmed || trimmed.length < 2) {
      startTransition(() => setResults([]));
      return () => {
        alive = false;
      };
    }

    debounceHandle = window.setTimeout(() => {
      const startedAt = performance.now();
      const next = filterAndRankSongs(songs, trimmed, 10);
      recordBudgetLatency('search', performance.now() - startedAt, 150);
      if (alive) {
        startTransition(() => setResults(next));
      }
    }, 120);

    return () => {
      alive = false;
      if (debounceHandle !== null) {
        window.clearTimeout(debounceHandle);
      }
    };
  }, [deferredQuery, songs]);

  return useMemo(
    () => getSearchView({ songs, query: deferredQuery, results, versions }),
    [songs, deferredQuery, results, versions],
  );
};

export const useCurrentSongSnapshot = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const libraryVersion = useLibraryStore((state) => state.libraryVersion);
  const activityVersion = useLibraryStore((state) => state.activityVersion);
  const song = useMemo(
    () => readVersioned(() => (currentSongId ? getSongSnapshot(currentSongId) : undefined), libraryVersion, activityVersion),
    [currentSongId, libraryVersion, activityVersion],
  );
  return useMemo(() => ({ currentSongId, song }), [currentSongId, song]);
};

export const useNowPlayingView = () => {
  const { currentSongId, song } = useCurrentSongSnapshot();
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const shuffleEnabled = usePlayerStore((state) => state.shuffleEnabled);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  return useMemo(
    () => ({ currentSongId, song, isPlaying, shuffleEnabled, repeatMode }),
    [currentSongId, song, isPlaying, shuffleEnabled, repeatMode],
  );
};

export const useQueueView = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const queueSongIds = usePlayerStore((state) => state.queueSongIds);
  const manualQueueSongIds = usePlayerStore((state) => state.manualQueueSongIds);
  const queueCursor = usePlayerStore((state) => state.queueCursor);
  const albumQueueView = usePlayerStore((state) => state.albumQueueView);
  const libraryVersion = useLibraryStore((state) => state.libraryVersion);
  const activityVersion = useLibraryStore((state) => state.activityVersion);
  return useMemo(() => {
    if (albumQueueView) {
      return {
        currentSongId,
        albumQueueView,
        allowReorder: false,
        items: albumQueueView.items.map((item) => ({
          id: item.id,
          title: item.title,
          subtitle: albumQueueView.artist,
          available: item.available,
          position: item.position,
        })),
      };
    }

    const baseIds = manualQueueSongIds.length ? manualQueueSongIds : queueSongIds;
    const startIndex = manualQueueSongIds.length ? 0 : Math.max(0, queueCursor);
    const songs = readVersioned(() => getSongsByIds(baseIds.slice(startIndex)), libraryVersion, activityVersion);
    return {
      currentSongId,
      albumQueueView: null,
      allowReorder: manualQueueSongIds.length > 0,
      items: songs.map((song, index) => ({
        id: song.id,
        title: song.title,
        subtitle: song.artist,
        available: true,
        position: index + 1,
      })),
    };
  }, [currentSongId, queueSongIds, manualQueueSongIds, queueCursor, albumQueueView, libraryVersion, activityVersion]);
};

export const usePlayerBarView = () => {
  const nowPlaying = useNowPlayingView();
  const volume = usePlayerStore((state) => state.volume);
  const nowPlayingTab = usePlayerStore((state) => state.nowPlayingTab);
  const playlistVersion = useLibraryStore((state) => state.playlistVersion);
  const customPlaylists = useMemo(() => readVersioned(getCustomPlaylistsSnapshot, playlistVersion), [playlistVersion]);
  return useMemo(
    () => ({ ...nowPlaying, volume, nowPlayingTab, customPlaylists }),
    [nowPlaying, volume, nowPlayingTab, customPlaylists],
  );
};

export const useLyricsView = (songId?: string | null) => {
  const libraryVersion = useLibraryStore((state) => state.libraryVersion);
  const activityVersion = useLibraryStore((state) => state.activityVersion);
  const song = useMemo(
    () => readVersioned(() => (songId ? getSongSnapshot(songId) : undefined), libraryVersion, activityVersion),
    [songId, libraryVersion, activityVersion],
  );
  return useMemo(() => ({ song: song ?? null }), [song]);
};
