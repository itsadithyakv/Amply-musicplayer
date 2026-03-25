import { create } from 'zustand';
import type { AppSettings, Playlist, Song } from '@/types/music';
import { ensureStorageDirs, readStorageJson, writeStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { scanMusicFolder } from '@/services/musicScanner';
import { generateSmartPlaylists } from '@/services/playlistGenerator';
import { hydrateSongsWithCachedGenres, loadSongGenre } from '@/services/songMetadataService';
import { hydrateSongsWithCachedLoudness } from '@/services/loudnessService';
import { findLyricsCandidates, loadLyrics, type LyricsCandidate } from '@/services/lyricsFetcher';
import { hasCachedArtistProfile, loadArtistProfile } from '@/services/artistProfileService';
import {
  getAlbumArtworkCacheKey,
  loadAlbumArtwork,
  loadAlbumArtworkCache,
} from '@/services/albumArtworkService';
import {
  getAlbumTracklistKey,
  loadAlbumTracklist,
  loadAlbumTracklistCache,
} from '@/services/albumTracklistService';
import {
  loadMetadataAttempts,
  noteMetadataFailure,
  noteMetadataSuccess,
  saveMetadataAttempts,
  shouldSkipMetadata,
  tryAcquireMetadata,
  releaseMetadata,
} from '@/services/metadataAttemptService';
import { getPrimaryArtistName } from '@/utils/artists';
import {
  isAlbumCached,
  isArtistCached,
  isSongCached,
  loadMetadataCacheIndex,
  markSongCached,
  primeMetadataIndex,
} from '@/services/metadataCacheIndex';
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
    loudness: number;
    albumArt: number;
    pending: boolean;
    message: string | null;
  };
  albumTrackFetch: {
    running: boolean;
    total: number;
    done: number;
    pending: boolean;
    message: string | null;
  };
  startMetadataFetch: () => void;
  startAlbumTracklistFetch: () => void;
  fetchMissingMetadataForSong: (
    songId: string,
    options?: {
      forceRetry?: boolean;
      basicOnly?: boolean;
      ignoreCooldown?: boolean;
      allowWhenPaused?: boolean;
    },
  ) => Promise<void>;
  fetchLyricsCandidatesForSong: (songId: string) => Promise<LyricsCandidate[]>;
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
const dailyMixCachePath = 'playlists/daily_mix_cache.json';
const playlistUsagePath = 'playlists/playlist_usage.json';

type SmartCache = {
  weekKey: string;
  playlists: Playlist[];
};

type DailyMixCache = {
  dayKey: string;
  songIds: string[];
};

let smartPlaylistsCache: Playlist[] = [];
let smartCacheWeek: string | null = null;
let cachedSongsRef: Song[] | null = null;
let cachedSongsById: Map<string, Song> | null = null;
let metadataResumeTimer: number | null = null;
const metadataPlayRetryCache = new Map<string, number>();
const PLAY_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let scanRunId = 0;
let initialScanScheduled = false;
let initialScanTimer: number | null = null;

const scheduleInitialScan = (paths: string[]): void => {
  if (initialScanScheduled) {
    return;
  }
  initialScanScheduled = true;

  if (typeof window === 'undefined') {
    void useLibraryStore.getState().scanLibrary(paths);
    return;
  }

  const idle = (globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (handle: number) => void;
  }).requestIdleCallback;

  if (typeof idle === 'function') {
    initialScanTimer = idle(() => {
      initialScanTimer = null;
      void useLibraryStore.getState().scanLibrary(paths);
    }, { timeout: 2500 });
    return;
  }

  initialScanTimer = window.setTimeout(() => {
    initialScanTimer = null;
    void useLibraryStore.getState().scanLibrary(paths);
  }, 1200);
};

