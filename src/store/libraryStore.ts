import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, ListeningActivity, ListeningProfile, Playlist, Song, TasteProfile } from '@/types/music';
import { deleteSongFile, ensureStorageDirs, isTauri, readStorageJson, writeStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { scanMusicFolder } from '@/services/musicScanner';
import {
  applyOverridesOnly,
  generateSmartPlaylists,
  generateSmartPlaylistsLite,
  isHeavyMixPlaylistId,
} from '@/services/playlistGenerator';
import { enhanceSmartPlaylistsWithRecommendationIndex } from '@/services/recommendationIndex';
import {
  enableOnlineRecommendations,
  loadOnlineRecommendationSignals,
  pickOnlineRecommendationSeedIds,
  scheduleOnlineEnrichment,
  setOnlineRecommendationRefreshHandler,
  setRecommendationSongResolver,
} from '@/services/onlineRecommendationService';
import { generateSmartPlaylistsRust } from '@/services/rustPlaylistService';
import { hydrateSongsWithCachedGenres, isUnknownGenre, loadSongGenre } from '@/services/songMetadataService';
import { findLyricsCandidates, loadLyrics, type LyricsCandidate } from '@/services/lyricsFetcher';
import { hasCachedArtistProfile, loadArtistProfile } from '@/services/artistProfileService';
import {
  getAlbumTracklistKey,
  loadAlbumTracklist,
  loadAlbumTracklistCache,
  type AlbumTracklistCache,
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
import { isMetadataActivityPaused } from '@/services/metadataActivityGate';
import { getDisplayTitleRepair, getMetadataArtistName, getPrimaryArtistName, normalizeArtistLookupText } from '@/utils/artists';
import {
  isSongCached,
  loadMetadataCacheIndex,
  markArtistCached,
  markSongCached,
} from '@/services/metadataCacheIndex';
import {
  getNonCriticalDelay,
  scheduleNonCriticalTask,
  shouldThrottleNonCriticalWork,
} from '@/services/appScheduler';
import {
  endPerfMeasure,
  markPerf,
  measurePerfAsync,
  recordFullLibraryWrite,
  recordPerfEvent,
  recordSongArrayReplacement,
} from '@/services/perfDiagnostics';

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
  smartPlaylists: Playlist[];
  customPlaylists: Playlist[];
  smartPlaylistOverrides: Record<string, string[]>;
  playlistUsage: Record<string, PlaylistUsageEntry>;
  smartPlaylistSeed: number;
  libraryVersion: number;
  activityVersion: number;
  artworkVersion: number;
  playlistVersion: number;
  regeneratingSmartPlaylists: boolean;
  searchQuery: string;
  metadataFetch: {
    running: boolean;
    total: number;
    done: number;
    artists: number;
    lyrics: number;
    genres: number;
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
  listeningProfile: ListeningProfile;
  listeningActivity: ListeningActivity;
  tasteProfile: TasteProfile | null;
  startMetadataFetch: (options?: { allowWhenActive?: boolean }) => void;
  startAlbumTracklistFetch: () => void;
  fetchMissingMetadataForSong: (
    songId: string,
    options?: {
      forceRetry?: boolean;
      basicOnly?: boolean;
      includeLyrics?: boolean;
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
  getSongById: (songId: string) => Song | undefined;
  getSongsById: () => Map<string, Song>;
  updateSongGenre: (songId: string, genre: string) => Promise<void>;
  toggleFavorite: (songId: string) => Promise<void>;
  deleteSongFromDisk: (songId: string) => Promise<boolean>;
  addSongToCustomPlaylist: (playlistId: string, songId: string) => Promise<void>;
  addSongToPlaylist: (playlistId: string, songId: string) => Promise<'added' | 'exists' | 'missing'>;
  recordSongPlay: (songId: string) => Promise<void>;
  recordPlaybackEvent: (songId: string, event: {
    listenedSec: number;
    durationSec?: number;
    manualSkip?: boolean;
    completed?: boolean;
  }) => Promise<void>;
  recordQueueAdd: (songId: string) => Promise<void>;
  recordPlaylistUse: (playlistId: string) => Promise<void>;
  upsertCustomPlaylist: (playlist: Playlist) => Promise<void>;
  deleteCustomPlaylist: (playlistId: string) => Promise<boolean>;
}

const libraryCachePath = 'playlists/library_cache.json';
const songActivityPath = 'playlists/song_activity.json';
const customPlaylistsPath = 'playlists/custom_playlists.json';
const smartOverridesPath = 'playlists/smart_overrides.json';
const smartCachePath = 'playlists/smart_cache.json';
const smartLiteCachePath = 'playlists/smart_cache_lite.json';
const dailyMixCachePath = 'playlists/daily_mix_cache.json';
const playlistUsagePath = 'playlists/playlist_usage.json';
const listeningProfilePath = 'playlists/listening_profile.json';
const listeningActivityPath = 'playlists/listening_activity.json';
const tasteProfilePath = 'playlists/taste_profile.json';

type SmartCache = {
  weekKey: string;
  playlists: Playlist[];
};

type LiteSmartCache = {
  generatedAt: number;
  playlists: Playlist[];
};

type DailyMixCache = {
  dayKey: string;
  songIds: string[];
  discoveryIntensity?: number;
  randomnessIntensity?: number;
};

type SongActivityPatch = Partial<
  Pick<
    Song,
    | 'playCount'
    | 'lastPlayed'
    | 'favorite'
    | 'title'
    | 'genre'
    | 'albumArt'
    | 'skipCount'
    | 'lastSkipped'
    | 'totalPlaySeconds'
    | 'lastPlayDurationSec'
    | 'lastPlayStarted'
    | 'lastCompleted'
    | 'manualQueueAdds'
    | 'lastManualQueueAdd'
  >
>;

type SongActivityCache = Record<string, SongActivityPatch>;

let smartCacheWeek: string | null = null;
let cachedSongsRef: Song[] | null = null;
let cachedSongsById: Map<string, Song> | null = null;
let cachedMergedSongsByIdRef: Song[] | null = null;
let cachedMergedSongsById: Map<string, Song> | null = null;
let cachedMergedSongsByIdRevision = -1;
let albumTracklistCacheMemo: AlbumTracklistCache | null = null;
let albumTracklistCacheLoadedAt = 0;
let smartPlaylistBuildInFlight = false;
let lastHeavyMixRegenAt = 0;
const HEAVY_MIX_REGEN_COOLDOWN_MS = 10 * 60 * 1000;
let smartPlaylistRefreshHandle: number | null = null;
let listeningProfileRefreshHandle: number | null = null;
let pendingSmartPlaylistRefresh:
  | {
      songs: Song[];
    }
  | null = null;
let metadataResumeHandle: number | null = null;
const metadataPlayRetryCache = new Map<string, number>();
const PLAY_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const LISTENING_PROFILE_REFRESH_DEBOUNCE_MS = 20_000;
let scanRunId = 0;
let songActivityCache: SongActivityCache | null = null;
let songActivityRevision = 0;
let onlineRecommendationHooksReady = false;

const onlineRecommendationEnabledFromWindow = (): boolean | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const flag = (window as unknown as { __AMP_ONLINE_RECS_ENABLED__?: boolean }).__AMP_ONLINE_RECS_ENABLED__;
  return typeof flag === 'boolean' ? flag : undefined;
};

const isOnlineRecommendationEnabled = async (): Promise<boolean> => {
  const globalEnabled = onlineRecommendationEnabledFromWindow();
  if (typeof globalEnabled === 'boolean') {
    return globalEnabled;
  }
  const settings = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
  return settings.onlineRecommendationsEnabled === true;
};

const loadOnlineSignalsForSmartPlaylists = async (): Promise<Awaited<ReturnType<typeof loadOnlineRecommendationSignals>>> => {
  if (!(await isOnlineRecommendationEnabled())) {
    return {};
  }
  return loadOnlineRecommendationSignals();
};

const enhanceSmartPlaylistsWithCachedSignals = async (
  playlists: Playlist[],
  songs: Song[],
  options: {
    seed?: number;
    discoveryIntensity?: number;
    randomnessIntensity?: number;
    onlineSignals?: Awaited<ReturnType<typeof loadOnlineRecommendationSignals>>;
  },
): Promise<Playlist[]> => {
  const onlineSignals = options.onlineSignals ?? (await loadOnlineSignalsForSmartPlaylists());
  return enhanceSmartPlaylistsWithRecommendationIndex(playlists, songs, onlineSignals, {
    seed: options.seed,
    discoveryLevel: options.discoveryIntensity,
    randomnessLevel: options.randomnessIntensity,
  });
};

const ensureOnlineRecommendationHooks = (): void => {
  if (onlineRecommendationHooksReady) {
    return;
  }
  onlineRecommendationHooksReady = true;
  setRecommendationSongResolver((songId) => useLibraryStore.getState().getSongById(songId));
  setOnlineRecommendationRefreshHandler(() => {
    const state = useLibraryStore.getState();
    if (!state.initialized || !state.songs.length) {
      return;
    }
    scheduleSmartPlaylistRefresh(state.songs, 6000, { includeHeavy: false });
  });
};

const scheduleOnlineRecommendationEnrichmentForSongs = async (
  songs: Song[],
  priority: 'idle' | 'background' | 'visible-route' = 'background',
): Promise<void> => {
  if (!songs.length || !(await isOnlineRecommendationEnabled())) {
    return;
  }
  ensureOnlineRecommendationHooks();
  const seedIds = pickOnlineRecommendationSeedIds(songs, 48);
  scheduleOnlineEnrichment(seedIds, priority);
};

const createDefaultListeningProfile = (): ListeningProfile => ({
  hourly: Array.from({ length: 24 }, () => 0),
  weekday: Array.from({ length: 7 }, () => 0),
  recentArtists: {},
  recentGenres: {},
  updatedAt: undefined,
});

const createDefaultListeningActivity = (): ListeningActivity => ({
  dailySeconds: {},
  updatedAt: undefined,
});

const hydrateSongsWithCachedAlbumArt = async (songs: Song[]): Promise<Song[]> => songs;

const normalizeProfile = (profile: ListeningProfile | null): ListeningProfile => {
  const base = createDefaultListeningProfile();
  if (!profile) {
    return base;
  }
  return {
    hourly: profile.hourly?.length === 24 ? profile.hourly : base.hourly,
    weekday: profile.weekday?.length === 7 ? profile.weekday : base.weekday,
    recentArtists: profile.recentArtists ?? {},
    recentGenres: profile.recentGenres ?? {},
    updatedAt: profile.updatedAt,
  };
};

const normalizeActivity = (activity: ListeningActivity | null): ListeningActivity => {
  const base = createDefaultListeningActivity();
  if (!activity) {
    return base;
  }
  return {
    dailySeconds: activity.dailySeconds ?? base.dailySeconds,
    updatedAt: activity.updatedAt,
  };
};

const noteRecentMap = (
  map: Record<string, { count: number; lastPlayed: number }>,
  key: string,
  now: number,
): Record<string, { count: number; lastPlayed: number }> => {
  if (!key) {
    return map;
  }
  const existing = map[key];
  const cutoff = now - 30 * 24 * 60 * 60;
  const shouldReset = existing ? existing.lastPlayed < cutoff : false;
  const nextCount = shouldReset ? 1 : (existing?.count ?? 0) + 1;
  return {
    ...map,
    [key]: { count: nextCount, lastPlayed: now },
  };
};

const buildTasteProfile = (songs: Song[], profile: ListeningProfile): TasteProfile => {
  const updatedAt = Math.floor(Date.now() / 1000);
  const artistCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();
  let totalPlays = 0;
  let totalSkips = 0;
  let completionSum = 0;
  let completionCount = 0;
  let lowPlayPlays = 0;

  for (const song of songs) {
    const plays = song.playCount ?? 0;
    if (plays > 0) {
      totalPlays += plays;
      const artistKey = getPrimaryArtistName(song.artist).trim();
      if (artistKey) {
        artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + plays);
      }
      const genreKey = song.genre?.trim();
      if (genreKey && genreKey.toLowerCase() !== 'unknown genre') {
        genreCounts.set(genreKey, (genreCounts.get(genreKey) ?? 0) + plays);
      }
    }
    totalSkips += song.skipCount ?? 0;
    if (song.duration && song.duration > 0 && song.totalPlaySeconds && plays > 0) {
      const ratio = Math.min(1, Math.max(0, song.totalPlaySeconds / (plays * song.duration)));
      completionSum += ratio;
      completionCount += 1;
    }
    if ((song.playCount ?? 0) <= 2) {
      lowPlayPlays += plays;
    }
  }

  const topArtists = [...artistCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  const hourBuckets = profile.hourly ?? Array.from({ length: 24 }, () => 0);
  const morning = hourBuckets.slice(5, 12).reduce((sum, value) => sum + value, 0);
  const afternoon = hourBuckets.slice(12, 17).reduce((sum, value) => sum + value, 0);
  const evening = hourBuckets.slice(17, 22).reduce((sum, value) => sum + value, 0);
  const night = hourBuckets.reduce((sum, value, index) => {
    if (index >= 22 || index <= 4) {
      return sum + value;
    }
    return sum;
  }, 0);

  return {
    updatedAt,
    topArtists,
    topGenres,
    dayparts: {
      morning,
      afternoon,
      evening,
      night,
    },
    skipRate: totalPlays ? Math.min(1, totalSkips / Math.max(1, totalPlays)) : 0,
    completionRate: completionCount ? Math.min(1, completionSum / completionCount) : 0,
    explorationRate: totalPlays ? Math.min(1, lowPlayPlays / totalPlays) : 0,
  };
};
let initialScanScheduled = false;
let initialScanTimer: number | null = null;

const scheduleBackgroundTask = (task: () => void, timeoutMs = 800): void => {
  if (typeof window === 'undefined') {
    task();
    return;
  }
  scheduleNonCriticalTask(task, { delayMs: timeoutMs, timeoutMs, reason: 'library.background-task' });
};

const getCachedAlbumTracklistCache = async (force = false): Promise<AlbumTracklistCache> => {
  const now = Date.now();
  if (!force && albumTracklistCacheMemo && now - albumTracklistCacheLoadedAt < 5 * 60 * 1000) {
    return albumTracklistCacheMemo;
  }
  const cache = await loadAlbumTracklistCache();
  albumTracklistCacheMemo = cache;
  albumTracklistCacheLoadedAt = now;
  return cache;
};

const scheduleInitialScan = (paths: string[]): void => {
  if (initialScanScheduled) {
    return;
  }
  initialScanScheduled = true;

  if (typeof window === 'undefined') {
    void useLibraryStore.getState().scanLibrary(paths);
    return;
  }
  initialScanTimer = window.setTimeout(() => {
    initialScanTimer = null;
    scheduleNonCriticalTask(
      () => {
        void useLibraryStore.getState().scanLibrary(paths);
      },
      {
        delayMs: 0,
        timeoutMs: 4000,
        reason: 'library.initial-scan',
      },
    );
  }, getNonCriticalDelay(10_000));
};

const scheduleMetadataResume = (delayMs = 12_000): void => {
  if (typeof window === 'undefined') {
    const state = useLibraryStore.getState();
    if (state.initialized && state.metadataFetch.pending && !state.metadataFetch.running) {
      state.startMetadataFetch();
    }
    return;
  }

  if (metadataResumeHandle !== null) {
    window.clearTimeout(metadataResumeHandle);
  }

  metadataResumeHandle = window.setTimeout(() => {
    metadataResumeHandle = null;
    scheduleNonCriticalTask(
      () => {
        const state = useLibraryStore.getState();
        if (!state.initialized || state.metadataFetch.running || !state.metadataFetch.pending) {
          return;
        }
        if (isMetadataActivityPaused()) {
          scheduleMetadataResume(10_000);
          return;
        }
        state.startMetadataFetch();
      },
      {
        delayMs: 0,
        timeoutMs: 3500,
        reason: 'metadata.resume',
      },
    );
  }, getNonCriticalDelay(delayMs));
};

const getSongsByIdCached = (songs: Song[]): Map<string, Song> => {
  if (cachedSongsRef !== songs || !cachedSongsById) {
    cachedSongsRef = songs;
    cachedSongsById = new Map(songs.map((entry) => [entry.id, entry]));
  }
  return cachedSongsById;
};

const getSongByIdCached = (songs: Song[], songId: string): Song | undefined => {
  if (!songs.length) {
    return undefined;
  }
  return getSongsByIdCached(songs).get(songId);
};

const mergeSongActivity = (song: Song, patch?: SongActivityPatch): Song => {
  if (!patch || !Object.keys(patch).length) {
    return song;
  }
  return {
    ...song,
    ...patch,
  };
};

const applySongActivity = (songs: Song[], activity: SongActivityCache): Song[] => {
  if (!Object.keys(activity).length) {
    return songs;
  }
  let changed = false;
  const merged = songs.map((song) => {
    const patch = activity[song.id];
    if (!patch) {
      return song;
    }
    changed = true;
    return mergeSongActivity(song, patch);
  });
  return changed ? merged : songs;
};

const loadSongActivityCache = async (): Promise<SongActivityCache> => {
  if (songActivityCache) {
    return songActivityCache;
  }
  songActivityCache = await readStorageJson<SongActivityCache>(songActivityPath, {});
  songActivityRevision += 1;
  return songActivityCache;
};

const updateSongActivityPatch = async (
  songId: string,
  updater: (current: SongActivityPatch) => SongActivityPatch,
): Promise<SongActivityPatch> => {
  const cache = await loadSongActivityCache();
  const current = cache[songId] ?? {};
  const next = updater(current);
  cache[songId] = next;
  songActivityRevision += 1;
  recordPerfEvent('library.song-activity.patch', { songId });
  void writeStorageJsonDebounced(songActivityPath, cache, 1500);
  return next;
};

const loadEmbeddedArtworkForSong = async (song: Song): Promise<string | null> => {
  if (!isTauri() || !song.path) {
    return null;
  }

  try {
    const artwork = await invoke<string | null>('load_embedded_artwork', { path: song.path });
    return artwork?.trim() ? artwork : null;
  } catch {
    return null;
  }
};

const loadTrackArtworkForSong = async (song: Song): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }

  try {
    const artwork = await invoke<string | null>('load_track_artwork_rust', {
      song: {
        id: song.id ?? null,
        title: song.title,
        artist: song.artist,
        album: song.album ?? null,
        duration: song.duration ?? null,
        genre: song.genre ?? null,
      },
    });
    return artwork?.trim() ? artwork : null;
  } catch {
    return null;
  }
};

const findSameArtistGenre = (song: Song, songs: Song[]): string | null => {
  const targetArtist = normalizeArtistLookupText(getMetadataArtistName(song.artist, song.title));
  if (!targetArtist || targetArtist === 'unknown artist') {
    return null;
  }

  const genreCounts = new Map<string, number>();
  for (const candidate of songs) {
    if (candidate.id === song.id || isUnknownGenre(candidate.genre)) {
      continue;
    }
    const candidateArtist = normalizeArtistLookupText(getMetadataArtistName(candidate.artist, candidate.title));
    if (candidateArtist !== targetArtist) {
      continue;
    }
    const genre = candidate.genre.trim();
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1 + Math.min(6, candidate.playCount ?? 0));
  }

  return [...genreCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
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
  options: {
    force?: boolean;
    seedOverride?: number;
    persist?: boolean;
  } = {},
): Promise<Playlist[]> => {
  const { force = false, seedOverride, persist = true } = options;
  const weekKey = getIsoWeekKey();
  const dayKey = getIsoDayKey();
  const cachedSmart = useLibraryStore.getState().smartPlaylists;
  if (!force && smartCacheWeek === weekKey && cachedSmart.length) {
    return enhanceSmartPlaylistsWithCachedSignals(cachedSmart, songs, { seed: seedFromWeekKey(weekKey) });
  }

  const cached = force ? null : await readStorageJson<SmartCache | null>(smartCachePath, null);
  if (!force && cached?.weekKey === weekKey && cached.playlists?.length) {
    smartCacheWeek = cached.weekKey;
    return enhanceSmartPlaylistsWithCachedSignals(applySmartOverrides(cached.playlists, overrides, songs), songs, {
      seed: seedFromWeekKey(weekKey),
    });
  }

  const resolvedSeed = seedOverride ?? (force ? Date.now() : undefined);
  const dailySeed = seedFromDayKey(dayKey);
  const songsById = new Map(songs.map((song) => [song.id, song]));
  const discoveryFromGlobal =
    typeof window !== 'undefined'
      ? (window as unknown as { __AMP_DISCOVERY_INTENSITY__?: number }).__AMP_DISCOVERY_INTENSITY__
      : undefined;
  const randomnessFromGlobal =
    typeof window !== 'undefined'
      ? (window as unknown as { __AMP_RANDOMNESS_INTENSITY__?: number }).__AMP_RANDOMNESS_INTENSITY__
      : undefined;
  let discoveryIntensity = typeof discoveryFromGlobal === 'number' ? discoveryFromGlobal : undefined;
  let randomnessIntensity = typeof randomnessFromGlobal === 'number' ? randomnessFromGlobal : undefined;
  if (discoveryIntensity === undefined || randomnessIntensity === undefined) {
    const settings = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
    if (discoveryIntensity === undefined) {
      discoveryIntensity = typeof settings.discoveryIntensity === 'number' ? settings.discoveryIntensity : undefined;
    }
    if (randomnessIntensity === undefined) {
      randomnessIntensity = typeof settings.randomnessIntensity === 'number' ? settings.randomnessIntensity : undefined;
    }
  }
  const dailyCached = force ? null : await readStorageJson<DailyMixCache | null>(dailyMixCachePath, null);
  const dailyMatchesSettings =
    dailyCached &&
    (dailyCached.discoveryIntensity === undefined || dailyCached.discoveryIntensity === discoveryIntensity) &&
    (dailyCached.randomnessIntensity === undefined || dailyCached.randomnessIntensity === randomnessIntensity);
  const dailyMixOverride =
    dailyCached && dailyCached.dayKey === dayKey && dailyMatchesSettings
      ? dailyCached.songIds.map((id) => songsById.get(id)).filter((song): song is Song => Boolean(song))
      : null;
  const resolvedDailyOverride =
    dailyMixOverride && dailyMixOverride.length > 0 ? dailyMixOverride : null;
  const albumTracklistCache = await getCachedAlbumTracklistCache();
  const listeningProfile = useLibraryStore.getState().listeningProfile;
  const onlineSignals = await loadOnlineSignalsForSmartPlaylists();
  const rustGenerated = await generateSmartPlaylistsRust(songs, {
    seed: resolvedSeed,
    dailySeed,
    profile: listeningProfile,
    discoveryIntensity,
    randomnessIntensity,
    lite: false,
  });
  const generatedBase = rustGenerated
    ? applyOverridesOnly(rustGenerated as Playlist[], songs, overrides)
    : generateSmartPlaylists(
        songs,
        overrides,
        resolvedSeed,
        albumTracklistCache,
        resolvedDailyOverride ?? undefined,
        dailySeed,
        listeningProfile,
        discoveryIntensity,
        randomnessIntensity,
        onlineSignals,
      );
  const generated = rustGenerated
    ? await enhanceSmartPlaylistsWithCachedSignals(generatedBase, songs, {
        seed: resolvedSeed ?? seedFromWeekKey(weekKey),
        discoveryIntensity,
        randomnessIntensity,
        onlineSignals,
      })
    : generatedBase;
  smartCacheWeek = weekKey;
  const tasteProfile = buildTasteProfile(songs, listeningProfile);
  useLibraryStore.setState({ tasteProfile });
  if (persist) {
    await writeStorageJsonDebounced(tasteProfilePath, tasteProfile, 1500);
  }
  if (persist) {
    await writeStorageJson(smartCachePath, { weekKey, playlists: generated });
  }
  if (persist && !resolvedDailyOverride) {
    const daily = generated.find((playlist) => playlist.id === 'smart_daily_mix');
    if (daily?.songIds?.length) {
      await writeStorageJson(dailyMixCachePath, {
        dayKey,
        songIds: daily.songIds,
        discoveryIntensity,
        randomnessIntensity,
      });
    }
  }
  return generated;
};

const regenerateSmartPlaylistsForCurrentState = async (
  songs: Song[],
  overrides: Record<string, string[]>,
  seed: number,
): Promise<Playlist[]> => {
  return refreshSmartPlaylists(songs, overrides, {
    force: true,
    seedOverride: seed,
    persist: false,
  });
};

const shouldBlockMixRegen = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const flags = window as unknown as {
    __AMP_IS_PLAYING__?: boolean;
    __AMP_MIX_REGEN_PAUSED__?: boolean;
  };
  return flags.__AMP_MIX_REGEN_PAUSED__ === true && flags.__AMP_IS_PLAYING__ === true;
};

