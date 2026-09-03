import { DEFAULT_SETTINGS, normalizeSettings } from '@/store/defaultSettings';
import { getFlag, setFlags } from '@/services/runtimeFlags';
import { pickRandom, shuffle } from '@/utils/random';
import { create } from 'zustand';
import type { AppSettings, NowPlayingTab, OnlineRecommendationProvider, RepeatMode } from '@/types/music';
import { audioEngine } from '@/services/audioEngine';
import { useLibraryStore } from '@/store/libraryStore';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { listOutputDevices } from '@/services/audioDeviceService';
import { isTauri, readStorageJson, writeStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { notifySongChange } from '@/services/metadataPriority';
import {
  isSchedulerBackgroundHidden,
} from '@/services/appScheduler';
import { recordPerfEvent, recordPlaybackLatency } from '@/services/perfDiagnostics';
import { setPlaybackProgress } from '@/store/playbackProgressStore';
import {
  cancelGroup,
  pauseBackground,
  resumeBackground,
  scheduleInteraction,
  schedulePlaybackCritical,
} from '@/services/playbackScheduler';
import {
  enableOnlineRecommendations,
  pickOnlineRecommendationSeedIds,
  scheduleOnlineEnrichment,
} from '@/services/onlineRecommendationService';

const setGlobalPlayingFlag = (playing: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }
  setFlags({ isPlaying: playing });
};

const setGlobalPlaybackHints = (currentSongId: string | null, upcoming: string[]): void => {
  if (typeof window === 'undefined') {
    return;
  }
  setFlags({ currentSongId: currentSongId ?? null });
  setFlags({ upNext: upcoming });
};

let lastManualSkipAt = 0;
let pendingSongMetadataCancel: (() => void) | null = null;
let rapidSkipResumeHandle: number | null = null;
let stableSongMetadataHandle: number | null = null;
const isFastSkip = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return Date.now() - lastManualSkipAt < 300;
};

const getPreloadCount = (): number => {
  if (typeof window === 'undefined') {
    return 1;
  }
    if (getFlag('gameMode') === true) {
    return 1;
  }
  return getFlag('lowPerf') === true ? 1 : 2;
};

const enterRapidPlaybackLane = (reason: string): void => {
  cancelGroup('playback-metadata');
  cancelGroup('online-recommendations');
  pendingSongMetadataCancel?.();
  pendingSongMetadataCancel = null;
  if (stableSongMetadataHandle !== null && typeof window !== 'undefined') {
    window.clearTimeout(stableSongMetadataHandle);
    stableSongMetadataHandle = null;
  }
  pauseBackground(reason);
  if (typeof window === 'undefined') {
    return;
  }
  if (rapidSkipResumeHandle !== null) {
    window.clearTimeout(rapidSkipResumeHandle);
  }
  rapidSkipResumeHandle = window.setTimeout(() => {
    rapidSkipResumeHandle = null;
    resumeBackground(reason);
  }, 1800);
};

const scheduleStableCurrentSongMetadata = (songId: string): void => {
  pendingSongMetadataCancel?.();
  pendingSongMetadataCancel = null;
  if (typeof window === 'undefined') {
    void useLibraryStore.getState().fetchMissingMetadataForSong(songId, {
      allowWhenPaused: true,
      includeLyrics: false,
      forceRetry: true,
      ignoreCooldown: true,
    });
    return;
  }
  if (stableSongMetadataHandle !== null) {
    window.clearTimeout(stableSongMetadataHandle);
  }
  stableSongMetadataHandle = window.setTimeout(() => {
    stableSongMetadataHandle = null;
    const currentId = usePlayerStore.getState().currentSongId;
    if (currentId !== songId || isFastSkip()) {
      return;
    }
    pendingSongMetadataCancel = scheduleInteraction(
      async () => {
        await useLibraryStore.getState().fetchMissingMetadataForSong(songId, {
          allowWhenPaused: true,
          includeLyrics: false,
          forceRetry: true,
          ignoreCooldown: true,
        });
      },
      { reason: 'current-song-metadata', groupKey: 'playback-metadata' },
    );
  }, 2200);
};

