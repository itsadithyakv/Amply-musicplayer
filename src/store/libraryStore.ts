import { create } from 'zustand';
import type { Playlist, Song } from '@/types/music';
import { ensureStorageDirs, readStorageJson, writeStorageJson } from '@/services/storageService';
import { scanMusicFolder } from '@/services/musicScanner';
import { generateSmartPlaylists } from '@/services/playlistGenerator';
import { hydrateSongsWithCachedGenres, loadSongGenre } from '@/services/songMetadataService';
import { loadLyrics } from '@/services/lyricsFetcher';
import { loadArtistProfile } from '@/services/artistProfileService';

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
  metadataFetch: {
    running: boolean;
    total: number;
    done: number;
    artists: number;
    lyrics: number;
    genres: number;
    message: string | null;
  };
  startMetadataFetch: () => void;
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
  addSongToCustomPlaylist: (playlistId: string, songId: string) => Promise<void>;
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
  metadataFetch: {
    running: false,
    total: 0,
    done: 0,
    artists: 0,
    lyrics: 0,
    genres: 0,
    message: null,
  },

  startMetadataFetch: () => {
    const state = get();
    if (state.metadataFetch.running) {
      return;
    }

    const songs = state.songs;
    if (!songs.length) {
      set({
        metadataFetch: {
          running: false,
          total: 0,
          done: 0,
          artists: 0,
          lyrics: 0,
          genres: 0,
          message: 'No songs available to scan.',
        },
      });
      return;
    }

    set({
      metadataFetch: {
        running: true,
        total: songs.length,
        done: 0,
        artists: 0,
        lyrics: 0,
        genres: 0,
        message: null,
      },
    });

    const yieldToMain = () =>
      new Promise<void>((resolve) => {
        const idle = (globalThis as typeof globalThis & {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;

        if (typeof idle === 'function') {
          idle(() => resolve(), { timeout: 300 });
          return;
        }

        setTimeout(() => resolve(), 0);
      });

    void (async () => {
      const seenArtists = new Set<string>();
      let artistCount = 0;
      let lyricCount = 0;
      let genreCount = 0;
      let done = 0;
      let lastUpdate = performance.now();

      const updateProgress = (force = false) => {
        const now = performance.now();
        if (!force && now - lastUpdate < 300) {
          return;
        }
        lastUpdate = now;
        set({
          metadataFetch: {
            running: true,
            total: songs.length,
            done,
            artists: artistCount,
            lyrics: lyricCount,
            genres: genreCount,
            message: null,
          },
        });
      };

      for (const song of songs) {
        try {
          const artistKey = song.artist?.trim().toLowerCase();
          if (artistKey && !seenArtists.has(artistKey)) {
            seenArtists.add(artistKey);
            const artistResult = await loadArtistProfile(song.artist);
            if (artistResult.status === 'ready') {
              artistCount += 1;
            }
          }

          const lyricResult = await loadLyrics(song);
          if (lyricResult.status === 'ready') {
            lyricCount += 1;
          }

          const genreResult = await loadSongGenre(song);
          if (genreResult.status === 'ready') {
            genreCount += 1;
          }
        } catch {
          // Ignore per-track failures and continue.
        } finally {
          done += 1;
          updateProgress();
        }

        if (done % 5 === 0) {
          await yieldToMain();
        }
      }

      set({
        metadataFetch: {
          running: false,
          total: songs.length,
          done,
          artists: artistCount,
          lyrics: lyricCount,
          genres: genreCount,
          message: 'Bulk fetch completed.',
        },
      });
    })();
  },

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

  addSongToCustomPlaylist: async (playlistId, songId) => {
    const songs = get().songs;
    const existing = get().customPlaylists;
    const index = existing.findIndex((entry) => entry.id === playlistId);
    if (index < 0) {
      return;
    }

    const playlist = existing[index];
    if (playlist.songIds.includes(songId)) {
      return;
    }

    const updatedPlaylist: Playlist = {
      ...playlist,
      songIds: [...playlist.songIds, songId],
      updatedAt: Math.floor(Date.now() / 1000),
    };

    const updated = [...existing];
    updated[index] = updatedPlaylist;
    set({ customPlaylists: updated, playlists: buildPlaylists(songs, updated) });
    await persistLibrary(songs, updated);
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