const refreshSmartPlaylistsLite = async (
  songs: Song[],
  overrides: Record<string, string[]>,
  options: {
    seedOverride?: number;
    dailySeedOverride?: number;
    persist?: boolean;
  } = {},
): Promise<Playlist[]> => {
  const { seedOverride, dailySeedOverride, persist = false } = options;
  const dayKey = getIsoDayKey();
  const resolvedSeed = seedOverride ?? Date.now();
  const dailySeed = dailySeedOverride ?? seedFromDayKey(dayKey);
  const songsById = new Map(songs.map((song) => [song.id, song]));
  const listeningProfile = useLibraryStore.getState().listeningProfile;
  const discoveryFromGlobal =
    typeof window !== 'undefined'
      ? (window as unknown as { __AMP_DISCOVERY_INTENSITY__?: number }).__AMP_DISCOVERY_INTENSITY__
      : undefined;
  const randomnessFromGlobal =
    typeof window !== 'undefined'
      ? (window as unknown as { __AMP_RANDOMNESS_INTENSITY__?: number }).__AMP_RANDOMNESS_INTENSITY__
      : undefined;
  let discoveryIntensity = typeof discoveryFromGlobal === 'number' ? discoveryFromGlobal : undefined;
  let randomnessIntensity = typeof randomnessFromGlobal === 'number' ? randomnessFromGlobal : undefined;
  if (discoveryIntensity === undefined || randomnessIntensity === undefined) {
    const settings = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
    if (discoveryIntensity === undefined) {
      discoveryIntensity = typeof settings.discoveryIntensity === 'number' ? settings.discoveryIntensity : undefined;
    }
    if (randomnessIntensity === undefined) {
      randomnessIntensity = typeof settings.randomnessIntensity === 'number' ? settings.randomnessIntensity : undefined;
    }
  }
  const dailyCached = await readStorageJson<DailyMixCache | null>(dailyMixCachePath, null);
  const dailyMatchesSettings =
    dailyCached &&
    (dailyCached.discoveryIntensity === undefined || dailyCached.discoveryIntensity === discoveryIntensity) &&
    (dailyCached.randomnessIntensity === undefined || dailyCached.randomnessIntensity === randomnessIntensity);
  const dailyMixOverride =
    dailyCached && dailyCached.dayKey === dayKey && dailyMatchesSettings
      ? dailyCached.songIds.map((id) => songsById.get(id)).filter((song): song is Song => Boolean(song))
      : null;
  const resolvedDailyOverride =
    dailyMixOverride && dailyMixOverride.length > 0 ? dailyMixOverride : null;

  const carryMixes = useLibraryStore
    .getState()
    .smartPlaylists.filter((playlist) => isHeavyMixPlaylistId(playlist.id));
  const onlineSignals = await loadOnlineSignalsForSmartPlaylists();
  const rustGenerated = await generateSmartPlaylistsRust(songs, {
    seed: resolvedSeed,
    dailySeed,
    profile: listeningProfile,
    discoveryIntensity,
    randomnessIntensity,
    lite: true,
  });
  const generatedBase = rustGenerated
    ? applyOverridesOnly([...(rustGenerated as Playlist[]), ...carryMixes], songs, overrides)
    : generateSmartPlaylistsLite(
        songs,
        overrides,
        resolvedSeed,
        resolvedDailyOverride ?? undefined,
        dailySeed,
        listeningProfile,
        discoveryIntensity,
        randomnessIntensity,
        carryMixes,
        onlineSignals,
      );
  const generated = rustGenerated
    ? await enhanceSmartPlaylistsWithCachedSignals(generatedBase, songs, {
        seed: resolvedSeed,
        discoveryIntensity,
        randomnessIntensity,
        onlineSignals,
      })
    : generatedBase;

  const tasteProfile = buildTasteProfile(songs, listeningProfile);
  useLibraryStore.setState({ tasteProfile });
  if (persist) {
    await writeStorageJsonDebounced(tasteProfilePath, tasteProfile, 1500);
    await writeStorageJsonDebounced(
      smartLiteCachePath,
      { generatedAt: Math.floor(Date.now() / 1000), playlists: generated },
      1500,
    );
  }
  return generated;
};

