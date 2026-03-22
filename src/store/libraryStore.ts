import { create } from 'zustand';
import type { AppSettings, Playlist, Song } from '@/types/music';
import { ensureStorageDirs, readStorageJson, writeStorageJson } from '@/services/storageService';
import { scanMusicFolder } from '@/services/musicScanner';
import { generateSmartPlaylists } from '@/services/playlistGenerator';
import { hasCachedGenre, hydrateSongsWithCachedGenres, loadSongGenre } from '@/services/songMetadataService';
import { hydrateSongsWithCachedLoudness } from '@/services/loudnessService';
import { hasCachedLyrics, loadLyrics } from '@/services/lyricsFetcher';
import { hasCachedArtistProfile, loadArtistProfile } from '@/services/artistProfileService';
import { filterAndRankSongs } from '@/utils/search';

interface LibraryPersisted {
  songs: Song[];
}

type PlaylistUsageEntry = {
  count: number;
  lastUsed: number;
};

interface LibraryState {
  initialized: boolean;
  isScanning: boolean;
  scanError: string | null;
  libraryPaths: string[];
  songs: Song[];
  playlists: Playlist[];
  customPlaylists: Playlist[];
  smartPlaylistOverrides: Record<string, string[]>;
  playlistUsage: Record<string, PlaylistUsageEntry>;
  smartPlaylistSeed: number;
  regeneratingSmartPlaylists: boolean;
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
  regenerateSmartPlaylists: () => Promise<void>;
  initialize: () => Promise<void>;
  scanLibrary: (pathsOverride?: string[]) => Promise<void>;
  setLibraryPaths: (paths: string[]) => Promise<void>;
  addLibraryPath: (path: string) => Promise<void>;
  removeLibraryPath: (path: string) => Promise<void>;
  setSearchQuery: (query: string) => void;
  getFilteredSongs: () => Song[];
  getSongById: (songId: string) => Song | undefined;
  updateSongGenre: (songId: string, genre: string) => Promise<void>;
  refreshSongGenreIfUnknown: (songId: string) => Promise<void>;
  updateSongLoudness: (songId: string, lufs: number) => Promise<void>;
  toggleFavorite: (songId: string) => Promise<void>;
  addSongToCustomPlaylist: (playlistId: string, songId: string) => Promise<void>;
  addSongToPlaylist: (playlistId: string, songId: string) => Promise<'added' | 'exists' | 'missing'>;
  recordSongPlay: (songId: string) => Promise<void>;
  recordPlaylistUse: (playlistId: string) => Promise<void>;
  upsertCustomPlaylist: (playlist: Playlist) => Promise<void>;
}

const libraryCachePath = 'playlists/library_cache.json';
const customPlaylistsPath = 'playlists/custom_playlists.json';
const smartOverridesPath = 'playlists/smart_overrides.json';
const smartCachePath = 'playlists/smart_cache.json';
const playlistUsagePath = 'playlists/playlist_usage.json';

type SmartCache = {
  weekKey: string;
  playlists: Playlist[];
};

let smartPlaylistsCache: Playlist[] = [];
let smartCacheWeek: string | null = null;

const seedFromWeekKey = (weekKey: string): number => {
  const [yearPart, weekPart] = weekKey.split('-W');
  const year = Number(yearPart);
  const week = Number(weekPart);
  if (!Number.isFinite(year) || !Number.isFinite(week)) {
    return Date.now();
  }
  return Number(`${year}${String(week).padStart(2, '0')}`);
};

const getIsoWeekKey = (date = new Date()): string => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
};

const applySmartOverrides = (
  playlists: Playlist[],
  overrides: Record<string, string[]>,
  songs: Song[],
): Playlist[] => {
  const songSet = new Set(songs.map((song) => song.id));
  return playlists.map((playlist) => {
    const extras = overrides[playlist.id] ?? [];
    if (!extras.length) {
      return playlist;
    }
    const merged = [...playlist.songIds];
    for (const id of extras) {
      if (songSet.has(id) && !merged.includes(id)) {
        merged.push(id);
      }
    }
    return {
      ...playlist,
      songIds: merged,
    };
  });
};