interface PlayerState {
  initialized: boolean;
  currentSongId: string | null;
  queueSongIds: string[];
  queueCursor: number;
  manualQueueSongIds: string[];
  historySongIds: string[];
  isPlaying: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  repeatMode: RepeatMode;
  shuffleEnabled: boolean;
  nowPlayingTab: NowPlayingTab;
  albumQueueView: {
    album: string;
    artist: string;
    items: Array<{ id?: string; title: string; position: number; available: boolean }>;
  } | null;
  settings: AppSettings;
  sleepTimerEndsAt: number | null;
  sleepTimerDurationMin: number | null;
  autoPausedByFocus: boolean;
  toastMessage: string | null;
  lastQueuePlaylistId: string | null;
  initialize: () => Promise<void>;
  showToast: (message: string) => void;
  setQueue: (songIds: string[], startSongId?: string, options?: { playlistId?: string | null }) => void;
  setAlbumQueueView: (view: PlayerState['albumQueueView']) => void;
  playSongById: (songId: string, transition?: boolean) => Promise<void>;
  togglePlayPause: () => void;
  pausePlayback: () => void;
  resumePlayback: () => void;
  playNext: (manual?: boolean) => Promise<void>;
  playPrevious: () => Promise<void>;
  seekTo: (positionSec: number) => void;
  setVolume: (volume: number) => void;
  setShuffleEnabled: (enabled: boolean) => void;
  toggleLoopSong: () => void;
  setNowPlayingTab: (tab: NowPlayingTab) => void;
  setPlaybackSpeed: (speed: number) => Promise<void>;
  setOutputDeviceName: (deviceName: string | null) => Promise<void>;
  setEqPreset: (preset: AppSettings['eqPreset']) => Promise<void>;
  setEqBands: (bands: number[]) => Promise<void>;
  setCrossfadeEnabled: (enabled: boolean) => Promise<void>;
  setCrossfadeDuration: (durationSec: number) => Promise<void>;
  setGaplessEnabled: (enabled: boolean) => Promise<void>;
  setAppTheme: (theme: AppSettings['appTheme']) => Promise<void>;
  setLaunchOnStartup: (enabled: boolean) => Promise<void>;
  setGameMode: (enabled: boolean) => Promise<void>;
  setMiniNowPlayingOverlay: (enabled: boolean) => Promise<void>;
  setOverlaySpinningArtwork: (enabled: boolean) => Promise<void>;
  setOverlayAutoHide: (enabled: boolean) => Promise<void>;
  setLyricsVisualsEnabled: (enabled: boolean) => Promise<void>;
  setLyricsVisualTheme: (theme: AppSettings['lyricsVisualTheme']) => Promise<void>;
  setMetadataFetchPaused: (paused: boolean) => Promise<void>;
  setDiscoveryIntensity: (value: number) => Promise<void>;
  setRandomnessIntensity: (value: number) => Promise<void>;
  setPauseMixRegenDuringPlayback: (enabled: boolean) => Promise<void>;
  setOnlineRecommendationsEnabled: (enabled: boolean) => Promise<void>;
  setLastFmApiKey: (apiKey: string) => Promise<void>;
  setOnlineRecommendationProviderOrder: (providers: OnlineRecommendationProvider[]) => Promise<void>;
  setAutoPauseOnFocus: (enabled: boolean) => Promise<void>;
  setAutoPauseIgnoreApps: (apps: string[]) => Promise<void>;
  setAutoPauseIgnoreFullscreen: (enabled: boolean) => Promise<void>;
  setSleepTimer: (minutes: number | null) => void;
  deleteCurrentSong: () => Promise<boolean>;
  enqueueSong: (songId: string) => void;
  removeQueuedSong: (songId: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  reshuffleQueue: () => void;
}

const defaultSettings = DEFAULT_SETTINGS;

type PersistedPlaybackState = {
  songId: string | null;
  positionSec: number;
  queueSongIds: string[];
  queueCursor: number;
  playlistId: string | null;
  updatedAt: number;
};

const playbackStatePath = 'playback/last_state.json';
const PLAYBACK_PERSIST_DEBOUNCE_MS = 1500;
const PLAYBACK_PERSIST_THROTTLE_MS = 5000;
let lastPlaybackPersistAt = 0;

const persistPlaybackState = (state: PlayerState, overrides: Partial<PersistedPlaybackState> = {}): void => {
  const payload: PersistedPlaybackState = {
    songId: state.currentSongId,
    positionSec: state.positionSec,
    queueSongIds: state.queueSongIds,
    queueCursor: state.queueCursor,
    playlistId: state.lastQueuePlaylistId ?? null,
    updatedAt: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  void writeStorageJsonDebounced(playbackStatePath, payload, PLAYBACK_PERSIST_DEBOUNCE_MS);
};

const eqPresetBands: Record<AppSettings['eqPreset'], number[]> = {
  flat: [0, 0, 0, 0, 0],
  warm: [2.5, 1.5, 0, -1, -2],
  bass: [6, 3, -1, -2, -2],
  treble: [0, 0, 0, 3, 6],
  vocal: [-1, 0, 2, 3, 1],
  club: [4.5, 2, 0, 1.5, 3],
  custom: [0, 0, 0, 0, 0],
};

const normalizeEqBands = (bands: number[] | undefined, fallbackPreset: AppSettings['eqPreset']): number[] => {
  const template = [...(eqPresetBands[fallbackPreset] ?? eqPresetBands.flat)];
  if (!Array.isArray(bands)) {
    return template;
  }

  const normalized = bands
    .slice(0, 5)
    .map((gain) => (Number.isFinite(gain) ? Math.max(-12, Math.min(12, gain)) : 0));

  while (normalized.length < 5) {
    normalized.push(template[normalized.length] ?? 0);
  }

  return normalized;
};

const normalizeIgnoreApps = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter(Boolean);
};

const normalizeAudioAppName = (value: string): string => value.trim().toLowerCase();

const appNameWithoutExe = (value: string): string => value.replace(/\.exe$/i, '');

const isAudioAppIgnored = (appName: string, ignoredApps: string[]): boolean => {
  const normalized = normalizeAudioAppName(appName);
  const base = appNameWithoutExe(normalized);
  return ignoredApps.some((entry) => {
    const ignored = normalizeAudioAppName(entry);
    if (!ignored) {
      return false;
    }
    const ignoredBase = appNameWithoutExe(ignored);
    return normalized === ignored || base === ignoredBase;
  });
};

const normalizeProviderOrder = (value: unknown): OnlineRecommendationProvider[] => {
  if (!Array.isArray(value)) {
    return defaultSettings.onlineRecommendationProviderOrder;
  }
  const allowed = new Set<OnlineRecommendationProvider>(['lastfm', 'musicbrainz']);
  const normalized = value.filter((entry): entry is OnlineRecommendationProvider => allowed.has(entry));
  return normalized.length ? [...new Set(normalized)] : defaultSettings.onlineRecommendationProviderOrder;
};

let sleepTimerHandle: number | null = null;
let progressFlushHandle: number | null = null;
let lastProgressUpdate = 0;
let pendingProgress: { position: number; duration: number } | null = null;
const PROGRESS_UPDATE_MS = 250;
let lastPreloadSongId: string | null = null;
const preloadOnceCache = new Map<string, number>();
const PRELOAD_CACHE_LIMIT = 200;
let defaultOutputPollHandle: number | null = null;
let lastDefaultOutputName: string | null = null;
let audioFocusUnlisten: UnlistenFn | null = null;
let audioFocusResumeTimer: number | null = null;
let audioFocusResumeToken = 0;
let toastTimer: number | null = null;
let playerInitStarted = false;

const cancelAudioFocusResume = (): void => {
  audioFocusResumeToken += 1;
  if (audioFocusResumeTimer && typeof window !== 'undefined') {
    window.clearTimeout(audioFocusResumeTimer);
    audioFocusResumeTimer = null;
  }
};

const clearSleepTimerHandle = (): void => {
  if (sleepTimerHandle !== null) {
    window.clearTimeout(sleepTimerHandle);
    sleepTimerHandle = null;
  }
};

const startDefaultOutputWatcher = (): void => {
  if (typeof window === 'undefined' || !isTauri()) {
    return;
  }
  if (defaultOutputPollHandle !== null) {
    return;
  }

  const poll = async () => {
    try {
      const state = usePlayerStore.getState();
      if (state.settings.outputDeviceName) {
        return;
      }
      if (isSchedulerBackgroundHidden()) {
        return;
      }
      const devices = await listOutputDevices();
      const currentDefault = devices.find((device) => device.isDefault)?.name ?? null;
      if (currentDefault && currentDefault !== lastDefaultOutputName) {
        lastDefaultOutputName = currentDefault;
        recordPerfEvent('player.output-device.changed', { currentDefault });
        void invoke('audio_set_output_device', { name: null });
      }
    } catch {
      // Ignore polling errors.
    }
  };

  void poll();
  defaultOutputPollHandle = window.setInterval(poll, 20_000);
};

const stopDefaultOutputWatcher = (): void => {
  if (defaultOutputPollHandle !== null) {
    window.clearInterval(defaultOutputPollHandle);
    defaultOutputPollHandle = null;
  }
};

/** Release long-lived listeners and timers. Runs on page hide and on HMR module dispose. */
export const disposePlayerRuntime = (): void => {
  stopDefaultOutputWatcher();
  clearSleepTimerHandle();
  cancelAudioFocusResume();
  if (audioFocusUnlisten) {
    audioFocusUnlisten();
    audioFocusUnlisten = null;
  }
  audioEngine.dispose();
};

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', disposePlayerRuntime, { once: true });
  import.meta.hot?.dispose(disposePlayerRuntime);
}