const regenerateSmartPlaylistsLiteForCurrentState = async (
  songs: Song[],
  overrides: Record<string, string[]>,
  seed: number,
): Promise<Playlist[]> => {
  return refreshSmartPlaylistsLite(songs, overrides, {
    seedOverride: seed,
    persist: true,
  });
};

const scheduleIdleHeavyMixRefresh = (
  songs: Song[],
  overrides: Record<string, string[]>,
  seed: number,
  delayMs = 1200,
): void => {
  const run = async () => {
    if (shouldBlockMixRegen()) {
      if (typeof window !== 'undefined') {
        window.setTimeout(() => scheduleIdleHeavyMixRefresh(songs, overrides, seed, delayMs), getNonCriticalDelay(4000));
      }
      return;
    }
    const now = Date.now();
    if (lastHeavyMixRegenAt && now - lastHeavyMixRegenAt < HEAVY_MIX_REGEN_COOLDOWN_MS) {
      const wait = Math.max(1000, HEAVY_MIX_REGEN_COOLDOWN_MS - (now - lastHeavyMixRegenAt));
      if (typeof window !== 'undefined') {
        window.setTimeout(() => scheduleIdleHeavyMixRefresh(songs, overrides, seed, delayMs), getNonCriticalDelay(wait));
      }
      return;
    }
    smartPlaylistBuildInFlight = true;
    let generated: Playlist[] = [];
    try {
      generated = await regenerateSmartPlaylistsForCurrentState(songs, overrides, seed);
      lastHeavyMixRegenAt = Date.now();
    } finally {
      smartPlaylistBuildInFlight = false;
    }
    const state = useLibraryStore.getState();
    useLibraryStore.setState({
      smartPlaylists: generated,
      playlists: buildPlaylists(generated, state.customPlaylists),
      smartPlaylistSeed: state.smartPlaylistSeed,
      playlistVersion: state.playlistVersion + 1,
    });
  };

  if (typeof window === 'undefined') {
    void run();
    return;
  }

  scheduleNonCriticalTask(() => void run(), {
    delayMs,
    timeoutMs: Math.max(1200, delayMs),
    reason: 'library.heavy-mix-refresh',
  });
};