const scheduleMetadataResume = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const paused = (window as unknown as { __AMP_METADATA_PAUSED__?: boolean }).__AMP_METADATA_PAUSED__ === true;
  if (paused) {
    return;
  }
  const lowPerf = (window as unknown as { __AMP_LOW_PERF__?: boolean }).__AMP_LOW_PERF__ === true;
  if (lowPerf) {
    if (metadataResumeTimer !== null) {
      return;
    }
    metadataResumeTimer = window.setTimeout(() => {
      metadataResumeTimer = null;
      scheduleMetadataResume();
    }, 5000);
    return;
  }
  if (metadataResumeTimer !== null) {
    return;
  }
  metadataResumeTimer = window.setTimeout(() => {
    metadataResumeTimer = null;
    const state = useLibraryStore.getState();
    if (state.metadataFetch.running || !state.metadataFetch.pending) {
      return;
    }
    const isPlaying = (window as unknown as { __AMP_IS_PLAYING__?: boolean }).__AMP_IS_PLAYING__ === true;
    if (isPlaying) {
      scheduleMetadataResume();
      return;
    }
    state.startMetadataFetch();
  }, 3000);
};

const getSongByIdCached = (songs: Song[], songId: string): Song | undefined => {
  if (!songs.length) {
    return undefined;
  }
  if (cachedSongsRef !== songs || !cachedSongsById) {
    cachedSongsRef = songs;
    cachedSongsById = new Map(songs.map((entry) => [entry.id, entry]));
  }
  return cachedSongsById.get(songId);
};

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