let settingsWriteChain: Promise<void> = Promise.resolve();

/** Serialised read-modify-write so concurrent setters cannot drop each other's changes. */
const persistSettings = (settings: AppSettings): Promise<void> => {
  const { libraryPath: _libraryPath, ...audioSettings } = settings;
  settingsWriteChain = settingsWriteChain
    .then(async () => {
      const current = await readStorageJson<Record<string, unknown>>('settings.json', {});
      await writeStorageJson('settings.json', { ...current, ...audioSettings });
    })
    .catch((error) => {
      recordPerfEvent('settings.persist-failed', { error: error instanceof Error ? error.message : String(error) });
    });
  return settingsWriteChain;
};

const readPluginLaunchOnStartup = async (): Promise<boolean | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    const autostart = await import('@tauri-apps/plugin-autostart');
    return await autostart.isEnabled();
  } catch (error) {
    recordPerfEvent('settings.launch-startup.plugin-read-failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const readLaunchOnStartupEnabled = async (fallback: boolean): Promise<boolean> => {
  if (!isTauri()) {
    return fallback;
  }
  const enabled = await readPluginLaunchOnStartup();
  return typeof enabled === 'boolean' ? enabled : fallback;
};

const setSystemLaunchOnStartup = async (enabled: boolean): Promise<boolean> => {
  if (!isTauri()) {
    return enabled;
  }
  try {
    const autostart = await import('@tauri-apps/plugin-autostart');
    if (enabled) {
      await autostart.enable();
    } else {
      await autostart.disable();
    }
    const actualEnabled = await autostart.isEnabled();
    if (actualEnabled !== enabled) {
      throw new Error(enabled ? 'Failed to enable launch on startup' : 'Failed to disable launch on startup');
    }
    return actualEnabled;
  } catch (error) {
    recordPerfEvent('settings.launch-startup.plugin-write-failed', {
      enabled,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};

const resolveNextSongId = (state: PlayerState): string | null => {
  if (state.manualQueueSongIds.length > 0) {
    return state.manualQueueSongIds[0];
  }

  if (!state.queueSongIds.length) {
    return null;
  }

  if (state.repeatMode === 'one' && state.currentSongId) {
    return state.currentSongId;
  }

  if (state.shuffleEnabled) {
    const candidates = state.queueSongIds.filter((id) => id !== state.currentSongId);
    if (!candidates.length) {
      return state.currentSongId;
    }
    return pickRandom(candidates) ?? state.currentSongId;
  }

  const nextIndex = state.queueCursor + 1;
  if (nextIndex < state.queueSongIds.length) {
    return state.queueSongIds[nextIndex];
  }

  if (state.repeatMode === 'all') {
    return state.queueSongIds[0];
  }

  return null;
};

const resolvePreviousSongId = (state: PlayerState): string | null => {
  if (state.historySongIds.length > 1) {
    return state.historySongIds[state.historySongIds.length - 2];
  }

  if (!state.queueSongIds.length) {
    return null;
  }

  const prevIndex = Math.max(0, state.queueCursor - 1);
  return state.queueSongIds[prevIndex] ?? null;
};

const buildUpcomingSongIds = (state: PlayerState, count = 3): string[] => {
  const upcoming: string[] = [];
  const seen = new Set<string>();
  const currentId = state.currentSongId;
  const enqueue = (id: string | null | undefined) => {
    if (!id || id === currentId || seen.has(id)) {
      return;
    }
    seen.add(id);
    upcoming.push(id);
  };

  for (const id of state.manualQueueSongIds) {
    enqueue(id);
    if (upcoming.length >= count) {
      return upcoming;
    }
  }

  if (state.queueSongIds.length > 0) {
    for (let i = state.queueCursor + 1; i < state.queueSongIds.length; i += 1) {
      enqueue(state.queueSongIds[i]);
      if (upcoming.length >= count) {
        return upcoming;
      }
    }

    if (state.repeatMode === 'all') {
      for (let i = 0; i <= state.queueCursor && i < state.queueSongIds.length; i += 1) {
        enqueue(state.queueSongIds[i]);
        if (upcoming.length >= count) {
          return upcoming;
        }
      }
    }
  }

  if (state.shuffleEnabled && state.queueSongIds.length > 0) {
    const candidates = state.queueSongIds.filter((id) => id !== currentId && !seen.has(id));
    const maxShuffle = Math.min(count - upcoming.length, candidates.length);
    const shuffledCandidates = shuffle(candidates);
    for (let i = 0; i < maxShuffle; i += 1) {
      enqueue(shuffledCandidates[i]);
      if (upcoming.length >= count) {
        break;
      }
    }
  }

  return upcoming;
};

const ensureCurrentSongPrepared = async (
  songId: string,
  startAtSec: number,
  autoplay: boolean,
): Promise<boolean> => {
  if (audioEngine.getCurrentSongId() === songId) {
    if (autoplay) {
      audioEngine.playFrom(startAtSec);
    }
    return true;
  }

  const song = useLibraryStore.getState().getSongById(songId);
  if (!song) {
    return false;
  }

  await audioEngine.loadSong(song, {
    autoplay,
    transition: false,
    startAtSec,
  });
  return true;
};

export const usePlayerStore = create<PlayerState>((set, get) => ({
  initialized: false,
  currentSongId: null,
  queueSongIds: [],
  queueCursor: 0,
  manualQueueSongIds: [],
  historySongIds: [],
  isPlaying: false,
  positionSec: 0,
  durationSec: 0,
  volume: 0.85,
  repeatMode: 'off',
  shuffleEnabled: false,
  nowPlayingTab: 'now-playing',
  albumQueueView: null,
  settings: defaultSettings,
  sleepTimerEndsAt: null,
  sleepTimerDurationMin: null,
  autoPausedByFocus: false,
  toastMessage: null,
  lastQueuePlaylistId: null,

  initialize: async () => {
    if (get().initialized || playerInitStarted) {
      return;
    }
    playerInitStarted = true;

    const persisted = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
    const persistedPlayback = await readStorageJson<PersistedPlaybackState | null>(playbackStatePath, null);
    let settings: AppSettings = normalizeSettings(persisted);
    settings = {
      ...settings,
      eqBands: normalizeEqBands(settings.eqBands, settings.eqPreset),
      discoveryIntensity: Math.max(0, Math.min(1, settings.discoveryIntensity ?? defaultSettings.discoveryIntensity)),
      randomnessIntensity: Math.max(0, Math.min(1, settings.randomnessIntensity ?? defaultSettings.randomnessIntensity)),
      overlaySpinningArtwork: settings.overlaySpinningArtwork !== false,
      onlineRecommendationsEnabled: Boolean(settings.onlineRecommendationsEnabled),
      lastFmApiKey: typeof settings.lastFmApiKey === 'string' ? settings.lastFmApiKey : '',
      onlineRecommendationProviderOrder: normalizeProviderOrder(settings.onlineRecommendationProviderOrder),
      autoPauseIgnoreApps: normalizeIgnoreApps(settings.autoPauseIgnoreApps),
      autoPauseIgnoreFullscreen: Boolean(settings.autoPauseIgnoreFullscreen),
    };
    if ('albumTracklistFetchPaused' in persisted) {
      const { albumTracklistFetchPaused: _legacy, ...rest } = persisted;
      await writeStorageJson('settings.json', rest);
    }

    if (isTauri()) {
      settings = {
        ...settings,
        launchOnStartup: await readLaunchOnStartupEnabled(Boolean(settings.launchOnStartup)),
      };
    }

    if (typeof window !== 'undefined') {
      setFlags({ discoveryIntensity: settings.discoveryIntensity });
      setFlags({ randomnessIntensity: settings.randomnessIntensity });
      setFlags({ mixRegenPaused: settings.pauseMixRegenDuringPlayback });
      setFlags({ onlineRecsEnabled: settings.onlineRecommendationsEnabled });
    }
    enableOnlineRecommendations(settings);

    audioEngine.setCallbacks({
      onProgress: (position, duration) => {
        const currentId = get().currentSongId;
        if (
          currentId &&
          duration > 0 &&
          position / duration >= 0.75 &&
          lastPreloadSongId !== currentId &&
          !preloadOnceCache.has(currentId)
        ) {
          preloadOnceCache.set(currentId, Date.now());
          if (preloadOnceCache.size > PRELOAD_CACHE_LIMIT) {
            const oldestKey = preloadOnceCache.keys().next().value as string | undefined;
            if (oldestKey) {
              preloadOnceCache.delete(oldestKey);
            }
          }
          lastPreloadSongId = currentId;
          const nextState = get();
          if (nextState.settings.gaplessEnabled) {
            const preloadIds = buildUpcomingSongIds(nextState, getPreloadCount());
            if (preloadIds.length) {
              const library = useLibraryStore.getState();
              const preloadSongs = preloadIds
                .map((id) => library.getSongById(id))
                .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
              audioEngine.preloadSongs(preloadSongs);
            }
          }
        }

        const now = Date.now();
        pendingProgress = { position, duration };

        const flush = () => {
          if (!pendingProgress) {
            return;
          }
          const { position: nextPos, duration: nextDur } = pendingProgress;
          pendingProgress = null;
          lastProgressUpdate = Date.now();
          set((state) => {
            if (state.positionSec === nextPos && state.durationSec === nextDur) {
              return state;
            }
            setPlaybackProgress(nextPos, nextDur);
            return { positionSec: nextPos, durationSec: nextDur };
          });

          const currentId = get().currentSongId;
          const now = Date.now();
          if (currentId && now - lastPlaybackPersistAt >= PLAYBACK_PERSIST_THROTTLE_MS) {
            lastPlaybackPersistAt = now;
            persistPlaybackState(get(), { songId: currentId, positionSec: nextPos });
          }
        };

        if (now - lastProgressUpdate >= PROGRESS_UPDATE_MS) {
          if (progressFlushHandle) {
            window.clearTimeout(progressFlushHandle);
            progressFlushHandle = null;
          }
          flush();
          return;
        }

        if (!progressFlushHandle) {
          const delay = Math.max(0, PROGRESS_UPDATE_MS - (now - lastProgressUpdate));
          progressFlushHandle = window.setTimeout(() => {
            progressFlushHandle = null;
            flush();
          }, delay);
        }
      },
      onEnded: async () => {
        const state = get();
        const finishedId = state.currentSongId;
        if (finishedId) {
          schedulePlaybackCritical(() => {
            void useLibraryStore.getState().recordPlaybackEvent(finishedId, {
              listenedSec: state.durationSec || state.positionSec,
              durationSec: state.durationSec,
              manualSkip: false,
              completed: true,
            });
          }, { reason: 'record-playback-ended', groupKey: 'playback-activity' });
        }
        await get().playNext();
      },
    });

    if (isTauri() && !audioFocusUnlisten) {
      audioFocusUnlisten = await listen<{ otherActive: boolean }>('amply://audio-focus', (event) => {
        const payload = event.payload as {
          otherActive?: boolean;
          activeApps?: string[];
          foregroundFullscreen?: boolean;
        };
        const otherActive = payload?.otherActive ?? false;
        const activeAppsRaw = Array.isArray(payload?.activeApps) ? payload.activeApps : [];
        const activeApps = activeAppsRaw.map(normalizeAudioAppName).filter(Boolean);
        const state = get();
        if (!state.settings.autoPauseOnFocus) {
          return;
        }

        const ignoredApps = normalizeIgnoreApps(state.settings.autoPauseIgnoreApps);
        const blockingApps = activeApps.filter((app) => !isAudioAppIgnored(app, ignoredApps));
        const blockedByFullscreen = Boolean(state.settings.autoPauseIgnoreFullscreen && payload?.foregroundFullscreen);
        let blockingOtherAudio = otherActive && !blockedByFullscreen;
        if (activeApps.length) {
          blockingOtherAudio = blockingOtherAudio && blockingApps.length > 0;
        }

        if (blockingOtherAudio) {
          cancelAudioFocusResume();
          if (state.isPlaying || audioEngine.isPlaying()) {
            const position = audioEngine.getPosition();
            audioEngine.pause();
            setGlobalPlayingFlag(false);
            set({ isPlaying: false, positionSec: position, autoPausedByFocus: true });
            get().showToast('Amply paused for other audio');
          }
          return;
        }

        if (state.autoPausedByFocus && !state.isPlaying) {
          audioFocusResumeToken += 1;
          const token = audioFocusResumeToken;
          if (audioFocusResumeTimer) {
            window.clearTimeout(audioFocusResumeTimer);
          }
          audioFocusResumeTimer = window.setTimeout(() => {
            audioFocusResumeTimer = null;
            const latest = get();
            if (token !== audioFocusResumeToken || !latest.autoPausedByFocus || latest.isPlaying) {
              return;
            }
            void latest.resumePlayback();
            set({ autoPausedByFocus: false });
            get().showToast('Amply resumed');
          }, 1800);
        }
      });
    }

    if (settings.gaplessEnabled && settings.crossfadeEnabled) {
      settings = { ...settings, crossfadeEnabled: false };
    }

    audioEngine.applySettings(settings);
    audioEngine.setVolume(get().volume);
    if (typeof window !== 'undefined') {
      setFlags({ metadataPaused: settings.metadataFetchPaused });
    }

    set({ initialized: true, settings });
    startDefaultOutputWatcher();

    const attemptRestore = () => {
      const state = get();
      if (state.currentSongId || state.isPlaying) {
        return true;
      }
      if (!persistedPlayback?.songId) {
        return true;
      }
      const library = useLibraryStore.getState();
      if (!library.initialized) {
        return false;
      }
      const song = library.getSongById(persistedPlayback.songId);
      if (!song) {
        return true;
      }
      const filteredQueue = (persistedPlayback.queueSongIds || [])
        .map((id) => library.getSongById(id))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .map((entry) => entry.id);
      const queue = filteredQueue.length ? filteredQueue : [song.id];
      let queueCursor = queue.indexOf(song.id);
      if (queueCursor < 0) {
        queueCursor = Math.max(0, Math.min(queue.length - 1, persistedPlayback.queueCursor ?? 0));
      }
      const resumeAt = Math.max(0, Math.min(song.duration || 0, persistedPlayback.positionSec || 0));
      audioEngine.setLoop(state.repeatMode === 'one');
      setGlobalPlayingFlag(false);
      setPlaybackProgress(resumeAt, song.duration);
      set({
        currentSongId: song.id,
        queueSongIds: queue,
        queueCursor,
        isPlaying: false,
        positionSec: resumeAt,
        durationSec: song.duration,
        lastQueuePlaylistId: persistedPlayback.playlistId ?? null,
      });
      setGlobalPlaybackHints(song.id, buildUpcomingSongIds({ ...get(), currentSongId: song.id, queueSongIds: queue, queueCursor }, getPreloadCount()));
      return true;
    };

    if (!attemptRestore()) {
      const unsubscribe = useLibraryStore.subscribe((state) => {
        if (!state.initialized) {
          return;
        }
        attemptRestore();
        audioEngine.applySettings(get().settings);
        unsubscribe();
      });
    }
  },

  setQueue: (songIds, startSongId, options) => {
    const startIndex = startSongId ? Math.max(0, songIds.indexOf(startSongId)) : 0;
    set({
      queueSongIds: songIds,
      queueCursor: startIndex,
      albumQueueView: null,
      lastQueuePlaylistId: options?.playlistId ?? null,
    });
    const nextState = get();
    const preloadIds = buildUpcomingSongIds(nextState, 1);
    setGlobalPlaybackHints(nextState.currentSongId, preloadIds);
    persistPlaybackState(nextState, {
      queueSongIds: songIds,
      queueCursor: startIndex,
      playlistId: options?.playlistId ?? null,
      songId: startSongId ?? nextState.currentSongId,
    });
    if (nextState.currentSongId && preloadIds.length && nextState.settings.gaplessEnabled) {
      const library = useLibraryStore.getState();
      const preloadSongs = preloadIds
        .map((id) => library.getSongById(id))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      audioEngine.preloadSongs(preloadSongs);
    }
  },

  playSongById: async (songId, transition = true) => {
    const latencyStart = performance.now();
    cancelAudioFocusResume();
    pendingSongMetadataCancel?.();
    pendingSongMetadataCancel = null;

    const song = useLibraryStore.getState().getSongById(songId);
    if (!song) {
      return;
    }

    const fastSkip = transition === false || isFastSkip();
    if (fastSkip) {
      enterRapidPlaybackLane('rapid-playback');
    }

    // Notify the priority system of song change
    notifySongChange();

    const state = get();
    audioEngine.setLoop(state.repeatMode === 'one');

    const queueCursor = state.queueSongIds.indexOf(songId);
    const updatedHistory = [...state.historySongIds, songId].slice(-100);
    const preloadCount = fastSkip ? 1 : 2;
    const preloadIds = buildUpcomingSongIds({ ...state, currentSongId: songId, queueCursor }, preloadCount);
    set((prev) => ({
      currentSongId: songId,
      queueCursor: queueCursor >= 0 ? queueCursor : prev.queueCursor,
      isPlaying: false,
      positionSec: 0,
      durationSec: song.duration,
      historySongIds: updatedHistory,
      manualQueueSongIds: prev.manualQueueSongIds.includes(songId)
        ? prev.manualQueueSongIds.filter((id) => id !== songId)
        : prev.manualQueueSongIds,
      albumQueueView:
        prev.albumQueueView && !prev.albumQueueView.items.some((item) => item.id === songId)
          ? null
          : prev.albumQueueView,
    }));
    setPlaybackProgress(0, song.duration);
    setGlobalPlaybackHints(songId, buildUpcomingSongIds(get(), getPreloadCount()));
    persistPlaybackState(get(), { songId, positionSec: 0 });

    try {
      await audioEngine.loadSong(song, {
        autoplay: true,
        transition: transition && !get().settings.gaplessEnabled,
        startAtSec: 0,
      });
      setGlobalPlayingFlag(true);
      set({ isPlaying: true });
      recordPlaybackLatency(fastSkip ? 'next-track-fast' : 'track-load', performance.now() - latencyStart);
      if (preloadIds.length && !fastSkip && get().settings.gaplessEnabled) {
        const library = useLibraryStore.getState();
        const preloadSongs = preloadIds
          .map((id) => library.getSongById(id))
          .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
        audioEngine.preloadSongs(preloadSongs);
      }
      if (!fastSkip) {
        scheduleStableCurrentSongMetadata(songId);
      }
    } catch {
      setGlobalPlayingFlag(false);
      set({ isPlaying: false });
      get().showToast('Track failed to load');
      recordPlaybackLatency('track-load-failed', performance.now() - latencyStart);
      return;
    }

    schedulePlaybackCritical(() => {
      void useLibraryStore.getState().recordSongPlay(songId);
    }, { reason: 'record-song-play', groupKey: 'playback-activity' });
  },

  setAlbumQueueView: (view) => {
    set((state) => ({
      albumQueueView: view,
      shuffleEnabled: view ? false : state.shuffleEnabled,
    }));
  },

  togglePlayPause: () => {
    const latencyStart = performance.now();
    cancelAudioFocusResume();
    const playing = get().isPlaying || audioEngine.isPlaying();
    if (playing) {
      const position = audioEngine.getPosition();
      audioEngine.pause();
      setGlobalPlayingFlag(false);
      setPlaybackProgress(position, get().durationSec);
      set({ isPlaying: false, positionSec: position, autoPausedByFocus: false });
      persistPlaybackState(get(), { positionSec: position });
      recordPlaybackLatency('pause', performance.now() - latencyStart);
      return;
    }

    const songId = get().currentSongId;
    if (!songId) {
      const library = useLibraryStore.getState();
      const dailyMix = library.playlists.find((playlist) => playlist.id === 'smart_daily_mix');
      const dailyFirst = dailyMix?.songIds?.[0];
      if (dailyMix?.songIds?.length) {
        get().setQueue(dailyMix.songIds, dailyFirst, { playlistId: dailyMix.id });
      }
      const fallback = dailyFirst ?? get().queueSongIds[0] ?? library.songs[0]?.id;
      if (fallback) {
        void get().playSongById(fallback, false);
      }
      return;
    }

    const resumeAt = get().positionSec || 0;
    void ensureCurrentSongPrepared(songId, resumeAt, true).then((prepared) => {
      if (!prepared) {
        get().showToast('Track failed to load');
        return;
      }
      setGlobalPlayingFlag(true);
      setPlaybackProgress(resumeAt, get().durationSec);
      set({ isPlaying: true, positionSec: resumeAt, autoPausedByFocus: false });
      persistPlaybackState(get(), { positionSec: resumeAt });
      recordPlaybackLatency('resume', performance.now() - latencyStart);
    }).catch((error: unknown) => {
        recordPerfEvent('player.resume-failed', { error: error instanceof Error ? error.message : String(error) });
        get().showToast('Track failed to load');
      });
  },

  pausePlayback: () => {
    cancelAudioFocusResume();
    const position = audioEngine.getPosition();
    audioEngine.pause();
    setGlobalPlayingFlag(false);
    setPlaybackProgress(position, get().durationSec);
    set({ isPlaying: false, positionSec: position, autoPausedByFocus: false });
    setGlobalPlaybackHints(get().currentSongId, buildUpcomingSongIds(get()));
    persistPlaybackState(get(), { positionSec: position });
  },

  resumePlayback: () => {
    cancelAudioFocusResume();
    const songId = get().currentSongId;
    if (!songId) {
      const library = useLibraryStore.getState();
      const dailyMix = library.playlists.find((playlist) => playlist.id === 'smart_daily_mix');
      const dailyFirst = dailyMix?.songIds?.[0];
      if (dailyMix?.songIds?.length) {
        get().setQueue(dailyMix.songIds, dailyFirst, { playlistId: dailyMix.id });
      }
      const fallback = dailyFirst ?? get().queueSongIds[0] ?? library.songs[0]?.id;
      if (fallback) {
        void get().playSongById(fallback, false);
      }
      return;
    }
    const resumeAt = get().positionSec || 0;
    void ensureCurrentSongPrepared(songId, resumeAt, true).then((prepared) => {
      if (!prepared) {
        get().showToast('Track failed to load');
        return;
      }
      setGlobalPlayingFlag(true);
      setPlaybackProgress(resumeAt, get().durationSec);
      set({ isPlaying: true, positionSec: resumeAt, autoPausedByFocus: false });
      setGlobalPlaybackHints(get().currentSongId, buildUpcomingSongIds(get()));
      persistPlaybackState(get(), { positionSec: resumeAt });
    }).catch((error: unknown) => {
        recordPerfEvent('player.resume-failed', { error: error instanceof Error ? error.message : String(error) });
        get().showToast('Track failed to load');
      });
  },

  playNext: async (manual = false) => {
    const latencyStart = performance.now();
    if (manual) {
      lastManualSkipAt = Date.now();
      enterRapidPlaybackLane('rapid-playback');
    }
    const state = get();
    if (state.currentSongId) {
      schedulePlaybackCritical(() => {
        void useLibraryStore.getState().recordPlaybackEvent(state.currentSongId!, {
          listenedSec: state.positionSec,
          durationSec: state.durationSec,
          manualSkip: manual,
          completed: !manual,
        });
      }, { reason: 'record-playback-event', groupKey: 'playback-activity' });
    }
    const nextSongId =
      manual && state.repeatMode === 'one'
        ? resolveNextSongId({ ...state, repeatMode: 'off' })
        : resolveNextSongId(state);

    if (!nextSongId) {
      setGlobalPlayingFlag(false);
      set({ isPlaying: false, positionSec: 0 });
      return;
    }

    await get().playSongById(nextSongId, !manual);
    recordPlaybackLatency(manual ? 'next-manual' : 'next-auto', performance.now() - latencyStart);
  },

  playPrevious: async () => {
    const latencyStart = performance.now();
    const state = get();

    if (state.positionSec > 4 && state.currentSongId) {
      audioEngine.seek(0);
      setPlaybackProgress(0, state.durationSec);
      set({ positionSec: 0 });
      recordPlaybackLatency('previous-restart', performance.now() - latencyStart);
      return;
    }

    lastManualSkipAt = Date.now();
    enterRapidPlaybackLane('rapid-playback');
    const previousSongId = resolvePreviousSongId(state);
    if (!previousSongId) {
      return;
    }

    if (state.currentSongId) {
      schedulePlaybackCritical(() => {
        void useLibraryStore.getState().recordPlaybackEvent(state.currentSongId!, {
          listenedSec: state.positionSec,
          durationSec: state.durationSec,
          manualSkip: true,
          completed: false,
        });
      }, { reason: 'record-playback-event', groupKey: 'playback-activity' });
    }

    await get().playSongById(previousSongId, false);
    recordPlaybackLatency('previous-track', performance.now() - latencyStart);
  },

  seekTo: (positionSec) => {
    const latencyStart = performance.now();
    audioEngine.seek(positionSec);
    setPlaybackProgress(positionSec, get().durationSec);
    set({ positionSec });
    recordPlaybackLatency('seek', performance.now() - latencyStart);
  },

  setVolume: (volume) => {
    const clamped = Math.max(0, Math.min(1, volume));
    audioEngine.setVolume(clamped);
    set({ volume: clamped });
  },

  setShuffleEnabled: (enabled) => {
    set((state) => ({
      shuffleEnabled: enabled,
      repeatMode: enabled ? 'off' : state.repeatMode,
    }));
  },

  toggleLoopSong: () => {
    set((state) => {
      const nextRepeat = state.repeatMode === 'one' ? 'off' : 'one';
      audioEngine.setLoop(nextRepeat === 'one');
      return {
        repeatMode: nextRepeat,
        shuffleEnabled: nextRepeat === 'one' ? false : state.shuffleEnabled,
      };
    });
  },

  setNowPlayingTab: (tab) => {
    set({ nowPlayingTab: tab });
  },

  setPlaybackSpeed: async (speed) => {
    const clamped = Math.max(0.75, Math.min(1.5, speed));
    const settings = {
      ...get().settings,
      playbackSpeed: clamped,
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setOutputDeviceName: async (deviceName) => {
    const settings = {
      ...get().settings,
      outputDeviceName: deviceName ?? undefined,
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setEqPreset: async (preset) => {
    const template = preset === 'custom' ? get().settings.eqBands : (eqPresetBands[preset] ?? eqPresetBands.flat);
    const settings = {
      ...get().settings,
      eqPreset: preset,
      eqBands: [...template],
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setEqBands: async (bands) => {
    const normalized = normalizeEqBands(bands, get().settings.eqPreset);
    const settings = {
      ...get().settings,
      eqPreset: 'custom' as const,
      eqBands: normalized,
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setCrossfadeEnabled: async (enabled) => {
    const settings = {
      ...get().settings,
      crossfadeEnabled: enabled,
      gaplessEnabled: enabled ? false : get().settings.gaplessEnabled,
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setCrossfadeDuration: async (durationSec) => {
    const settings = {
      ...get().settings,
      crossfadeDurationSec: Math.max(1, Math.min(12, durationSec)),
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setGaplessEnabled: async (enabled) => {
    const settings = {
      ...get().settings,
      gaplessEnabled: enabled,
      crossfadeEnabled: enabled ? false : get().settings.crossfadeEnabled,
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setAppTheme: async (theme) => {
    const nextTheme: AppSettings['appTheme'] = theme === 'dark' ? 'dark' : 'light';
    const settings = {
      ...get().settings,
      appTheme: nextTheme,
    };
    set({ settings });
    await persistSettings(settings);
  },

  setLaunchOnStartup: async (enabled) => {
    const previous = get().settings;
    const optimisticSettings = {
      ...previous,
      launchOnStartup: enabled,
    };

    set({ settings: optimisticSettings });

    if (!isTauri()) {
      await persistSettings(optimisticSettings);
      return;
    }

    try {
      const actualEnabled = await setSystemLaunchOnStartup(enabled);
      const verifiedSettings = {
        ...get().settings,
        launchOnStartup: actualEnabled,
      };
      set({ settings: verifiedSettings });
      await persistSettings(verifiedSettings);
      get().showToast(actualEnabled ? 'Amply will launch on startup' : 'Startup launch disabled');
    } catch (error) {
      const actualEnabled = await readLaunchOnStartupEnabled(previous.launchOnStartup);
      const revertedSettings = {
        ...get().settings,
        launchOnStartup: actualEnabled,
      };
      set({ settings: revertedSettings });
      await persistSettings(revertedSettings);
      get().showToast('Startup setting failed');
      recordPerfEvent('settings.launch-startup.verify-failed', {
        requested: enabled,
        actual: actualEnabled,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },


  setGameMode: async (enabled) => {
    const settings = {
      ...get().settings,
      gameMode: enabled,
    };

    set({ settings });
    await persistSettings(settings);
  },

  setMiniNowPlayingOverlay: async (enabled) => {
    const settings = {
      ...get().settings,
      miniNowPlayingOverlay: enabled,
    };

    set({ settings });
    await persistSettings(settings);
  },

  setOverlaySpinningArtwork: async (enabled) => {
    const settings = {
      ...get().settings,
      overlaySpinningArtwork: enabled,
    };

    set({ settings });
    await persistSettings(settings);
  },

  setOverlayAutoHide: async (enabled) => {
    const settings = {
      ...get().settings,
      overlayAutoHide: enabled,
    };

    set({ settings });
    await persistSettings(settings);
  },

  setLyricsVisualsEnabled: async (enabled) => {
    const settings = {
      ...get().settings,
      lyricsVisualsEnabled: enabled,
    };

    set({ settings });
    await persistSettings(settings);
  },

  setLyricsVisualTheme: async (theme) => {
    const settings = {
      ...get().settings,
      lyricsVisualTheme: theme,
    };

    set({ settings });
    await persistSettings(settings);
  },

  setMetadataFetchPaused: async (paused) => {
    const settings = {
      ...get().settings,
      metadataFetchPaused: paused,
    };

    set({ settings });
    if (typeof window !== 'undefined') {
      setFlags({ metadataPaused: paused });
    }
    await persistSettings(settings);
  },

  setDiscoveryIntensity: async (value) => {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : defaultSettings.discoveryIntensity));
    const settings = {
      ...get().settings,
      discoveryIntensity: clamped,
    };

    set({ settings });
    if (typeof window !== 'undefined') {
      setFlags({ discoveryIntensity: clamped });
    }
    await persistSettings(settings);
    void useLibraryStore.getState().regenerateSmartPlaylists();
  },

  setRandomnessIntensity: async (value) => {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : defaultSettings.randomnessIntensity));
    const settings = {
      ...get().settings,
      randomnessIntensity: clamped,
    };

    set({ settings });
    if (typeof window !== 'undefined') {
      setFlags({ randomnessIntensity: clamped });
    }
    await persistSettings(settings);
    void useLibraryStore.getState().regenerateSmartPlaylists();
  },

  setPauseMixRegenDuringPlayback: async (enabled) => {
    const settings = {
      ...get().settings,
      pauseMixRegenDuringPlayback: enabled,
    };

    set({ settings });
    if (typeof window !== 'undefined') {
      setFlags({ mixRegenPaused: enabled });
    }
    await persistSettings(settings);
  },

  setOnlineRecommendationsEnabled: async (enabled) => {
    const settings = {
      ...get().settings,
      onlineRecommendationsEnabled: enabled,
    };

    set({ settings });
    if (typeof window !== 'undefined') {
      setFlags({ onlineRecsEnabled: enabled });
    }
    enableOnlineRecommendations(settings);
    await persistSettings(settings);
    if (enabled) {
      const songs = useLibraryStore.getState().songs;
      scheduleOnlineEnrichment(pickOnlineRecommendationSeedIds(songs, 32), 'idle');
    }
    void useLibraryStore.getState().regenerateSmartPlaylists();
  },

  setLastFmApiKey: async (apiKey) => {
    const settings = {
      ...get().settings,
      lastFmApiKey: apiKey.trim(),
    };

    set({ settings });
    enableOnlineRecommendations(settings);
    await persistSettings(settings);
    if (settings.onlineRecommendationsEnabled && settings.lastFmApiKey) {
      const songs = useLibraryStore.getState().songs;
      scheduleOnlineEnrichment(pickOnlineRecommendationSeedIds(songs, 24), 'idle');
    }
  },

  setOnlineRecommendationProviderOrder: async (providers) => {
    const settings = {
      ...get().settings,
      onlineRecommendationProviderOrder: normalizeProviderOrder(providers),
    };

    set({ settings });
    enableOnlineRecommendations(settings);
    await persistSettings(settings);
    void useLibraryStore.getState().regenerateSmartPlaylists();
  },

  setAutoPauseOnFocus: async (enabled) => {
    const settings = {
      ...get().settings,
      autoPauseOnFocus: enabled,
    };

    if (!enabled) {
      cancelAudioFocusResume();
    }
    set({ settings, autoPausedByFocus: enabled ? get().autoPausedByFocus : false });
    await persistSettings(settings);
  },

  setAutoPauseIgnoreApps: async (apps) => {
    const normalized = normalizeIgnoreApps(apps);
    const settings = {
      ...get().settings,
      autoPauseIgnoreApps: normalized,
    };
    set({ settings });
    await persistSettings(settings);
  },

  setAutoPauseIgnoreFullscreen: async (enabled) => {
    const settings = {
      ...get().settings,
      autoPauseIgnoreFullscreen: enabled,
    };
    set({ settings });
    await persistSettings(settings);
  },

  showToast: (message) => {
    if (typeof window === 'undefined') {
      return;
    }
    set({ toastMessage: message });
    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(() => {
      toastTimer = null;
      set({ toastMessage: null });
    }, 2400);
  },

  setSleepTimer: (minutes) => {
    clearSleepTimerHandle();

    if (!minutes || minutes <= 0) {
      set({ sleepTimerEndsAt: null, sleepTimerDurationMin: null });
      return;
    }

    const target = Date.now() + minutes * 60_000;
    sleepTimerHandle = window.setTimeout(() => {
      const state = get();
      if (state.sleepTimerEndsAt !== target) {
        return;
      }

      sleepTimerHandle = null;
      audioEngine.pause();
      setGlobalPlayingFlag(false);
      set({ isPlaying: false, sleepTimerEndsAt: null, sleepTimerDurationMin: null });
    }, minutes * 60_000);

    set({ sleepTimerEndsAt: target, sleepTimerDurationMin: minutes });
  },

  deleteCurrentSong: async () => {
    const state = get();
    const songId = state.currentSongId;
    if (!songId) {
      return false;
    }

    const deleted = await useLibraryStore.getState().deleteSongFromDisk(songId);
    if (!deleted) {
      return false;
    }

    const nextQueueSongIds = state.queueSongIds.filter((id) => id !== songId);
    const nextManualQueueSongIds = state.manualQueueSongIds.filter((id) => id !== songId);
    const nextHistorySongIds = state.historySongIds.filter((id) => id !== songId);
    const removedQueueIndex = state.queueSongIds.indexOf(songId);
    const nextCursor =
      removedQueueIndex >= 0
        ? Math.min(state.queueCursor, Math.max(0, nextQueueSongIds.length - 1))
        : state.queueCursor;
    const nextCurrentSongId =
      nextManualQueueSongIds[0] ??
      nextQueueSongIds[nextCursor] ??
      nextQueueSongIds[0] ??
      null;

    audioEngine.stop();
    setGlobalPlayingFlag(false);
    set({
      currentSongId: null,
      isPlaying: false,
      positionSec: 0,
      durationSec: 0,
      queueSongIds: nextQueueSongIds,
      manualQueueSongIds: nextManualQueueSongIds,
      historySongIds: nextHistorySongIds,
      queueCursor: nextCursor,
      albumQueueView:
        state.albumQueueView && !state.albumQueueView.items.some((item) => item.id === nextCurrentSongId)
          ? null
          : state.albumQueueView,
    });

    if (nextCurrentSongId) {
      await get().playSongById(nextCurrentSongId, false);
    } else {
      setGlobalPlaybackHints(null, []);
      persistPlaybackState(get(), { songId: null, positionSec: 0, queueSongIds: nextQueueSongIds, queueCursor: nextCursor });
    }

    get().showToast('Song deleted from device');
    return true;
  },

  enqueueSong: (songId) => {
    schedulePlaybackCritical(() => {
      void useLibraryStore.getState().recordQueueAdd(songId);
    }, { reason: 'record-queue-add', groupKey: 'playback-activity' });
    set((state) => ({
      manualQueueSongIds: state.manualQueueSongIds.includes(songId)
        ? state.manualQueueSongIds
        : [...state.manualQueueSongIds, songId],
    }));
  },

  removeQueuedSong: (songId) => {
    set((state) => {
      if (state.manualQueueSongIds.length > 0) {
        return {
          manualQueueSongIds: state.manualQueueSongIds.filter((id) => id !== songId),
        };
      }

      const index = state.queueSongIds.indexOf(songId);
      if (index < 0) {
        return state;
      }

      const nextQueue = [...state.queueSongIds];
      nextQueue.splice(index, 1);

      let nextCursor = state.queueCursor;
      if (index < state.queueCursor) {
        nextCursor = Math.max(0, state.queueCursor - 1);
      } else if (index === state.queueCursor) {
        nextCursor = Math.min(nextCursor, Math.max(0, nextQueue.length - 1));
      }

      return {
        queueSongIds: nextQueue,
        queueCursor: nextCursor,
      };
    });
  },

  reorderQueue: (fromIndex, toIndex) => {
    set((state) => {
      const queue = [...state.manualQueueSongIds];
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= queue.length ||
        toIndex >= queue.length ||
        fromIndex === toIndex
      ) {
        return { manualQueueSongIds: queue };
      }

      const [moved] = queue.splice(fromIndex, 1);
      queue.splice(toIndex, 0, moved);
      return { manualQueueSongIds: queue };
    });
  },

  reshuffleQueue: () => {
    set((state) => {
      const usingManual = state.manualQueueSongIds.length > 0;
      const base = usingManual ? [...state.manualQueueSongIds] : [...state.queueSongIds];
      if (base.length <= 1) {
        return state;
      }
      const currentId = state.currentSongId;
      const hasCurrent = currentId ? base.includes(currentId) : false;
      const rest = shuffle(hasCurrent ? base.filter((id) => id !== currentId) : base);
      const nextQueue = hasCurrent && currentId ? [currentId, ...rest] : rest;
      if (usingManual) {
        return { manualQueueSongIds: nextQueue, albumQueueView: null };
      }
      return {
        queueSongIds: nextQueue,
        queueCursor: hasCurrent ? 0 : state.queueCursor,
        albumQueueView: null,
      };
    });
  },
}));

type PlaySongByIdOptions = { transition?: boolean } | boolean;

const resolvePlayTransition = (options?: PlaySongByIdOptions): boolean => {
  if (typeof options === 'boolean') {
    return options;
  }
  return options?.transition ?? true;
};

export const playbackActions = {
  playSongById: (songId: string, options?: PlaySongByIdOptions): Promise<void> =>
    usePlayerStore.getState().playSongById(songId, resolvePlayTransition(options)),
  setQueue: (
    songIds: string[],
    startSongId?: string,
    context?: { playlistId?: string | null },
  ): void => usePlayerStore.getState().setQueue(songIds, startSongId, context),
  playNext: (manual = false): Promise<void> => usePlayerStore.getState().playNext(manual),
  playPrevious: (): Promise<void> => usePlayerStore.getState().playPrevious(),
  seekTo: (seconds: number): void => usePlayerStore.getState().seekTo(seconds),
};