const scheduleSmartPlaylistRefresh = (
  songs: Song[],
  delayMs = 1200,
  options: { includeHeavy?: boolean } = {},
): void => {
  const includeHeavy = options.includeHeavy ?? true;
  pendingSmartPlaylistRefresh = { songs };

  const run = async () => {
    if (smartPlaylistBuildInFlight) {
      if (typeof window !== 'undefined') {
        smartPlaylistRefreshHandle = window.setTimeout(() => {
          smartPlaylistRefreshHandle = null;
          void run();
        }, getNonCriticalDelay(Math.min(delayMs, 1200)));
      }
      return;
    }
    const next = pendingSmartPlaylistRefresh;
    pendingSmartPlaylistRefresh = null;
    if (!next) {
      return;
    }
    if (shouldBlockMixRegen() || shouldThrottleNonCriticalWork()) {
      pendingSmartPlaylistRefresh = next;
      smartPlaylistRefreshHandle = window.setTimeout(() => {
        smartPlaylistRefreshHandle = null;
        void run();
      }, getNonCriticalDelay(Math.max(delayMs, 4000)));
      recordPerfEvent('library.smart-playlists.refresh-paused', {
        includeHeavy,
        songs: next.songs.length,
      });
      return;
    }

    const state = useLibraryStore.getState();
    smartPlaylistBuildInFlight = true;
    let generated: Playlist[] = [];
    try {
      generated = await regenerateSmartPlaylistsLiteForCurrentState(next.songs, state.smartPlaylistOverrides, state.smartPlaylistSeed);
    } finally {
      smartPlaylistBuildInFlight = false;
    }
    useLibraryStore.setState({
      smartPlaylists: generated,
      playlists: buildPlaylists(generated, state.customPlaylists),
      smartPlaylistSeed: state.smartPlaylistSeed,
      playlistVersion: state.playlistVersion + 1,
    });

    if (includeHeavy) {
      scheduleIdleHeavyMixRefresh(next.songs, state.smartPlaylistOverrides, state.smartPlaylistSeed, Math.max(1200, delayMs));
    }
  };

  if (typeof window === 'undefined') {
    void run();
    return;
  }

  if (smartPlaylistRefreshHandle !== null) {
    window.clearTimeout(smartPlaylistRefreshHandle);
  }

  smartPlaylistRefreshHandle = window.setTimeout(() => {
    smartPlaylistRefreshHandle = null;
    void run();
  }, getNonCriticalDelay(delayMs));
};

const scheduleListeningProfileRefresh = (songs: Song[]): void => {
  if (typeof window === 'undefined') {
    scheduleSmartPlaylistRefresh(songs, 400, { includeHeavy: false });
    return;
  }

  if (listeningProfileRefreshHandle !== null) {
    window.clearTimeout(listeningProfileRefreshHandle);
  }

  listeningProfileRefreshHandle = window.setTimeout(() => {
    listeningProfileRefreshHandle = null;
    const lastInteraction =
      (window as unknown as { __AMP_LAST_INTERACTION__?: number }).__AMP_LAST_INTERACTION__ ?? 0;
    const recentlyActive = Date.now() - lastInteraction < 15_000;
    if (recentlyActive || shouldBlockMixRegen() || shouldThrottleNonCriticalWork()) {
      scheduleListeningProfileRefresh(songs);
      return;
    }
    scheduleSmartPlaylistRefresh(songs, 400, { includeHeavy: false });
  }, LISTENING_PROFILE_REFRESH_DEBOUNCE_MS);
};

const buildPlaylists = (smartPlaylists: Playlist[], customPlaylists: Playlist[]): Playlist[] => {
  return [...smartPlaylists, ...customPlaylists];
};

const removeSongIdFromPlaylists = (playlists: Playlist[], songId: string): Playlist[] =>
  playlists.map((playlist) => ({
    ...playlist,
    songIds: playlist.songIds.filter((id) => id !== songId),
  }));

const removeSongIdFromOverrides = (
  overrides: Record<string, string[]>,
  songId: string,
): Record<string, string[]> => {
  const next: Record<string, string[]> = {};
  for (const [playlistId, ids] of Object.entries(overrides)) {
    const filtered = ids.filter((id) => id !== songId);
    if (filtered.length) {
      next[playlistId] = filtered;
    }
  }
  return next;
};

const normalizeLibraryPaths = (paths: string[]): string[] => {
  const cleaned = paths.map((path) => path.trim()).filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.length ? unique : ['music'];
};

const persistLibrary = async (songs: Song[], customPlaylists: Playlist[]): Promise<void> => {
  const payload: LibraryPersisted = { songs };
  recordFullLibraryWrite('library-structural-change', { songs: songs.length, customPlaylists: customPlaylists.length });
  recordPerfEvent('library.persist.full', { songs: songs.length, customPlaylists: customPlaylists.length });
  await writeStorageJsonDebounced(libraryCachePath, payload, 1500);
  await persistCustomPlaylists(customPlaylists);
};

const persistCustomPlaylists = async (customPlaylists: Playlist[]): Promise<void> => {
  recordPerfEvent('library.persist.custom-playlists', { customPlaylists: customPlaylists.length });
  await writeStorageJsonDebounced(customPlaylistsPath, customPlaylists, 1500);
};

