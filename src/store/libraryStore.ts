import { create } from 'zustand';
import type { Playlist, Song } from '@/types/music';
import { ensureStorageDirs, readStorageJson, writeStorageJson } from '@/services/storageService';
import { scanMusicFolder } from '@/services/musicScanner';
import { generateSmartPlaylists } from '@/services/playlistGenerator';
import { hydrateSongsWithCachedGenres } from '@/services/songMetadataService';

interface LibraryPersisted {
  songs: Song[];
}

interface LibraryState {
  initialized: boolean;
  isScanning: boolean;
  scanError: string | null;
  libraryPaths: string[];
  songs: Song[];
  playlists: Playlist[];
  customPlaylists: Playlist[];
  searchQuery: string;
  initialize: () => Promise<void>;
  scanLibrary: (pathsOverride?: string[]) => Promise<void>;
  setLibraryPaths: (paths: string[]) => Promise<void>;
  addLibraryPath: (path: string) => Promise<void>;
  removeLibraryPath: (path: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  getFilteredSongs: () => Song[];
  getSongById: (songId: string) => Song | undefined;
  updateSongGenre: (songId: string, genre: string) => Promise<void>;
  toggleFavorite: (songId: string) => Promise<void>;
  recordSongPlay: (songId: string) => Promise<void>;
  upsertCustomPlaylist: (playlist: Playlist) => Promise<void>;
}

const libraryCachePath = 'playlists/library_cache.json';
const customPlaylistsPath = 'playlists/custom_playlists.json';

const buildPlaylists = (songs: Song[], customPlaylists: Playlist[]): Playlist[] => {
  return [...generateSmartPlaylists(songs), ...customPlaylists];
};

const normalizeLibraryPaths = (paths: string[]): string[] => {
  const cleaned = paths.map((path) => path.trim()).filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.length ? unique : ['music'];
};

const persistLibrary = async (songs: Song[], customPlaylists: Playlist[]): Promise<void> => {
  const payload: LibraryPersisted = { songs };
  await writeStorageJson(libraryCachePath, payload);
  await writeStorageJson(customPlaylistsPath, customPlaylists);
};

export const useLibraryStore = create<LibraryState>((set, get) => ({
  initialized: false,
  isScanning: false,
  scanError: null,
  libraryPaths: ['music'],
  songs: [],
  playlists: [],
  customPlaylists: [],
  searchQuery: '',

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    await ensureStorageDirs();

    const settings = await readStorageJson<{ libraryPath?: string; libraryPaths?: string[] }>('settings.json', {});
    const cache = await readStorageJson<LibraryPersisted>(libraryCachePath, { songs: [] });
    const customPlaylists = await readStorageJson<Playlist[]>(customPlaylistsPath, []);
    const libraryPaths = normalizeLibraryPaths([
      ...(settings.libraryPaths ?? []),
      ...(settings.libraryPath ? [settings.libraryPath] : []),
    ]);

    set({
      initialized: true,
      songs: cache.songs,
      customPlaylists,
      playlists: buildPlaylists(cache.songs, customPlaylists),
      libraryPaths,
    });

    await get().scanLibrary(libraryPaths);
  },

  scanLibrary: async (pathsOverride) => {
    const targetPaths = normalizeLibraryPaths(pathsOverride ?? get().libraryPaths);

    set({ isScanning: true, scanError: null, libraryPaths: targetPaths });

    try {
      const scannedByFolder = await Promise.all(targetPaths.map((path) => scanMusicFolder(path)));
      const flattened = scannedByFolder.flat();
      const dedupedById = new Map<string, Song>();

      for (const song of flattened) {
        if (!dedupedById.has(song.id)) {
          dedupedById.set(song.id, song);
        }
      }

      const scannedSongs = [...dedupedById.values()];
      const existingMap = new Map(get().songs.map((song) => [song.id, song]));

      const mergedSongs = scannedSongs.map((song) => {
        const previous = existingMap.get(song.id);
        return {
          ...song,
          playCount: previous?.playCount ?? song.playCount,
          lastPlayed: previous?.lastPlayed ?? song.lastPlayed,
          favorite: previous?.favorite ?? song.favorite,
        };
      });
      const hydratedSongs = await hydrateSongsWithCachedGenres(mergedSongs);

      const customPlaylists = get().customPlaylists;
      const playlists = buildPlaylists(hydratedSongs, customPlaylists);

      set({ songs: hydratedSongs, playlists, isScanning: false });
      await persistLibrary(hydratedSongs, customPlaylists);
    } catch (error) {
      set({
        isScanning: false,
        scanError: error instanceof Error ? error.message : 'Library scan failed.',
      });
    }
  },

  setLibraryPaths: async (paths) => {
    const normalized = normalizeLibraryPaths(paths);
    set({ libraryPaths: normalized });

    await writeStorageJson('settings.json', {
      ...(await readStorageJson<Record<string, unknown>>('settings.json', {})),
      libraryPaths: normalized,
      libraryPath: normalized[0],
    });

    await get().scanLibrary(normalized);
  },

  addLibraryPath: async (path) => {
    const next = normalizeLibraryPaths([...get().libraryPaths, path]);
    await get().setLibraryPaths(next);
  },

  removeLibraryPath: async (path) => {
    const next = normalizeLibraryPaths(get().libraryPaths.filter((entry) => entry !== path));
    await get().setLibraryPaths(next);
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query });
  },