const refreshSmartPlaylists = async (
  songs: Song[],
  overrides: Record<string, string[]>,
  force = false,
  seedOverride?: number,
): Promise<Playlist[]> => {
  const weekKey = getIsoWeekKey();
  if (!force && smartCacheWeek === weekKey && smartPlaylistsCache.length) {
    return smartPlaylistsCache;
  }

  const cached = force ? null : await readStorageJson<SmartCache | null>(smartCachePath, null);
  if (!force && cached?.weekKey === weekKey && cached.playlists?.length) {
    smartCacheWeek = cached.weekKey;
    smartPlaylistsCache = applySmartOverrides(cached.playlists, overrides, songs);
    return smartPlaylistsCache;
  }

  const resolvedSeed = seedOverride ?? (force ? Date.now() : undefined);
  const generated = generateSmartPlaylists(songs, overrides, resolvedSeed);
  smartCacheWeek = weekKey;
  smartPlaylistsCache = generated;
  await writeStorageJson(smartCachePath, { weekKey, playlists: generated });
  return generated;
};

const buildPlaylists = (customPlaylists: Playlist[]): Playlist[] => {
  return [...smartPlaylistsCache, ...customPlaylists];
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

const genreRefreshInFlight = new Set<string>();

export const useLibraryStore = create<LibraryState>((set, get) => ({
  initialized: false,
  isScanning: false,
  scanError: null,
  libraryPaths: ['music'],
  songs: [],
  playlists: [],
  customPlaylists: [],
  smartPlaylistOverrides: {},
  playlistUsage: {},
  smartPlaylistSeed: seedFromWeekKey(getIsoWeekKey()),
  regeneratingSmartPlaylists: false,
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

    void (async () => {
      const settings = await readStorageJson<Partial<AppSettings>>('settings.json', {});
      if (settings.gameMode) {
        set({
          metadataFetch: {
            running: false,
            total: 0,
            done: 0,
            artists: 0,
            lyrics: 0,
            genres: 0,
            message: 'Game Mode disables metadata fetching.',
          },
        });
        return;
      }

      const songs = get().songs;
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
          total: 0,
          done: 0,
          artists: 0,
          lyrics: 0,
          genres: 0,
          message: 'Checking cache...',
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

      const seenArtists = new Set<string>();
      let artistCount = 0;
      let lyricCount = 0;
      let genreCount = 0;
      let done = 0;
      let lastUpdate = performance.now();

      const pendingSongs: Song[] = [];
      let checked = 0;

      for (const song of songs) {
        const [lyricsCached, artistCached, genreCached] = await Promise.all([
          hasCachedLyrics(song),
          hasCachedArtistProfile(song.artist),
          hasCachedGenre(song),
        ]);

        if (!lyricsCached || !artistCached || !genreCached) {
          pendingSongs.push(song);
        }

        checked += 1;
        if (checked % 25 === 0) {
          await yieldToMain();
        }
      }

      if (!pendingSongs.length) {
        set({
          metadataFetch: {
            running: false,
            total: 0,
            done: 0,
            artists: 0,
            lyrics: 0,
            genres: 0,
            message: 'All metadata already cached.',
          },
        });
        return;
      }

      const updateProgress = (force = false) => {
        const now = performance.now();
        if (!force && now - lastUpdate < 300) {
          return;
        }
        lastUpdate = now;
        set({
          metadataFetch: {
            running: true,
            total: pendingSongs.length,
            done,
            artists: artistCount,
            lyrics: lyricCount,
            genres: genreCount,
            message: null,
          },
        });
      };

      for (const song of pendingSongs) {
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
            if (genreResult.genre && genreResult.genre.toLowerCase() !== 'unknown genre') {
              await get().updateSongGenre(song.id, genreResult.genre);
            }
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

      await refreshSmartPlaylists(get().songs, get().smartPlaylistOverrides, true, seedFromWeekKey(getIsoWeekKey()));
      const customPlaylists = get().customPlaylists;
      set({
        playlists: buildPlaylists(customPlaylists),
        smartPlaylistSeed: seedFromWeekKey(getIsoWeekKey()),
        metadataFetch: {
          running: false,
          total: pendingSongs.length,
          done,
          artists: artistCount,
          lyrics: lyricCount,
          genres: genreCount,
          message: 'Bulk fetch completed.',
        },
      });
    })();
  },

  regenerateSmartPlaylists: async () => {
    if (get().regeneratingSmartPlaylists) {
      return;
    }
    const seed = Date.now();
    set({ regeneratingSmartPlaylists: true });
    try {
      await refreshSmartPlaylists(get().songs, get().smartPlaylistOverrides, true, seed);
      const customPlaylists = get().customPlaylists;
      set({ playlists: buildPlaylists(customPlaylists), smartPlaylistSeed: seed });
    } finally {
      set({ regeneratingSmartPlaylists: false });
    }
  },

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    await ensureStorageDirs();

    const settings = await readStorageJson<{ libraryPath?: string; libraryPaths?: string[] }>('settings.json', {});
    const cache = await readStorageJson<LibraryPersisted>(libraryCachePath, { songs: [] });
    const customPlaylists = await readStorageJson<Playlist[]>(customPlaylistsPath, []);
    const smartOverrides = await readStorageJson<Record<string, string[]>>(smartOverridesPath, {});
    const playlistUsage = await readStorageJson<Record<string, PlaylistUsageEntry>>(playlistUsagePath, {});
    const libraryPaths = normalizeLibraryPaths([
      ...(settings.libraryPaths ?? []),
      ...(settings.libraryPath ? [settings.libraryPath] : []),
    ]);

    await refreshSmartPlaylists(cache.songs, smartOverrides);
    const initialSeed = seedFromWeekKey(getIsoWeekKey());

    set({
      initialized: true,
      songs: cache.songs,
      customPlaylists,
      playlists: buildPlaylists(customPlaylists),
      libraryPaths,
      smartPlaylistOverrides: smartOverrides,
      playlistUsage,
      smartPlaylistSeed: initialSeed,
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
      const loudnessHydrated = await hydrateSongsWithCachedLoudness(hydratedSongs);

      const customPlaylists = get().customPlaylists;
      const weeklySeed = seedFromWeekKey(getIsoWeekKey());
      await refreshSmartPlaylists(loudnessHydrated, get().smartPlaylistOverrides, true, weeklySeed);
      const playlists = buildPlaylists(customPlaylists);

      set({ songs: loudnessHydrated, playlists, isScanning: false, smartPlaylistSeed: weeklySeed });
      await persistLibrary(loudnessHydrated, customPlaylists);
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
    return filterAndRankSongs(songs, searchQuery);
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
    set({ songs, playlists: buildPlaylists(customPlaylists) });
    await persistLibrary(songs, customPlaylists);
  },

  refreshSongGenreIfUnknown: async (songId) => {
    if (genreRefreshInFlight.has(songId)) {
      return;
    }

    const song = get().getSongById(songId);
    if (!song) {
      return;
    }

    const normalized = song.genre?.trim().toLowerCase();
    if (normalized && normalized !== 'unknown genre') {
      return;
    }

    genreRefreshInFlight.add(songId);
    try {
      const genreResult = await loadSongGenre(song);
      if (genreResult.status === 'ready' && genreResult.genre) {
        await get().updateSongGenre(songId, genreResult.genre);
      }
    } finally {
      genreRefreshInFlight.delete(songId);
    }
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
    set({ songs, playlists: buildPlaylists(customPlaylists) });
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
    set({ customPlaylists: updated, playlists: buildPlaylists(updated) });
    await persistLibrary(songs, updated);
  },

  updateSongLoudness: async (songId, lufs) => {
    const songs = get().songs.map((song) => {
      if (song.id !== songId) {
        return song;
      }

      if (song.loudnessLufs === lufs) {
        return song;
      }

      return {
        ...song,
        loudnessLufs: lufs,
      };
    });

    const customPlaylists = get().customPlaylists;
    set({ songs, playlists: buildPlaylists(customPlaylists) });
    await persistLibrary(songs, customPlaylists);
  },

  addSongToPlaylist: async (playlistId, songId) => {
    const state = get();
    const playlist = state.playlists.find((entry) => entry.id === playlistId);
    if (!playlist) {
      return 'missing';
    }
    if (playlist.songIds.includes(songId)) {
      return 'exists';
    }

    if (playlist.type === 'custom') {
      await get().addSongToCustomPlaylist(playlistId, songId);
      return 'added';
    }

    const overrides = {
      ...state.smartPlaylistOverrides,
    };
    const list = overrides[playlistId] ? [...overrides[playlistId]] : [];
    if (!list.includes(songId)) {
      list.push(songId);
    }
    overrides[playlistId] = list;

    smartPlaylistsCache = applySmartOverrides(smartPlaylistsCache, overrides, state.songs);
    const customPlaylists = state.customPlaylists;
    set({
      smartPlaylistOverrides: overrides,
      playlists: buildPlaylists(customPlaylists),
    });
    await writeStorageJson(smartOverridesPath, overrides);
    return 'added';
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
    set({ songs, playlists: buildPlaylists(customPlaylists) });
    await persistLibrary(songs, customPlaylists);
  },

  recordPlaylistUse: async (playlistId) => {
    if (!playlistId) {
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    const usage = { ...get().playlistUsage };
    const current = usage[playlistId] ?? { count: 0, lastUsed: 0 };
    usage[playlistId] = {
      count: current.count + 1,
      lastUsed: now,
    };
    set({ playlistUsage: usage });
    await writeStorageJson(playlistUsagePath, usage);
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
    set({ customPlaylists: updated, playlists: buildPlaylists(updated) });
    await persistLibrary(songs, updated);
  },
}));