export const useLibraryStore = create<LibraryState>((set, get) => ({
  initialized: false,
  isScanning: false,
  scanError: null,
  libraryPaths: ['music'],
  songs: [],
  playlists: [],
  smartPlaylists: [],
  customPlaylists: [],
  smartPlaylistOverrides: {},
  playlistUsage: {},
  smartPlaylistSeed: seedFromWeekKey(getIsoWeekKey()),
  libraryVersion: 0,
  activityVersion: 0,
  artworkVersion: 0,
  playlistVersion: 0,
  regeneratingSmartPlaylists: false,
  searchQuery: '',
      metadataFetch: {
        running: false,
        total: 0,
        done: 0,
        artists: 0,
        lyrics: 0,
        genres: 0,
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
      listeningProfile: createDefaultListeningProfile(),
      listeningActivity: createDefaultListeningActivity(),
      tasteProfile: null,

  startMetadataFetch: (options) => {
    const state = get();
    if (state.metadataFetch.running) {
      return;
    }
    if (!options?.allowWhenActive && isMetadataActivityPaused()) {
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
      const isPlaying =
        typeof window !== 'undefined' &&
        (window as unknown as { __AMP_IS_PLAYING__?: boolean }).__AMP_IS_PLAYING__ === true;
      if (settings.gameMode || metadataPaused || isPlaying) {
        recordPerfEvent('metadata.bulk.paused', {
          reason: metadataPaused ? 'user-paused' : settings.gameMode ? 'game-mode' : 'playback-active',
        });
        set({
          metadataFetch: {
            running: false,
            total: 0,
            done: 0,
            artists: 0,
            lyrics: 0,
            genres: 0,
            pending: !metadataPaused,
            message: metadataPaused
              ? 'Paused by user. Resume from Settings when ready.'
              : settings.gameMode
                ? 'Game Mode pauses bulk metadata fetching.'
                : 'Paused during playback. Current song metadata still updates.',
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
      let done = 0;
      let lastUpdate = performance.now();
      const pendingGenreUpdates = new Map<string, string>();
      const artistPriorityKeys = new Set<string>();
      const priorityNowSec = Date.now() / 1000;
      const scoreArtistPriority = (song: Song) =>
        (song.favorite ? 80 : 0) +
        Math.sqrt(Math.max(0, song.playCount ?? 0)) * 14 +
        (song.lastPlayed ? Math.max(0, 35 - (priorityNowSec - song.lastPlayed) / 86_400) : 0) +
        (song.albumArt ? 0 : 16);
      const artistPrioritySongs = [...songs].sort((a, b) => {
        return scoreArtistPriority(b) - scoreArtistPriority(a);
      });
      for (const song of artistPrioritySongs) {
        const key = normalizeArtistLookupText(getMetadataArtistName(song.artist, song.title));
        if (key && key !== 'unknown artist') {
          artistPriorityKeys.add(key);
        }
        if (artistPriorityKeys.size >= 96) {
          break;
        }
      }

      const pendingEntries: Array<{
        song: Song;
        needsLyrics: boolean;
        needsGenre: boolean;
        needsArtist: boolean;
        artistKey: string | null;
      }> = [];
      const artistCachedByKey = new Map<string, boolean>();
      const attemptsCache = await loadMetadataAttempts();
      let checked = 0;

      for (const song of songs) {
        const primaryArtist = getMetadataArtistName(song.artist, song.title);
        const artistKey = normalizeArtistLookupText(primaryArtist);
        let artistCached = true;
        if (artistKey) {
          const cachedMemo = artistCachedByKey.get(artistKey);
          if (cachedMemo !== undefined) {
            artistCached = cachedMemo;
          } else {
            artistCached = await hasCachedArtistProfile(primaryArtist);
            artistCachedByKey.set(artistKey, artistCached);
            if (artistCached) {
              void markArtistCached(artistKey);
            }
          }
        }
        const artistPriority = Boolean(artistKey && artistPriorityKeys.has(artistKey));
        const needsLyrics = false;
        const needsGenre =
          !Boolean(song.genre?.trim() && song.genre.trim().toLowerCase() !== 'unknown genre') &&
          !shouldSkipMetadata(attemptsCache, 'genre', song.id);
        const needsArtist =
          artistKey && artistPriority
            ? !artistCached && !shouldSkipMetadata(attemptsCache, 'artist', artistKey)
            : false;
        if (
          needsLyrics ||
          needsGenre ||
          needsArtist
        ) {
          pendingEntries.push({
            song,
            needsLyrics,
            needsGenre,
            needsArtist,
            artistKey: artistKey ?? null,
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
            total: metadataTasks.length || pendingEntries.length,
            done,
            artists: artistCount,
            lyrics: lyricCount,
            genres: genreCount,
            pending: true,
            message: null,
          },
        });
      };

      const flushSongMetadataUpdates = async () => {
        if (
          !pendingGenreUpdates.size
        ) {
          return;
        }

        let activityChanged = false;

        for (const [songId, genre] of pendingGenreUpdates.entries()) {
          const normalized = genre.trim();
          if (!normalized || normalized.toLowerCase() === 'unknown genre') {
            continue;
          }
          const current = get().getSongById(songId);
          if (current && current.genre.trim().toLowerCase() !== normalized.toLowerCase()) {
            await updateSongActivityPatch(songId, (patch) => ({
              ...patch,
              genre: normalized,
            }));
            activityChanged = true;
          }
        }

        pendingGenreUpdates.clear();

        if (!activityChanged) {
          return;
        }

        set((state) => ({
          activityVersion: state.activityVersion + 1,
        }));

        if (activityChanged) {
          const songsById = get().getSongsById();
          const mergedSongs = get().songs.map((entry) => songsById.get(entry.id) ?? entry);
          scheduleSmartPlaylistRefresh(mergedSongs, 300, { includeHeavy: false });
        }
      };

      const maybeCheckpointSongMetadataUpdates = async () => {
        if (pendingGenreUpdates.size >= 100) {
          await flushSongMetadataUpdates();
        }
      };

      const metadataTasks: Array<() => Promise<void>> = [];
      const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
      for (const entry of pendingEntries) {
        const song = entry.song;
        const primaryArtist = getMetadataArtistName(song.artist, song.title);
        const artistKey = entry.artistKey ?? normalizeArtistLookupText(primaryArtist) ?? null;

        if (entry.needsGenre) {
          metadataTasks.push(async () => {
            if (!tryAcquireMetadata('genre', song.id)) {
              return;
            }
            try {
              const genreResult = await loadSongGenre(song);
              if (genreResult.status === 'ready') {
                genreCount += 1;
                noteMetadataSuccess(attemptsCache, 'genre', song.id);
                void markSongCached(song.id, 'genre');
                if (genreResult.genre && genreResult.genre.toLowerCase() !== 'unknown genre') {
                  pendingGenreUpdates.set(song.id, genreResult.genre);
                  await maybeCheckpointSongMetadataUpdates();
                }
              } else if (genreResult.status === 'missing' && isOnline) {
                noteMetadataFailure(attemptsCache, 'genre', song.id);
              }
            } finally {
              releaseMetadata('genre', song.id);
            }
          });
        }

        if (
          entry.needsArtist &&
          artistKey &&
          artistCachedByKey.get(artistKey) === false &&
          !seenArtists.has(artistKey)
        ) {
          seenArtists.add(artistKey);
          metadataTasks.push(async () => {
            if (!tryAcquireMetadata('artist', artistKey)) {
              return;
            }
            try {
              const artistResult = await loadArtistProfile(primaryArtist, { waitForIdle: false });
              if (artistResult.status === 'ready') {
                artistCount += 1;
                noteMetadataSuccess(attemptsCache, 'artist', artistKey);
              } else if (artistResult.status === 'missing' && isOnline) {
                noteMetadataFailure(attemptsCache, 'artist', artistKey);
              }
            } finally {
              releaseMetadata('artist', artistKey);
            }
          });
        }
      }

      const flags =
        typeof window !== 'undefined'
          ? (window as unknown as { __AMP_IS_PLAYING__?: boolean; __AMP_LOW_PERF__?: boolean })
          : {};
      const concurrency = flags.__AMP_LOW_PERF__ ? 2 : flags.__AMP_IS_PLAYING__ ? 1 : 5;
      let abortedByUser = false;
      let taskIndex = 0;

      const runWorker = async () => {
        while (taskIndex < metadataTasks.length && !abortedByUser && !shouldPause()) {
          if (typeof window !== 'undefined') {
            const paused =
              (window as unknown as { __AMP_METADATA_PAUSED__?: boolean }).__AMP_METADATA_PAUSED__ === true;
            const playing =
              (window as unknown as { __AMP_IS_PLAYING__?: boolean }).__AMP_IS_PLAYING__ === true;
            const gameMode =
              (window as unknown as { __AMP_GAME_MODE__?: boolean }).__AMP_GAME_MODE__ === true;
            if (paused || playing || gameMode) {
              abortedByUser = true;
              break;
            }
          }
          const task = metadataTasks[taskIndex];
          taskIndex += 1;
          try {
            await task();
          } catch {
            // Ignore per-task failures and continue.
          } finally {
            done += 1;
            updateProgress();
            if (done % 12 === 0) {
              await yieldToMain();
            }
          }
        }
      };

      if (metadataTasks.length) {
        await Promise.all(Array.from({ length: Math.min(concurrency, metadataTasks.length) }, () => runWorker()));
      }

      if (abortedByUser) {
        await flushSongMetadataUpdates();
        await saveMetadataAttempts(attemptsCache);
        set({
          metadataFetch: {
            running: false,
            total: metadataTasks.length,
            done,
            artists: artistCount,
            lyrics: lyricCount,
            genres: genreCount,
            pending: true,
            message: 'Paused for playback, Game Mode, or user setting. Current song metadata still updates.',
          },
        });
        return;
      }

      const completedAll = done >= metadataTasks.length;
      await flushSongMetadataUpdates();
      await saveMetadataAttempts(attemptsCache);
      if (completedAll) {
        set({
          metadataFetch: {
            running: false,
            total: metadataTasks.length,
            done,
            artists: artistCount,
            lyrics: lyricCount,
            genres: genreCount,
            pending: false,
            message: 'Bulk fetch completed.',
          },
        });
        return;
      }

      set({
        metadataFetch: {
          running: false,
          total: metadataTasks.length,
          done,
          artists: artistCount,
          lyrics: lyricCount,
          genres: genreCount,
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
    if (isMetadataActivityPaused()) {
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
    const allowWhenPaused = options?.allowWhenPaused === true;
    if (get().metadataFetch.running && !allowWhenPaused) {
      return;
    }
    const settings = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
    const metadataPaused = settings.metadataFetchPaused ?? false;
    if ((settings.gameMode || metadataPaused) && !allowWhenPaused) {
      return;
    }
    const forceRetry = options?.forceRetry === true;
    const ignoreCooldown = options?.ignoreCooldown === true;
    const basicOnly = options?.basicOnly === true;
    const includeLyrics = options?.includeLyrics === true;
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
    const primaryArtist = getMetadataArtistName(song.artist, song.title);
    const artistKey = normalizeArtistLookupText(primaryArtist);
    const isOnline = typeof navigator === 'undefined' || navigator.onLine !== false;
    const cacheIndex = await loadMetadataCacheIndex();
    const genreCached = Boolean(song.genre?.trim() && song.genre.trim().toLowerCase() !== 'unknown genre');
    const artworkCached = Boolean(song.albumArt?.trim());
    const repairedTitle = getDisplayTitleRepair(song.artist, song.title);
    const titleNeedsRepair = Boolean(repairedTitle && repairedTitle !== song.title);
    const artistCached = artistKey ? await hasCachedArtistProfile(primaryArtist) : true;
    if (artistKey && artistCached) {
      void markArtistCached(artistKey);
    }
    const skipArtist = forceRetry ? false : shouldSkipMetadata(attemptsCache, 'artist', artistKey ?? '');
    const lyricsCached = includeLyrics ? isSongCached(cacheIndex, song.id, 'lyrics') : true;
    const skipLyrics = includeLyrics ? (forceRetry ? false : shouldSkipMetadata(attemptsCache, 'lyrics', song.id)) : true;
    const skipGenre = forceRetry ? false : shouldSkipMetadata(attemptsCache, 'genre', song.id);

    const tasks: Array<Promise<void>> = [];
    recordPerfEvent('metadata.current-song.audit', {
      songId,
      allowWhenPaused,
      includeLyrics,
      genreCached,
      artworkCached,
      titleNeedsRepair,
      artistCached,
      lyricsCached,
      skipArtist,
      skipGenre,
      skipLyrics,
    });

    if (repairedTitle && repairedTitle !== song.title) {
      tasks.push((async () => {
        await updateSongActivityPatch(song.id, (current) => ({
          ...current,
          title: repairedTitle,
        }));
        set((state) => ({ activityVersion: state.activityVersion + 1 }));
        recordPerfEvent('metadata.current-song.title-repair', { songId, title: repairedTitle });
      })());
    }

    if (!artworkCached) {
      tasks.push((async () => {
        const embeddedArtwork = await loadEmbeddedArtworkForSong(song);
        const trackArtwork = embeddedArtwork ?? await loadTrackArtworkForSong({
          ...song,
          title: repairedTitle ?? song.title,
        });
        if (!trackArtwork) {
          return;
        }

        await updateSongActivityPatch(song.id, (current) => ({
          ...current,
          albumArt: trackArtwork,
        }));
        set((state) => ({ activityVersion: state.activityVersion + 1, artworkVersion: state.artworkVersion + 1 }));
        recordPerfEvent('metadata.current-song.artwork-repair', { songId, source: embeddedArtwork ? 'embedded' : 'track' });
      })());
    }

    if (!basicOnly && artistKey && !artistCached && !skipArtist) {
      if (tryAcquireMetadata('artist', artistKey)) {
        tasks.push((async () => {
          try {
            const artistResult = await loadArtistProfile(primaryArtist, { waitForIdle: !allowWhenPaused });
            if (artistResult.status === 'ready') {
              noteMetadataSuccess(attemptsCache, 'artist', artistKey);
            } else if (artistResult.status === 'missing' && isOnline) {
              noteMetadataFailure(attemptsCache, 'artist', artistKey);
            }
          } finally {
            releaseMetadata('artist', artistKey);
          }
        })());
      }
    }

    if (includeLyrics && !basicOnly && !lyricsCached && !skipLyrics) {
      if (tryAcquireMetadata('lyrics', song.id)) {
        tasks.push((async () => {
          try {
            const lyricResult = await loadLyrics(song);
            if (lyricResult.status === 'ready') {
              noteMetadataSuccess(attemptsCache, 'lyrics', song.id);
              void markSongCached(song.id, 'lyrics');
            } else if (isOnline) {
              noteMetadataFailure(attemptsCache, 'lyrics', song.id);
            }
          } finally {
            releaseMetadata('lyrics', song.id);
          }
        })());
      }
    }

    const sameArtistGenre = genreCached ? null : findSameArtistGenre(song, get().songs);
    if (sameArtistGenre) {
      tasks.push((async () => {
        noteMetadataSuccess(attemptsCache, 'genre', song.id);
        void markSongCached(song.id, 'genre');
        await get().updateSongGenre(song.id, sameArtistGenre);
        recordPerfEvent('metadata.current-song.same-artist-genre', { songId, genre: sameArtistGenre });
      })());
    }

    if (!genreCached && !skipGenre && !sameArtistGenre) {
      if (tryAcquireMetadata('genre', song.id)) {
        tasks.push((async () => {
          try {
            const genreResult = await loadSongGenre({
              ...song,
              title: repairedTitle ?? song.title,
            });
            if (genreResult.status === 'ready') {
              noteMetadataSuccess(attemptsCache, 'genre', song.id);
              void markSongCached(song.id, 'genre');
              if (genreResult.genre && genreResult.genre.toLowerCase() !== 'unknown genre') {
                await get().updateSongGenre(song.id, genreResult.genre);
              }
            } else if (genreResult.status === 'missing' && isOnline) {
              noteMetadataFailure(attemptsCache, 'genre', song.id);
            }
          } finally {
            releaseMetadata('genre', song.id);
          }
        })());
      }
    }

    await Promise.all(tasks);
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
    if (typeof window !== 'undefined') {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    }
    try {
      const generated = await refreshSmartPlaylists(get().songs, get().smartPlaylistOverrides, {
        force: true,
        seedOverride: seed,
      });
      const customPlaylists = get().customPlaylists;
      set({
        smartPlaylists: generated,
        playlists: buildPlaylists(generated, customPlaylists),
        smartPlaylistSeed: seed,
        playlistVersion: get().playlistVersion + 1,
      });
    } finally {
      set({ regeneratingSmartPlaylists: false });
    }
  },

  initialize: async () => {
    if (get().initialized) {
      return;
    }
    markPerf('library.initialize');
    await measurePerfAsync('library.initialize.total', async () => {
      await ensureStorageDirs();

      const [
        settings,
        cache,
        customPlaylists,
        smartOverrides,
        cachedSmartPlaylists,
        cachedLitePlaylists,
        songActivity,
      ] = await Promise.all([
        readStorageJson<Partial<AppSettings> & { libraryPath?: string; libraryPaths?: string[] }>('settings.json', {}),
        readStorageJson<LibraryPersisted>(libraryCachePath, { songs: [] }),
        readStorageJson<Playlist[]>(customPlaylistsPath, []),
        readStorageJson<Record<string, string[]>>(smartOverridesPath, {}),
        readStorageJson<SmartCache | null>(smartCachePath, null),
        readStorageJson<LiteSmartCache | null>(smartLiteCachePath, null),
        loadSongActivityCache(),
      ]);
      const hydratedSongs = applySongActivity(cache.songs, songActivity);
      const libraryPaths = normalizeLibraryPaths([
        ...(settings.libraryPaths ?? []),
        ...(settings.libraryPath ? [settings.libraryPath] : []),
      ]);
      const currentWeekKey = getIsoWeekKey();
      let initialSmartPlaylists: Playlist[] = [];
      const hasFreshSmartCache = Boolean(
        cachedSmartPlaylists?.weekKey === currentWeekKey && cachedSmartPlaylists?.playlists?.length,
      );
      const hasLiteCache = Boolean(cachedLitePlaylists?.playlists?.length);
      if (hasFreshSmartCache && cachedSmartPlaylists) {
        smartCacheWeek = cachedSmartPlaylists.weekKey;
        initialSmartPlaylists = applySmartOverrides(cachedSmartPlaylists.playlists, smartOverrides, hydratedSongs);
      } else if (hasLiteCache && cachedLitePlaylists) {
        smartCacheWeek = cachedSmartPlaylists?.weekKey ?? null;
        initialSmartPlaylists = applySmartOverrides(cachedLitePlaylists.playlists, smartOverrides, hydratedSongs);
      } else {
        smartCacheWeek = cachedSmartPlaylists?.weekKey ?? null;
        initialSmartPlaylists = [];
      }
      const initialSeed = seedFromWeekKey(currentWeekKey);

      recordSongArrayReplacement('library-initialize', { songs: hydratedSongs.length });
      set({
        initialized: true,
        songs: hydratedSongs,
        customPlaylists,
        smartPlaylists: initialSmartPlaylists,
        playlists: buildPlaylists(initialSmartPlaylists, customPlaylists),
        libraryPaths,
        smartPlaylistOverrides: smartOverrides,
        smartPlaylistSeed: initialSeed,
        libraryVersion: get().libraryVersion + 1,
        playlistVersion: get().playlistVersion + 1,
        artworkVersion: get().artworkVersion + 1,
        metadataFetch: {
          ...get().metadataFetch,
          pending: hydratedSongs.length > 0,
        },
        albumTrackFetch: {
          ...get().albumTrackFetch,
          pending: hydratedSongs.length > 0,
        },
      });

      recordPerfEvent('library.initialize.ready', {
        songs: hydratedSongs.length,
        playlists: initialSmartPlaylists.length,
      });
      ensureOnlineRecommendationHooks();
      enableOnlineRecommendations(settings);
      scheduleMetadataResume(8_000);
      void scheduleOnlineRecommendationEnrichmentForSongs(hydratedSongs, 'background');

      if ((!initialSmartPlaylists.length || (!hasFreshSmartCache && hasLiteCache)) && hydratedSongs.length) {
        scheduleBackgroundTask(() => {
          void (async () => {
            const generated = await measurePerfAsync('library.smart-playlists.initial-refresh', () =>
              refreshSmartPlaylists(hydratedSongs, smartOverrides),
            );
            const state = useLibraryStore.getState();
            if (!state.initialized) {
              return;
            }
            useLibraryStore.setState({
              smartPlaylists: generated,
              playlists: buildPlaylists(generated, state.customPlaylists),
              smartPlaylistSeed: seedFromWeekKey(getIsoWeekKey()),
              playlistVersion: state.playlistVersion + 1,
            });
          })();
        }, 1400);
      }

      scheduleInitialScan(libraryPaths);
      scheduleBackgroundTask(() => {
        void (async () => {
          const [playlistUsage, storedProfile, storedTaste, storedActivity] = await Promise.all([
            readStorageJson<Record<string, PlaylistUsageEntry>>(playlistUsagePath, {}),
            readStorageJson<ListeningProfile | null>(listeningProfilePath, null),
            readStorageJson<TasteProfile | null>(tasteProfilePath, null),
            readStorageJson<ListeningActivity | null>(listeningActivityPath, null),
          ]);
          const current = useLibraryStore.getState();
          if (!current.initialized) {
            return;
          }
          useLibraryStore.setState({
            playlistUsage,
            listeningProfile: normalizeProfile(storedProfile),
            listeningActivity: normalizeActivity(storedActivity),
            tasteProfile: storedTaste,
          });
        })();
      }, 3000);
    });
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
    markPerf('library.scan');
    recordPerfEvent('library.scan.start', { paths: targetPaths.length, runId });

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

      const scannedByFolder = await measurePerfAsync('library.scan.native-folders', () =>
        Promise.all(targetPaths.map((path) => scanMusicFolder(path))),
      );
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
          genre: previous?.genre?.trim() && !isUnknownGenre(previous.genre) ? previous.genre : song.genre,
          albumArt: previous?.albumArt ?? song.albumArt,
          skipCount: previous?.skipCount ?? song.skipCount,
          lastSkipped: previous?.lastSkipped ?? song.lastSkipped,
          totalPlaySeconds: previous?.totalPlaySeconds ?? song.totalPlaySeconds,
          lastPlayDurationSec: previous?.lastPlayDurationSec ?? song.lastPlayDurationSec,
          lastPlayStarted: previous?.lastPlayStarted ?? song.lastPlayStarted,
          lastCompleted: previous?.lastCompleted ?? song.lastCompleted,
        });
        if (index % 200 === 0) {
          await yieldToMain();
        }
      }
      await yieldToMain();
      const hydratedSongs = await measurePerfAsync('library.scan.hydrate-genres', () =>
        hydrateSongsWithCachedGenres(mergedSongs),
      );
      await yieldToMain();
      const artHydrated = await measurePerfAsync('library.scan.hydrate-artwork', () =>
        hydrateSongsWithCachedAlbumArt(hydratedSongs),
      );
      await yieldToMain();

      const customPlaylists = get().customPlaylists;
      const weeklySeed = seedFromWeekKey(getIsoWeekKey());
      const playlists = buildPlaylists(get().smartPlaylists, customPlaylists);

      if (runId !== scanRunId) {
        return;
      }

      recordSongArrayReplacement('library-scan', { songs: artHydrated.length });
      set({
        songs: artHydrated,
        playlists,
        isScanning: false,
        smartPlaylistSeed: weeklySeed,
        libraryVersion: get().libraryVersion + 1,
        artworkVersion: get().artworkVersion + 1,
        metadataFetch: {
          ...get().metadataFetch,
          pending: true,
        },
        albumTrackFetch: {
          ...get().albumTrackFetch,
          pending: true,
        },
      });
      endPerfMeasure('library.scan', {
        songs: artHydrated.length,
        runId,
      });
      recordPerfEvent('library.scan.ready', { songs: artHydrated.length, runId });
      await persistLibrary(artHydrated, customPlaylists);
      scheduleMetadataResume(6_000);
      void scheduleOnlineRecommendationEnrichmentForSongs(artHydrated, 'background');

      if (runId !== scanRunId) {
        return;
      }

      scheduleBackgroundTask(() => {
        if (runId !== scanRunId) {
          return;
        }
        void (async () => {
          const generated = await measurePerfAsync('library.smart-playlists.scan-refresh', () =>
            refreshSmartPlaylists(artHydrated, get().smartPlaylistOverrides, {
              force: true,
              seedOverride: weeklySeed,
            }),
          );
          if (runId !== scanRunId) {
            return;
          }
          const updatedCustom = get().customPlaylists;
          set({
            smartPlaylists: generated,
            playlists: buildPlaylists(generated, updatedCustom),
            smartPlaylistSeed: weeklySeed,
            playlistVersion: get().playlistVersion + 1,
          });
        })();
      }, 1000);
    } catch (error) {
      set({
        isScanning: false,
        scanError: error instanceof Error ? error.message : 'Library scan failed.',
      });
      recordPerfEvent('library.scan.error', {
        runId,
        message: error instanceof Error ? error.message : 'Library scan failed.',
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

  getSongById: (songId) => {
    const song = getSongByIdCached(get().songs, songId);
    return song ? mergeSongActivity(song, songActivityCache?.[songId]) : undefined;
  },

  getSongsById: () => {
    const base = getSongsByIdCached(get().songs);
    if (!songActivityCache || !Object.keys(songActivityCache).length) {
      return base;
    }
    const songs = get().songs;
    if (
      cachedMergedSongsById &&
      cachedMergedSongsByIdRef === songs &&
      cachedMergedSongsByIdRevision === songActivityRevision
    ) {
      return cachedMergedSongsById;
    }
    const merged = new Map(base);
    for (const [songId, patch] of Object.entries(songActivityCache)) {
      const song = base.get(songId);
      if (song) {
        merged.set(songId, mergeSongActivity(song, patch));
      }
    }
    cachedMergedSongsById = merged;
    cachedMergedSongsByIdRef = songs;
    cachedMergedSongsByIdRevision = songActivityRevision;
    return merged;
  },

  updateSongGenre: async (songId, genre) => {
    const normalized = genre.trim();
    if (!normalized || normalized.toLowerCase() === 'unknown genre') {
      return;
    }

    const song = get().getSongById(songId);
    if (!song || song.genre.trim().toLowerCase() === normalized.toLowerCase()) {
      return;
    }

    await updateSongActivityPatch(songId, (current) => ({
      ...current,
      genre: normalized,
    }));
    set((state) => ({ activityVersion: state.activityVersion + 1 }));
    const songsById = get().getSongsById();
    const mergedSongs = get().songs.map((entry) => songsById.get(entry.id) ?? entry);
    scheduleSmartPlaylistRefresh(mergedSongs, 8000, { includeHeavy: false });
    void scheduleOnlineRecommendationEnrichmentForSongs([song], 'idle');
  },

  toggleFavorite: async (songId) => {
    const song = get().getSongById(songId);
    if (!song) {
      return;
    }

    const nextFavorite = !song.favorite;
    await updateSongActivityPatch(songId, (current) => ({
      ...current,
      favorite: nextFavorite,
    }));
    set((state) => ({ activityVersion: state.activityVersion + 1 }));
    const songsById = get().getSongsById();
    const mergedSongs = get().songs.map((entry) => songsById.get(entry.id) ?? entry);
    scheduleSmartPlaylistRefresh(mergedSongs, 8000, { includeHeavy: false });
    void scheduleOnlineRecommendationEnrichmentForSongs([song], 'idle');
  },

  addSongToCustomPlaylist: async (playlistId, songId) => {
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
    set({
      customPlaylists: updated,
      playlists: buildPlaylists(get().smartPlaylists, updated),
      playlistVersion: get().playlistVersion + 1,
    });
    await persistCustomPlaylists(updated);
  },

  deleteSongFromDisk: async (songId) => {
    const state = get();
    const song = state.getSongById(songId);
    if (!song) {
      return false;
    }

    const deleted = await deleteSongFile(song.path);
    if (!deleted) {
      return false;
    }

    const nextSongs = state.songs.filter((entry) => entry.id !== songId);
    const nextCustomPlaylists = removeSongIdFromPlaylists(state.customPlaylists, songId);
    const nextSmartOverrides = removeSongIdFromOverrides(state.smartPlaylistOverrides, songId);
    const nextSmartPlaylists = removeSongIdFromPlaylists(state.smartPlaylists, songId);

    recordSongArrayReplacement('delete-song', { songs: nextSongs.length });
    set({
      songs: nextSongs,
      customPlaylists: nextCustomPlaylists,
      smartPlaylistOverrides: nextSmartOverrides,
      smartPlaylists: nextSmartPlaylists,
      playlists: buildPlaylists(nextSmartPlaylists, nextCustomPlaylists),
      libraryVersion: state.libraryVersion + 1,
      playlistVersion: state.playlistVersion + 1,
      activityVersion: state.activityVersion + 1,
      metadataFetch: {
        ...state.metadataFetch,
        pending: nextSongs.length > 0,
      },
      albumTrackFetch: {
        ...state.albumTrackFetch,
        pending: nextSongs.length > 0,
      },
    });

    await persistLibrary(nextSongs, nextCustomPlaylists);
    await writeStorageJson(smartOverridesPath, nextSmartOverrides);
    if (songActivityCache?.[songId]) {
      delete songActivityCache[songId];
      songActivityRevision += 1;
      await writeStorageJsonDebounced(songActivityPath, songActivityCache, 1500);
    }
    scheduleSmartPlaylistRefresh(nextSongs, 600, { includeHeavy: true });
    return true;
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

    const updatedSmart = applySmartOverrides(state.smartPlaylists, overrides, state.songs);
    const customPlaylists = state.customPlaylists;
    set({
      smartPlaylistOverrides: overrides,
      smartPlaylists: updatedSmart,
      playlists: buildPlaylists(updatedSmart, customPlaylists),
      playlistVersion: state.playlistVersion + 1,
    });
    await writeStorageJson(smartOverridesPath, overrides);
    return 'added';
  },

  recordSongPlay: async (songId) => {
    const now = Math.floor(Date.now() / 1000);
    const songSnapshot = get().getSongById(songId);
    if (!songSnapshot) {
      return;
    }
    const nextHour = new Date(now * 1000).getHours();
    const nextWeekday = new Date(now * 1000).getDay();
    const profile = get().listeningProfile;
    const artistKey = getPrimaryArtistName(songSnapshot.artist).trim().toLowerCase();
    const genreKey = songSnapshot?.genre?.trim().toLowerCase() ?? '';
    const nextProfile: ListeningProfile = {
      ...profile,
      hourly: profile.hourly.map((value, index) => (index === nextHour ? value + 1 : value)),
      weekday: profile.weekday.map((value, index) => (index === nextWeekday ? value + 1 : value)),
      recentArtists: artistKey ? noteRecentMap(profile.recentArtists, artistKey, now) : profile.recentArtists,
      recentGenres: genreKey ? noteRecentMap(profile.recentGenres, genreKey, now) : profile.recentGenres,
      updatedAt: now,
    };
    await updateSongActivityPatch(songId, (current) => ({
      ...current,
      playCount: (current.playCount ?? songSnapshot.playCount ?? 0) + 1,
      lastPlayed: now,
      lastPlayStarted: now,
      skipCount: current.skipCount ?? songSnapshot.skipCount ?? 0,
      totalPlaySeconds: current.totalPlaySeconds ?? songSnapshot.totalPlaySeconds ?? 0,
    }));

    recordPerfEvent('library.song-activity.playback-patch', { songId, kind: 'play' });
    set({ listeningProfile: nextProfile });
    scheduleListeningProfileRefresh(get().songs);
    void scheduleOnlineRecommendationEnrichmentForSongs([songSnapshot], 'idle');
    await writeStorageJsonDebounced(listeningProfilePath, nextProfile, 1500);
  },

  recordPlaybackEvent: async (songId, event) => {
    const now = Math.floor(Date.now() / 1000);
    const listened = Math.max(0, Math.floor(event.listenedSec));
    const songSnapshot = get().getSongById(songId);
    if (!songSnapshot) {
      return;
    }
    await updateSongActivityPatch(songId, (current) => {
      const duration = event.durationSec ?? songSnapshot.duration;
      const playSeconds = (current.totalPlaySeconds ?? songSnapshot.totalPlaySeconds ?? 0) + listened;
      const skipCount = current.skipCount ?? songSnapshot.skipCount ?? 0;
      const skipThreshold = duration > 0 ? Math.min(45, duration * 0.35) : 20;
      const wasManualSkip = Boolean(event.manualSkip);
      const shouldSkip = wasManualSkip && listened > 0 && listened < skipThreshold;
      const completed = event.completed ?? (duration > 0 ? listened >= duration * 0.92 : false);
      return {
        ...current,
        totalPlaySeconds: playSeconds,
        lastPlayDurationSec: listened || current.lastPlayDurationSec || songSnapshot.lastPlayDurationSec,
        lastSkipped: shouldSkip ? now : current.lastSkipped ?? songSnapshot.lastSkipped,
        skipCount: shouldSkip ? skipCount + 1 : skipCount,
        lastCompleted: completed ? now : current.lastCompleted ?? songSnapshot.lastCompleted,
      };
    });
    recordPerfEvent('library.song-activity.playback-patch', { songId, kind: 'playback-event' });
  },

  recordQueueAdd: async (songId) => {
    const now = Math.floor(Date.now() / 1000);
    const songSnapshot = get().getSongById(songId);
    if (!songSnapshot) {
      return;
    }
    await updateSongActivityPatch(songId, (current) => ({
      ...current,
      manualQueueAdds: (current.manualQueueAdds ?? songSnapshot.manualQueueAdds ?? 0) + 1,
      lastManualQueueAdd: now,
    }));
    recordPerfEvent('library.song-activity.playback-patch', { songId, kind: 'queue-add' });
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
    set((state) => ({ playlistUsage: usage, playlistVersion: state.playlistVersion + 1 }));
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

    set({
      customPlaylists: updated,
      playlists: buildPlaylists(get().smartPlaylists, updated),
      playlistVersion: get().playlistVersion + 1,
    });
    await persistCustomPlaylists(updated);
  },

  deleteCustomPlaylist: async (playlistId) => {
    const existing = get().customPlaylists;
    const updated = existing.filter((entry) => entry.id !== playlistId);
    if (updated.length === existing.length) {
      return false;
    }

    const usage = { ...get().playlistUsage };
    delete usage[playlistId];
    set((state) => ({
      customPlaylists: updated,
      playlists: buildPlaylists(state.smartPlaylists, updated),
      playlistUsage: usage,
      playlistVersion: state.playlistVersion + 1,
    }));
    await Promise.all([
      persistCustomPlaylists(updated),
      writeStorageJson(playlistUsagePath, usage),
    ]);
    return true;
  },
}));

export const libraryActions = {
  scanLibrary: (paths?: string[]): Promise<void> => useLibraryStore.getState().scanLibrary(paths),
  deleteSong: (songId: string): Promise<boolean> => useLibraryStore.getState().deleteSongFromDisk(songId),
  toggleFavorite: (songId: string): Promise<void> => useLibraryStore.getState().toggleFavorite(songId),
  updateGenre: (songId: string, genre: string): Promise<void> =>
    useLibraryStore.getState().updateSongGenre(songId, genre),
  addSongToCustomPlaylist: (playlistId: string, songId: string): Promise<void> =>
    useLibraryStore.getState().addSongToCustomPlaylist(playlistId, songId),
  upsertCustomPlaylist: (playlist: Playlist): Promise<void> =>
    useLibraryStore.getState().upsertCustomPlaylist(playlist),
  deleteCustomPlaylist: (playlistId: string): Promise<boolean> =>
    useLibraryStore.getState().deleteCustomPlaylist(playlistId),
  patchSongActivity: async (songId: string, patch: SongActivityPatch): Promise<void> => {
    if (!useLibraryStore.getState().getSongById(songId)) {
      return;
    }
    await updateSongActivityPatch(songId, (current) => ({
      ...current,
      ...patch,
    }));
    useLibraryStore.setState((state) => ({ activityVersion: state.activityVersion + 1 }));
  },
};