  getFilteredSongs: () => {
    const { songs, searchQuery } = get();
    const query = searchQuery.trim().toLowerCase();

    if (!query) {
      return songs;
    }

    return songs.filter((song) => {
      const haystack = `${song.title} ${song.artist} ${song.album} ${song.genre}`.toLowerCase();
      return haystack.includes(query);
    });
  },

  getSongById: (songId) => {
    return get().songs.find((song) => song.id === songId);
  },

  updateSongGenre: async (songId, genre) => {
    const normalized = genre.trim();
    if (!normalized || normalized.toLowerCase() === 'unknown genre') {
      return;
    }

    let changed = false;
    const songs = get().songs.map((song) => {
      if (song.id !== songId) {
        return song;
      }

      if (song.genre.trim().toLowerCase() === normalized.toLowerCase()) {
        return song;
      }

      changed = true;
      return {
        ...song,
        genre: normalized,
      };
    });

    if (!changed) {
      return;
    }

    const customPlaylists = get().customPlaylists;
    set({ songs, playlists: buildPlaylists(songs, customPlaylists) });
    await persistLibrary(songs, customPlaylists);
  },

  toggleFavorite: async (songId) => {
    const songs = get().songs.map((song) => {
      if (song.id !== songId) {
        return song;
      }

      return {
        ...song,
        favorite: !song.favorite,
      };
    });

    const customPlaylists = get().customPlaylists;
    set({ songs, playlists: buildPlaylists(songs, customPlaylists) });
    await persistLibrary(songs, customPlaylists);
  },

  recordSongPlay: async (songId) => {
    const now = Math.floor(Date.now() / 1000);

    const songs = get().songs.map((song) => {
      if (song.id !== songId) {
        return song;
      }

      return {
        ...song,
        playCount: song.playCount + 1,
        lastPlayed: now,
      };
    });

    const customPlaylists = get().customPlaylists;
    set({ songs, playlists: buildPlaylists(songs, customPlaylists) });
    await persistLibrary(songs, customPlaylists);
  },

  upsertCustomPlaylist: async (playlist) => {
    const existing = get().customPlaylists;
    const index = existing.findIndex((entry) => entry.id === playlist.id);
    let updated: Playlist[];

    if (index >= 0) {
      updated = [...existing];
      updated[index] = playlist;
    } else {
      updated = [...existing, playlist];
    }

    const songs = get().songs;
    set({ customPlaylists: updated, playlists: buildPlaylists(songs, updated) });
    await persistLibrary(songs, updated);
  },
}));