const getIsoDayKey = (date = new Date()): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const seedFromDayKey = (dayKey: string): number => {
  const cleaned = dayKey.replace(/-/g, '');
  const seed = Number(cleaned);
  return Number.isFinite(seed) ? seed : Date.now();
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
  const dayKey = getIsoDayKey();
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
  const dailySeed = seedFromDayKey(dayKey);
  const songsById = new Map(songs.map((song) => [song.id, song]));
  const dailyCached = force ? null : await readStorageJson<DailyMixCache | null>(dailyMixCachePath, null);
  const dailyMixOverride =
    dailyCached && dailyCached.dayKey === dayKey
      ? dailyCached.songIds.map((id) => songsById.get(id)).filter((song): song is Song => Boolean(song))
      : null;
  const resolvedDailyOverride =
    dailyMixOverride && dailyMixOverride.length > 0 ? dailyMixOverride : null;
  const albumTracklistCache = await loadAlbumTracklistCache();
  const generated = generateSmartPlaylists(
    songs,
    overrides,
    resolvedSeed,
    albumTracklistCache,
    resolvedDailyOverride ?? undefined,
    dailySeed,
  );
  smartCacheWeek = weekKey;
  smartPlaylistsCache = generated;
  await writeStorageJson(smartCachePath, { weekKey, playlists: generated });
  if (!resolvedDailyOverride) {
    const daily = generated.find((playlist) => playlist.id === 'smart_daily_mix');
    if (daily?.songIds?.length) {
      await writeStorageJson(dailyMixCachePath, { dayKey, songIds: daily.songIds });
    }
  }
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
  await writeStorageJsonDebounced(libraryCachePath, payload, 1500);
  await writeStorageJsonDebounced(customPlaylistsPath, customPlaylists, 1500);
};

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
    loudness: 0,
    albumArt: 0,
    pending: false,
    message: null,
  },
  albumTrackFetch: {
    running: false,
    total: 0,
    done: 0,
    pending: false,
    message: null,
  },

  startMetadataFetch: () => {
    const state = get();
    if (state.metadataFetch.running) {
      return;
    }

    void (async () => {
      const runStart = performance.now();
      const maxMsPerRun = 4500;
      const shouldPause = () => {
        if (typeof window !== 'undefined') {
          const isPlaying = (window as unknown as { __AMP_IS_PLAYING__?: boolean }).__AMP_IS_PLAYING__ === true;
          if (!isPlaying) {
            return false;
          }
        }
        return performance.now() - runStart > maxMsPerRun;
      };

      const settings = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
      const metadataPaused = settings.metadataFetchPaused ?? false;
      if (settings.gameMode || metadataPaused) {
        set({
          metadataFetch: {
            running: false,
            total: 0,
            done: 0,
            artists: 0,
            lyrics: 0,
            genres: 0,
            loudness: 0,
            albumArt: 0,
            pending: false,
            message: metadataPaused
              ? 'Paused by user. Resume from Settings when ready.'
              : 'Game Mode disables metadata fetching.',
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
            loudness: 0,
            albumArt: 0,
            pending: false,
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
          loudness: 0,
          albumArt: 0,
          pending: true,
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
      const loudnessCount = 0;
      let albumArtCount = 0;
      let done = 0;
      let lastUpdate = performance.now();
      const seenAlbums = new Set<string>();

      const pendingEntries: Array<{
        song: Song;
        needsLyrics: boolean;
        needsGenre: boolean;
        needsArtist: boolean;
        needsAlbumArt: boolean;
        artistKey: string | null;
        albumKey: string | null;
      }> = [];
      const artistCachedByKey = new Map<string, boolean>();
      const attemptsCache = await loadMetadataAttempts();
      const albumCache = await loadAlbumArtworkCache();
      const cacheIndex = await loadMetadataCacheIndex();
      primeMetadataIndex(cacheIndex, (draft) => {
        for (const key of Object.keys(albumCache)) {
          draft.albums[key] = true;
        }
      });
      let checked = 0;

      for (const song of songs) {
        const primaryArtist = getPrimaryArtistName(song.artist);
        const artistKey = primaryArtist?.trim().toLowerCase();
        const lyricsCached = isSongCached(cacheIndex, song.id, 'lyrics');
        const genreCached =
          isSongCached(cacheIndex, song.id, 'genre') ||
          Boolean(song.genre?.trim() && song.genre.trim().toLowerCase() !== 'unknown genre');
        const artistCached = artistKey ? isArtistCached(cacheIndex, artistKey) : true;
        const albumKey = song.album && song.artist ? getAlbumArtworkCacheKey(song.artist, song.album) : null;
        const albumCached = albumKey ? isAlbumCached(cacheIndex, albumKey) || Boolean(albumCache[albumKey]) : true;
        if (artistKey) {
          const existing = artistCachedByKey.get(artistKey);
          if (existing === undefined) {
            artistCachedByKey.set(artistKey, artistCached);
          } else if (existing && !artistCached) {
            artistCachedByKey.set(artistKey, false);
          }
        }
        const needsLyrics = !lyricsCached && !shouldSkipMetadata(attemptsCache, 'lyrics', song.id);
        const needsGenre = !genreCached && !shouldSkipMetadata(attemptsCache, 'genre', song.id);
        const needsArtist =
          !artistCached && artistKey ? !shouldSkipMetadata(attemptsCache, 'artist', artistKey) : false;
        const needsAlbumArt =
          albumKey && !albumCached ? !shouldSkipMetadata(attemptsCache, 'album', albumKey) : false;

        if (needsLyrics || needsGenre || needsArtist || needsAlbumArt) {
          pendingEntries.push({
            song,
            needsLyrics,
            needsGenre,
            needsArtist,
            needsAlbumArt,
            artistKey: artistKey ?? null,
            albumKey,
          });
        }

        checked += 1;
        if (checked % 25 === 0) {
          await yieldToMain();
        }
      }

      if (!pendingEntries.length) {
        set({
          metadataFetch: {
            running: false,
            total: 0,
            done: 0,
            artists: 0,
            lyrics: 0,
            genres: 0,
            loudness: 0,
            albumArt: 0,
            pending: false,
            message: 'All metadata already cached.',
          },
        });
        return;
      }

      if (typeof window !== 'undefined') {
        const flags = window as unknown as { __AMP_CURRENT_SONG_ID__?: string | null; __AMP_UP_NEXT__?: string[] };
        const currentId = flags.__AMP_CURRENT_SONG_ID__ ?? null;
        const upNext = Array.isArray(flags.__AMP_UP_NEXT__) ? flags.__AMP_UP_NEXT__ : [];
        const nextIndex = new Map<string, number>(upNext.map((id, index) => [id, index]));
        pendingEntries.sort((a, b) => {
          const aSong = a.song;
          const bSong = b.song;
          if (currentId) {
            if (aSong.id === currentId && bSong.id !== currentId) {
              return -1;
            }
            if (bSong.id === currentId && aSong.id !== currentId) {
              return 1;
            }
          }
          const aNext = nextIndex.get(aSong.id);
          const bNext = nextIndex.get(bSong.id);
          if (aNext !== undefined || bNext !== undefined) {
            if (aNext === undefined) {
              return 1;
            }
            if (bNext === undefined) {
              return -1;
            }
            return aNext - bNext;
          }
          if (a.needsGenre !== b.needsGenre) {
            return a.needsGenre ? -1 : 1;
          }
          const aLast = aSong.lastPlayed ?? 0;
          const bLast = bSong.lastPlayed ?? 0;
          if (aLast !== bLast) {
            return bLast - aLast;
          }
          if (aSong.playCount !== bSong.playCount) {
            return bSong.playCount - aSong.playCount;
          }
          return aSong.title.localeCompare(bSong.title);
        });
      }

      const updateProgress = (force = false) => {
        const now = performance.now();
        const isPlaying =
          typeof window !== 'undefined' &&
          (window as unknown as { __AMP_IS_PLAYING__?: boolean }).__AMP_IS_PLAYING__ === true;
        const minInterval = isPlaying ? 900 : 300;
        if (!force && now - lastUpdate < minInterval) {
          return;
        }
        lastUpdate = now;
        set({
          metadataFetch: {
            running: true,
            total: pendingEntries.length,
            done,
            artists: artistCount,
            lyrics: lyricCount,
            genres: genreCount,
            loudness: loudnessCount,
            albumArt: albumArtCount,
            pending: true,
            message: null,
          },
        });
      };

      let abortedByUser = false;
      for (const entry of pendingEntries) {
        const song = entry.song;
        try {
          if (typeof window !== 'undefined') {
            const paused =
              (window as unknown as { __AMP_METADATA_PAUSED__?: boolean }).__AMP_METADATA_PAUSED__ === true;
            if (paused) {
              abortedByUser = true;
              break;
            }
          }
          const primaryArtist = getPrimaryArtistName(song.artist);
          const artistKey = entry.artistKey ?? primaryArtist?.trim().toLowerCase() ?? null;
          const flags =
            typeof window !== 'undefined'
              ? (window as unknown as { __AMP_IS_PLAYING__?: boolean; __AMP_LOW_PERF__?: boolean })
              : {};
          const isPlaying = flags.__AMP_IS_PLAYING__ === true;
          const lowPerf = flags.__AMP_LOW_PERF__ === true;
          const allowHeavy = !lowPerf;
          const heavyBudgetOk = !isPlaying || done % 6 === 0;
          const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
          if (entry.needsGenre) {
            if (tryAcquireMetadata('genre', song.id)) {
              const genreResult = await loadSongGenre(song);
              if (genreResult.status === 'ready') {
                genreCount += 1;
                noteMetadataSuccess(attemptsCache, 'genre', song.id);
                void markSongCached(song.id, 'genre');
                if (genreResult.genre && genreResult.genre.toLowerCase() !== 'unknown genre') {
                  await get().updateSongGenre(song.id, genreResult.genre);
                }
              } else {
                noteMetadataFailure(attemptsCache, 'genre', song.id);
              }
              releaseMetadata('genre', song.id);
            }
          }

          if (entry.needsLyrics) {
            if (tryAcquireMetadata('lyrics', song.id)) {
              const lyricResult = await loadLyrics(song);
              if (lyricResult.status === 'ready') {
                lyricCount += 1;
                noteMetadataSuccess(attemptsCache, 'lyrics', song.id);
              } else {
                if (isOnline) {
                  noteMetadataFailure(attemptsCache, 'lyrics', song.id);
                }
              }
              releaseMetadata('lyrics', song.id);
            }
          }

          if (
            entry.needsArtist &&
            allowHeavy &&
            heavyBudgetOk &&
            artistKey &&
            artistCachedByKey.get(artistKey) === false &&
            !seenArtists.has(artistKey)
          ) {
            seenArtists.add(artistKey);
            if (tryAcquireMetadata('artist', artistKey)) {
              const artistResult = await loadArtistProfile(primaryArtist);
              if (artistResult.status === 'ready') {
                artistCount += 1;
                noteMetadataSuccess(attemptsCache, 'artist', artistKey);
              } else {
                if (artistResult.status === 'missing' && isOnline) {
                  noteMetadataFailure(attemptsCache, 'artist', artistKey);
                }
              }
              releaseMetadata('artist', artistKey);
            }
          }

          if (entry.needsAlbumArt && allowHeavy && heavyBudgetOk && entry.albumKey && song.album && song.artist) {
            const albumKey = entry.albumKey ?? getAlbumArtworkCacheKey(song.artist, song.album);
            if (!seenAlbums.has(albumKey)) {
              seenAlbums.add(albumKey);
              if (tryAcquireMetadata('album', albumKey)) {
                const art = await loadAlbumArtwork(song.artist, song.album);
                if (art) {
                  albumArtCount += 1;
                  noteMetadataSuccess(attemptsCache, 'album', albumKey);
                } else {
                  noteMetadataFailure(attemptsCache, 'album', albumKey);
                }
                releaseMetadata('album', albumKey);
              }
            }
          }
        } catch {
          // Ignore per-track failures and continue.
        } finally {
          done += 1;
          updateProgress();
        }

        if (typeof window !== 'undefined') {
          const flags = window as unknown as { __AMP_LOW_PERF__?: boolean };
          if (flags.__AMP_LOW_PERF__ === true) {
            break;
          }
        }

        if (typeof window !== 'undefined') {
          const flags = window as unknown as { __AMP_IS_PLAYING__?: boolean; __AMP_LAST_INTERACTION__?: number };
          const isPlaying = flags.__AMP_IS_PLAYING__ === true;
          const lastInteraction = flags.__AMP_LAST_INTERACTION__ ?? 0;
          const idleForMs = Date.now() - lastInteraction;
          const isIdle = idleForMs >= 10_000;
          const yieldEvery = isPlaying ? 5 : isIdle ? 60 : 25;
          if (done % yieldEvery === 0) {
            await yieldToMain();
          }
        } else if (done % 5 === 0) {
          await yieldToMain();
        }
        if (shouldPause()) {
          break;
        }
      }

      if (abortedByUser) {
        await saveMetadataAttempts(attemptsCache);
        set({
          metadataFetch: {
            running: false,
            total: pendingEntries.length,
            done,
            artists: artistCount,
            lyrics: lyricCount,
            genres: genreCount,
            loudness: loudnessCount,
            albumArt: albumArtCount,
            pending: true,
            message: 'Paused by user. Resume from Settings when ready.',
          },
        });
        return;
      }

      const completedAll = done >= pendingEntries.length;
      await saveMetadataAttempts(attemptsCache);
      if (completedAll) {
        await refreshSmartPlaylists(get().songs, get().smartPlaylistOverrides, true, seedFromWeekKey(getIsoWeekKey()));
        const customPlaylists = get().customPlaylists;
        set({
          playlists: buildPlaylists(customPlaylists),
          smartPlaylistSeed: seedFromWeekKey(getIsoWeekKey()),
          metadataFetch: {
            running: false,
            total: pendingEntries.length,
            done,
            artists: artistCount,
            lyrics: lyricCount,
            genres: genreCount,
            loudness: loudnessCount,
            albumArt: albumArtCount,
            pending: false,
            message: 'Bulk fetch completed.',
          },
        });
        return;
      }

      set({
        metadataFetch: {
          running: false,
          total: pendingEntries.length,
          done,
          artists: artistCount,
          lyrics: lyricCount,
          genres: genreCount,
          loudness: loudnessCount,
          albumArt: albumArtCount,
          pending: true,
          message: 'Paused for performance. Resuming shortly.',
        },
      });
      scheduleMetadataResume();
    })();
  },

  startAlbumTracklistFetch: () => {
    const state = get();
    if (state.albumTrackFetch.running) {
      return;
    }

    void (async () => {
      const runStart = performance.now();
      const maxAlbumsPerRun = 2;
      const maxMsPerRun = 1400;
      const shouldPause = (processed: number) =>
        processed >= maxAlbumsPerRun || performance.now() - runStart > maxMsPerRun;

      const settings = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
      const metadataPaused = settings.metadataFetchPaused ?? false;
      if (settings.gameMode || metadataPaused) {
        set({
          albumTrackFetch: {
            running: false,
            total: 0,
            done: 0,
            pending: state.albumTrackFetch.pending,
            message: metadataPaused
              ? 'Metadata lookups are paused.'
              : 'Game Mode disables album tracklist lookup.',
          },
        });
        return;
      }

      const songs = get().songs;
      if (!songs.length) {
        set({
          albumTrackFetch: {
            running: false,
            total: 0,
            done: 0,
            pending: false,
            message: 'No albums available to scan.',
          },
        });
        return;
      }

      set({
        albumTrackFetch: {
          running: true,
          total: 0,
          done: 0,
          pending: true,
          message: 'Checking cached album tracklists...',
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

      const albumCache = await loadAlbumTracklistCache();
      const attemptsCache = await loadMetadataAttempts();
      const pendingAlbums: Array<{ artist: string; album: string; key: string }> = [];

      const albumCandidates = new Map<
        string,
        {
          album: string;
          artist: string;
          key: string;
        }
      >();

      for (const song of songs) {
        if (!song.album?.trim()) {
          continue;
        }
        const primaryArtist = getPrimaryArtistName(song.artist);
        if (!primaryArtist?.trim()) {
          continue;
        }
        const compositeKey = `${primaryArtist.trim().toLowerCase()}::${song.album.trim().toLowerCase()}`;
        if (!albumCandidates.has(compositeKey)) {
          albumCandidates.set(compositeKey, {
            album: song.album,
            artist: primaryArtist,
            key: getAlbumTracklistKey(primaryArtist, song.album),
          });
        }
      }

      for (const entry of albumCandidates.values()) {
        if (albumCache[entry.key]?.tracks?.length) {
          continue;
        }
        if (shouldSkipMetadata(attemptsCache, 'album_tracklist', entry.key)) {
          continue;
        }
        pendingAlbums.push({ artist: entry.artist, album: entry.album, key: entry.key });
      }

      if (!pendingAlbums.length) {
        set({
          albumTrackFetch: {
            running: false,
            total: 0,
            done: 0,
            pending: false,
            message: 'All album tracklists already cached.',
          },
        });
        return;
      }

      let done = 0;
      let lastUpdate = performance.now();
      const updateProgress = (force = false) => {
        const now = performance.now();
        if (!force && now - lastUpdate < 300) {
          return;
        }
        lastUpdate = now;
        set({
          albumTrackFetch: {
            running: true,
            total: pendingAlbums.length,
            done,
            pending: true,
            message: null,
          },
        });
      };

      for (const entry of pendingAlbums) {
        try {
          if (!shouldSkipMetadata(attemptsCache, 'album_tracklist', entry.key)) {
            if (tryAcquireMetadata('album_tracklist', entry.key)) {
              const tracklist = await loadAlbumTracklist(entry.artist, entry.album);
              if (tracklist?.tracks?.length) {
                noteMetadataSuccess(attemptsCache, 'album_tracklist', entry.key);
              } else {
                noteMetadataFailure(attemptsCache, 'album_tracklist', entry.key);
              }
              releaseMetadata('album_tracklist', entry.key);
            }
          }
        } catch {
          noteMetadataFailure(attemptsCache, 'album_tracklist', entry.key);
        } finally {
          done += 1;
          updateProgress();
        }

        if (done % 2 === 0) {
          await yieldToMain();
        }
        if (shouldPause(done)) {
          break;
        }
      }

      await saveMetadataAttempts(attemptsCache);
      const completedAll = done >= pendingAlbums.length;
      set({
        albumTrackFetch: {
          running: false,
          total: pendingAlbums.length,
          done,
          pending: !completedAll,
          message: completedAll
            ? 'Album tracklists cached.'
            : 'Paused to keep things smooth. Will continue when idle.',
        },
      });
    })();
  },

  fetchMissingMetadataForSong: async (songId, options) => {
    if (get().metadataFetch.running) {
      return;
    }
    const settings = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
    const metadataPaused = settings.metadataFetchPaused ?? false;
    const allowWhenPaused = options?.allowWhenPaused === true;
    if (settings.gameMode || (metadataPaused && !allowWhenPaused)) {
      return;
    }
    const forceRetry = options?.forceRetry === true;
    const ignoreCooldown = options?.ignoreCooldown === true;
    const basicOnly = options?.basicOnly === true;
    if (forceRetry) {
      if (!ignoreCooldown) {
        const lastRetryAt = metadataPlayRetryCache.get(songId);
        if (lastRetryAt && Date.now() - lastRetryAt < PLAY_RETRY_COOLDOWN_MS) {
          return;
        }
        metadataPlayRetryCache.set(songId, Date.now());
      }
    }
    const song = get().getSongById(songId);
    if (!song) {
      return;
    }
    const attemptsCache = await loadMetadataAttempts();
    const primaryArtist = getPrimaryArtistName(song.artist);
    const artistKey = primaryArtist?.trim().toLowerCase();
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    const cacheIndex = await loadMetadataCacheIndex();
    const lyricsCached = isSongCached(cacheIndex, song.id, 'lyrics');
    const genreCached =
      isSongCached(cacheIndex, song.id, 'genre') ||
      Boolean(song.genre?.trim() && song.genre.trim().toLowerCase() !== 'unknown genre');
    const artistCached =
      artistKey ? isArtistCached(cacheIndex, artistKey) : await hasCachedArtistProfile(primaryArtist);
    const skipArtist = forceRetry ? false : shouldSkipMetadata(attemptsCache, 'artist', artistKey ?? '');
    const skipLyrics = forceRetry ? false : shouldSkipMetadata(attemptsCache, 'lyrics', song.id);
    const skipGenre = forceRetry ? false : shouldSkipMetadata(attemptsCache, 'genre', song.id);

    if (!basicOnly && artistKey && !artistCached && !skipArtist) {
      if (tryAcquireMetadata('artist', artistKey)) {
        const artistResult = await loadArtistProfile(primaryArtist);
        if (artistResult.status === 'ready') {
          noteMetadataSuccess(attemptsCache, 'artist', artistKey);
        } else {
          if (artistResult.status === 'missing' && isOnline) {
            noteMetadataFailure(attemptsCache, 'artist', artistKey);
          }
        }
        releaseMetadata('artist', artistKey);
      }
    }

    if (!basicOnly && !lyricsCached && !skipLyrics) {
      if (tryAcquireMetadata('lyrics', song.id)) {
        const lyricResult = await loadLyrics(song);
        if (lyricResult.status === 'ready') {
          noteMetadataSuccess(attemptsCache, 'lyrics', song.id);
        } else {
          if (isOnline) {
            noteMetadataFailure(attemptsCache, 'lyrics', song.id);
          }
        }
        releaseMetadata('lyrics', song.id);
      }
    }

    if (!genreCached && !skipGenre) {
      if (tryAcquireMetadata('genre', song.id)) {
        const genreResult = await loadSongGenre(song);
        if (genreResult.status === 'ready') {
          noteMetadataSuccess(attemptsCache, 'genre', song.id);
          void markSongCached(song.id, 'genre');
          if (genreResult.genre && genreResult.genre.toLowerCase() !== 'unknown genre') {
            await get().updateSongGenre(song.id, genreResult.genre);
          }
        } else {
          noteMetadataFailure(attemptsCache, 'genre', song.id);
        }
        releaseMetadata('genre', song.id);
      }
    }

    if (!basicOnly && song.album && song.artist) {
      const albumKey = getAlbumArtworkCacheKey(song.artist, song.album);
      const skipAlbum = forceRetry ? false : shouldSkipMetadata(attemptsCache, 'album', albumKey);
      if (!skipAlbum) {
        if (tryAcquireMetadata('album', albumKey)) {
          const art = await loadAlbumArtwork(song.artist, song.album);
          if (art) {
            noteMetadataSuccess(attemptsCache, 'album', albumKey);
          } else {
            noteMetadataFailure(attemptsCache, 'album', albumKey);
          }
          releaseMetadata('album', albumKey);
        }
      }
    }

    await saveMetadataAttempts(attemptsCache);
  },

  fetchLyricsCandidatesForSong: async (songId) => {
    const song = get().getSongById(songId);
    if (!song) {
      return [];
    }
    if (!tryAcquireMetadata('lyrics', song.id)) {
      return [];
    }
    try {
      return await findLyricsCandidates(song);
    } finally {
      releaseMetadata('lyrics', song.id);
    }
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
      metadataFetch: {
        ...get().metadataFetch,
        pending: cache.songs.length > 0,
      },
      albumTrackFetch: {
        ...get().albumTrackFetch,
        pending: cache.songs.length > 0,
      },
    });

    scheduleInitialScan(libraryPaths);
  },

  scanLibrary: async (pathsOverride) => {
    const targetPaths = normalizeLibraryPaths(pathsOverride ?? get().libraryPaths);
    const runId = (scanRunId += 1);
    if (initialScanTimer !== null && typeof window !== 'undefined') {
      const cancelIdle = (globalThis as typeof globalThis & {
        cancelIdleCallback?: (handle: number) => void;
      }).cancelIdleCallback;
      if (typeof cancelIdle === 'function') {
        cancelIdle(initialScanTimer);
      } else {
        window.clearTimeout(initialScanTimer);
      }
      initialScanTimer = null;
    }

    set({ isScanning: true, scanError: null, libraryPaths: targetPaths });

    try {
      const yieldToMain = () =>
        new Promise<void>((resolve) => {
          const idle = (globalThis as typeof globalThis & {
            requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
          }).requestIdleCallback;

          if (typeof idle === 'function') {
            idle(() => resolve(), { timeout: 200 });
            return;
          }

          setTimeout(() => resolve(), 0);
        });

      const scannedByFolder = await Promise.all(targetPaths.map((path) => scanMusicFolder(path)));
      const flattened = scannedByFolder.flat();
      const dedupedById = new Map<string, Song>();
      await yieldToMain();

      for (let index = 0; index < flattened.length; index += 1) {
        const song = flattened[index];
        if (!dedupedById.has(song.id)) {
          dedupedById.set(song.id, song);
        }
        if (index % 200 === 0) {
          await yieldToMain();
        }
      }

      const scannedSongs = [...dedupedById.values()];
      const existingMap = new Map(get().songs.map((song) => [song.id, song]));
      await yieldToMain();

      const mergedSongs: Song[] = [];
      for (let index = 0; index < scannedSongs.length; index += 1) {
        const song = scannedSongs[index];
        const previous = existingMap.get(song.id);
        mergedSongs.push({
          ...song,
          playCount: previous?.playCount ?? song.playCount,
          lastPlayed: previous?.lastPlayed ?? song.lastPlayed,
          favorite: previous?.favorite ?? song.favorite,
          genre: previous?.genre?.trim() ? previous.genre : song.genre,
          albumArt: previous?.albumArt ?? song.albumArt,
        });
        if (index % 200 === 0) {
          await yieldToMain();
        }
      }
      await yieldToMain();
      const hydratedSongs = await hydrateSongsWithCachedGenres(mergedSongs);
      await yieldToMain();
      const loudnessHydrated = await hydrateSongsWithCachedLoudness(hydratedSongs);
      await yieldToMain();

      const customPlaylists = get().customPlaylists;
      const weeklySeed = seedFromWeekKey(getIsoWeekKey());
      const playlists = buildPlaylists(customPlaylists);

      if (runId !== scanRunId) {
        return;
      }

      set({
        songs: loudnessHydrated,
        playlists,
        isScanning: false,
        smartPlaylistSeed: weeklySeed,
        metadataFetch: {
          ...get().metadataFetch,
          pending: true,
        },
        albumTrackFetch: {
          ...get().albumTrackFetch,
          pending: true,
        },
      });
      await persistLibrary(loudnessHydrated, customPlaylists);

      if (runId !== scanRunId) {
        return;
      }

      const schedule = (task: () => void) => {
        const idle = (globalThis as typeof globalThis & {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;
        if (typeof idle === 'function') {
          idle(task, { timeout: 1000 });
        } else {
          setTimeout(task, 0);
        }
      };

      schedule(() => {
        if (runId !== scanRunId) {
          return;
        }
        void (async () => {
          await refreshSmartPlaylists(loudnessHydrated, get().smartPlaylistOverrides, true, weeklySeed);
          if (runId !== scanRunId) {
            return;
          }
          const updatedCustom = get().customPlaylists;
          set({
            playlists: buildPlaylists(updatedCustom),
            smartPlaylistSeed: weeklySeed,
          });
        })();
      });
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
    return getSongByIdCached(get().songs, songId);
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

    void markSongCached(songId, 'genre');
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
