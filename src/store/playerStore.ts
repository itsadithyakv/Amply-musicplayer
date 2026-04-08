import { create } from 'zustand';
import type { AppSettings, NowPlayingTab, RepeatMode } from '@/types/music';
import { audioEngine } from '@/services/audioEngine';
import { useLibraryStore } from '@/store/libraryStore';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { listOutputDevices } from '@/services/audioDeviceService';
import { isTauri, readStorageJson, writeStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { loadSongLoudness } from '@/services/loudnessService';
import {
  loadMetadataAttempts,
  noteMetadataFailure,
  noteMetadataSuccess,
  saveMetadataAttempts,
  shouldSkipMetadata,
  tryAcquireMetadata,
  releaseMetadata,
} from '@/services/metadataAttemptService';
import { isSongCached, loadMetadataCacheIndex } from '@/services/metadataCacheIndex';
import { notifySongChange, shouldLoadExpensiveMetadata } from '@/services/metadataPriority';

const setGlobalPlayingFlag = (playing: boolean): void => {
  if (typeof window === 'undefined') {
    return;
  }
  (window as unknown as { __AMP_IS_PLAYING__?: boolean }).__AMP_IS_PLAYING__ = playing;
};

const setGlobalPlaybackHints = (currentSongId: string | null, upcoming: string[]): void => {
  if (typeof window === 'undefined') {
    return;
  }
  (window as unknown as { __AMP_CURRENT_SONG_ID__?: string | null }).__AMP_CURRENT_SONG_ID__ = currentSongId ?? null;
  (window as unknown as { __AMP_UP_NEXT__?: string[] }).__AMP_UP_NEXT__ = upcoming;
};

const getPreloadCount = (): number => {
  if (typeof window === 'undefined') {
    return 3;
  }
  const flags = window as unknown as { __AMP_LOW_PERF__?: boolean; __AMP_GAME_MODE__?: boolean };
  if (flags.__AMP_GAME_MODE__ === true) {
    return 2;
  }
  return flags.__AMP_LOW_PERF__ === true ? 2 : 4;
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
  setVolumeNormalizationEnabled: (enabled: boolean) => Promise<void>;
  setLaunchOnStartup: (enabled: boolean) => Promise<void>;
  setGameMode: (enabled: boolean) => Promise<void>;
  setMiniNowPlayingOverlay: (enabled: boolean) => Promise<void>;
  setOverlayAutoHide: (enabled: boolean) => Promise<void>;
  setLyricsVisualsEnabled: (enabled: boolean) => Promise<void>;
  setLyricsVisualTheme: (theme: AppSettings['lyricsVisualTheme']) => Promise<void>;
  setMetadataFetchPaused: (paused: boolean) => Promise<void>;
  setDiscoveryIntensity: (value: number) => Promise<void>;
  setRandomnessIntensity: (value: number) => Promise<void>;
  setPauseMixRegenDuringPlayback: (enabled: boolean) => Promise<void>;
  setAutoPauseOnFocus: (enabled: boolean) => Promise<void>;
  setAutoPauseIgnoreApps: (apps: string[]) => Promise<void>;
  setAutoPauseIgnoreFullscreen: (enabled: boolean) => Promise<void>;
  setSleepTimer: (minutes: number | null) => void;
  enqueueSong: (songId: string) => void;
  removeQueuedSong: (songId: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  reshuffleQueue: () => void;
}

const defaultSettings: AppSettings = {
  libraryPath: 'music',
  crossfadeEnabled: true,
  crossfadeDurationSec: 6,
  gaplessEnabled: true,
  volumeNormalizationEnabled: true,
  playbackSpeed: 1,
  outputDeviceName: undefined,
  eqPreset: 'flat',
  eqBands: [0, 0, 0, 0, 0],
  launchOnStartup: false,
  gameMode: false,
  miniNowPlayingOverlay: false,
  overlayAutoHide: true,
  lyricsVisualsEnabled: true,
  lyricsVisualTheme: 'ember',
  metadataFetchPaused: false,
  discoveryIntensity: 0.35,
  randomnessIntensity: 0.3,
  pauseMixRegenDuringPlayback: true,
  autoPauseOnFocus: true,
  autoPauseIgnoreApps: [],
  autoPauseIgnoreFullscreen: true,
};

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
let toastTimer: number | null = null;

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
      const devices = await listOutputDevices();
      const currentDefault = devices.find((device) => device.isDefault)?.name ?? null;
      if (currentDefault && currentDefault !== lastDefaultOutputName) {
        lastDefaultOutputName = currentDefault;
        void invoke('audio_set_output_device', { name: null });
      }
    } catch {
      // Ignore polling errors.
    }
  };

  void poll();
  defaultOutputPollHandle = window.setInterval(poll, 8000);
};

const persistSettings = async (settings: AppSettings): Promise<void> => {
  const current = await readStorageJson<Record<string, unknown>>('settings.json', {});
  const { libraryPath: _libraryPath, ...audioSettings } = settings;
  await writeStorageJson('settings.json', {
    ...current,
    ...audioSettings,
  });
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
    return candidates[Math.floor(Math.random() * candidates.length)];
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
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const swap = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[swap]] = [candidates[swap], candidates[i]];
    }
    for (const id of candidates) {
      enqueue(id);
      if (upcoming.length >= count) {
        break;
      }
    }
  }

  return upcoming;
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
    if (get().initialized) {
      return;
    }

    const persisted = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
    const persistedPlayback = await readStorageJson<PersistedPlaybackState | null>(playbackStatePath, null);
    let settings: AppSettings = {
      ...defaultSettings,
      ...persisted,
    };
    settings = {
      ...settings,
      eqBands: normalizeEqBands(settings.eqBands, settings.eqPreset),
      discoveryIntensity: Math.max(0, Math.min(1, settings.discoveryIntensity ?? defaultSettings.discoveryIntensity)),
      randomnessIntensity: Math.max(0, Math.min(1, settings.randomnessIntensity ?? defaultSettings.randomnessIntensity)),
      autoPauseIgnoreApps: normalizeIgnoreApps(settings.autoPauseIgnoreApps),
      autoPauseIgnoreFullscreen: Boolean(settings.autoPauseIgnoreFullscreen),
    };
    if ('albumTracklistFetchPaused' in persisted) {
      const { albumTracklistFetchPaused: _legacy, ...rest } = persisted;
      await writeStorageJson('settings.json', rest);
    }

    if (isTauri()) {
      try {
        const autostart = await import('@tauri-apps/plugin-autostart');
        const enabled = await autostart.isEnabled();
        settings = { ...settings, launchOnStartup: enabled };
      } catch {
        // Ignore autostart failures; keep persisted setting.
      }
    }

    if (typeof window !== 'undefined') {
      (window as unknown as { __AMP_DISCOVERY_INTENSITY__?: number }).__AMP_DISCOVERY_INTENSITY__ = settings.discoveryIntensity;
      (window as unknown as { __AMP_RANDOMNESS_INTENSITY__?: number }).__AMP_RANDOMNESS_INTENSITY__ = settings.randomnessIntensity;
      (window as unknown as { __AMP_MIX_REGEN_PAUSED__?: boolean }).__AMP_MIX_REGEN_PAUSED__ =
        settings.pauseMixRegenDuringPlayback;
    }

    audioEngine.setCallbacks({
      onProgress: (position, duration) => {
        const currentId = get().currentSongId;
        if (currentId && duration > 0 && position / duration >= 0.75 && lastPreloadSongId !== currentId) {
          if (preloadOnceCache.has(currentId)) {
            return;
          }
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
          void useLibraryStore.getState().recordPlaybackEvent(finishedId, {
            listenedSec: state.durationSec || state.positionSec,
            durationSec: state.durationSec,
            manualSkip: false,
            completed: true,
          });
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
        const activeApps = activeAppsRaw.map((app) => app.toLowerCase());
        const state = get();
        if (!state.settings.autoPauseOnFocus) {
          return;
        }
        if (state.settings.autoPauseIgnoreFullscreen && payload?.foregroundFullscreen) {
          return;
        }
        let shouldPause = otherActive;
        if (activeApps.length) {
          const ignore = new Set(normalizeIgnoreApps(state.settings.autoPauseIgnoreApps));
          const remaining = activeApps.filter((app) => !ignore.has(app));
          shouldPause = remaining.length > 0;
        }
        if (otherActive) {
          if (!shouldPause) {
            return;
          }
          if (audioFocusResumeTimer) {
            window.clearTimeout(audioFocusResumeTimer);
            audioFocusResumeTimer = null;
          }
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
          if (audioFocusResumeTimer) {
            window.clearTimeout(audioFocusResumeTimer);
          }
          audioFocusResumeTimer = window.setTimeout(() => {
            const latest = get();
            if (!latest.autoPausedByFocus || latest.isPlaying) {
              return;
            }
            void latest.resumePlayback();
            set({ autoPausedByFocus: false });
            get().showToast('Amply resumed');
          }, 1200);
        }
      });
    }

    if (settings.gaplessEnabled && settings.crossfadeEnabled) {
      settings = { ...settings, crossfadeEnabled: false };
    }

    audioEngine.applySettings(settings);
    audioEngine.setVolume(get().volume);
    if (typeof window !== 'undefined') {
      (window as unknown as { __AMP_METADATA_PAUSED__?: boolean }).__AMP_METADATA_PAUSED__ = settings.metadataFetchPaused;
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
      void audioEngine.loadSong(song, { autoplay: false, transition: false, startAtSec: resumeAt });
      setGlobalPlayingFlag(false);
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
    const preloadIds = buildUpcomingSongIds(nextState, getPreloadCount());
    setGlobalPlaybackHints(nextState.currentSongId, preloadIds);
    persistPlaybackState(nextState, {
      queueSongIds: songIds,
      queueCursor: startIndex,
      playlistId: options?.playlistId ?? null,
      songId: startSongId ?? nextState.currentSongId,
    });
    if (preloadIds.length) {
      const library = useLibraryStore.getState();
      const preloadSongs = preloadIds
        .map((id) => library.getSongById(id))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      audioEngine.preloadSongs(preloadSongs);
    }
  },

  playSongById: async (songId, transition = true) => {
    const song = useLibraryStore.getState().getSongById(songId);
    if (!song) {
      return;
    }

    // Notify the priority system of song change
    notifySongChange();

    const state = get();
    audioEngine.setLoop(state.repeatMode === 'one');

    void audioEngine.loadSong(song, {
      autoplay: true,
      transition,
      startAtSec: 0,
    });

    const queueCursor = state.queueSongIds.indexOf(songId);
    const updatedHistory = [...state.historySongIds, songId].slice(-100);
    const preloadIds = buildUpcomingSongIds({ ...state, currentSongId: songId, queueCursor }, getPreloadCount());
    setGlobalPlaybackHints(songId, preloadIds);
    if (preloadIds.length) {
      const library = useLibraryStore.getState();
      const preloadSongs = preloadIds
        .map((id) => library.getSongById(id))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
      audioEngine.preloadSongs(preloadSongs);
    }

    setGlobalPlayingFlag(true);
    set((prev) => ({
      currentSongId: songId,
      queueCursor: queueCursor >= 0 ? queueCursor : prev.queueCursor,
      isPlaying: true,
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
    setGlobalPlaybackHints(songId, buildUpcomingSongIds(get(), getPreloadCount()));
    persistPlaybackState(get(), { songId, positionSec: 0 });

    void useLibraryStore.getState().recordSongPlay(songId);
    if (!get().settings.gameMode) {
      window.setTimeout(() => {
        if (get().currentSongId !== songId) {
          return;
        }
        const idle = (globalThis as typeof globalThis & {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;
        const runFetch = () => {
          if (get().currentSongId !== songId) {
            return;
          }
          void useLibraryStore
            .getState()
            .fetchMissingMetadataForSong(songId, { forceRetry: true, ignoreCooldown: true });
        };
        if (typeof idle === 'function') {
          idle(runFetch, { timeout: 1500 });
        } else {
          runFetch();
        }
      }, 2000);
    }

    if (!get().settings.gameMode) {
      window.setTimeout(() => {
        if (get().currentSongId !== songId) {
          return;
        }
        // Check if we should load expensive metadata
        if (!shouldLoadExpensiveMetadata()) {
          return;
        }
        const idle = (globalThis as typeof globalThis & {
          requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
        }).requestIdleCallback;

        const runLoudness = async () => {
          if (get().currentSongId !== songId) {
            return;
          }
          if (get().settings.metadataFetchPaused) {
            return;
          }
          const library = useLibraryStore.getState();
          const song = library.getSongById(songId);
          if (!song) {
            return;
          }
          if (typeof song.loudnessLufs === 'number') {
            return;
          }

          const cacheIndex = await loadMetadataCacheIndex();
          if (isSongCached(cacheIndex, song.id, 'loudness')) {
            return;
          }

          const attempts = await loadMetadataAttempts();
          if (shouldSkipMetadata(attempts, 'loudness', song.id)) {
            return;
          }
          if (!tryAcquireMetadata('loudness', song.id)) {
            return;
          }

          try {
            const loudnessResult = await loadSongLoudness(song);
            if (loudnessResult.status === 'ready') {
              noteMetadataSuccess(attempts, 'loudness', song.id);
              await library.updateSongLoudness(song.id, loudnessResult.lufs);
            } else {
              noteMetadataFailure(attempts, 'loudness', song.id);
            }
          } catch {
            noteMetadataFailure(attempts, 'loudness', song.id);
          } finally {
            releaseMetadata('loudness', song.id);
            await saveMetadataAttempts(attempts);
          }
        };

        if (typeof idle === 'function') {
          idle(() => {
            void runLoudness();
          }, { timeout: 1500 });
        } else {
          void runLoudness();
        }
      }, 2500);
    }
  },

  setAlbumQueueView: (view) => {
    set((state) => ({
      albumQueueView: view,
      shuffleEnabled: view ? false : state.shuffleEnabled,
    }));
  },

  togglePlayPause: () => {
    const playing = get().isPlaying || audioEngine.isPlaying();
    if (playing) {
      const position = audioEngine.getPosition();
      audioEngine.pause();
      setGlobalPlayingFlag(false);
      set({ isPlaying: false, positionSec: position, autoPausedByFocus: false });
      persistPlaybackState(get(), { positionSec: position });
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
    audioEngine.playFrom(resumeAt);
    setGlobalPlayingFlag(true);
    set({ isPlaying: true, positionSec: resumeAt, autoPausedByFocus: false });
    persistPlaybackState(get(), { positionSec: resumeAt });
  },

  pausePlayback: () => {
    const position = audioEngine.getPosition();
    audioEngine.pause();
    setGlobalPlayingFlag(false);
    set({ isPlaying: false, positionSec: position, autoPausedByFocus: false });
    setGlobalPlaybackHints(get().currentSongId, buildUpcomingSongIds(get()));
    persistPlaybackState(get(), { positionSec: position });
  },

  resumePlayback: () => {
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
    audioEngine.playFrom(resumeAt);
    setGlobalPlayingFlag(true);
    set({ isPlaying: true, positionSec: resumeAt, autoPausedByFocus: false });
    setGlobalPlaybackHints(get().currentSongId, buildUpcomingSongIds(get()));
    persistPlaybackState(get(), { positionSec: resumeAt });
  },

  playNext: async (manual = false) => {
    const state = get();
    if (state.currentSongId) {
      void useLibraryStore.getState().recordPlaybackEvent(state.currentSongId, {
        listenedSec: state.positionSec,
        durationSec: state.durationSec,
        manualSkip: manual,
        completed: !manual,
      });
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
  },

  playPrevious: async () => {
    const state = get();

    if (state.positionSec > 4 && state.currentSongId) {
      audioEngine.seek(0);
      set({ positionSec: 0 });
      return;
    }

    const previousSongId = resolvePreviousSongId(state);
    if (!previousSongId) {
      return;
    }

    if (state.currentSongId) {
      void useLibraryStore.getState().recordPlaybackEvent(state.currentSongId, {
        listenedSec: state.positionSec,
        durationSec: state.durationSec,
        manualSkip: true,
        completed: false,
      });
    }

    await get().playSongById(previousSongId, false);
  },

  seekTo: (positionSec) => {
    audioEngine.seek(positionSec);
    set({ positionSec });
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

  setVolumeNormalizationEnabled: async (enabled) => {
    const settings = {
      ...get().settings,
      volumeNormalizationEnabled: enabled,
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setLaunchOnStartup: async (enabled) => {
    const settings = {
      ...get().settings,
      launchOnStartup: enabled,
    };

    if (isTauri()) {
      try {
        const autostart = await import('@tauri-apps/plugin-autostart');
        if (enabled) {
          await autostart.enable();
        } else {
          await autostart.disable();
        }
      } catch {
        // Ignore autostart failures; still persist local preference.
      }
    }

    set({ settings });
    await persistSettings(settings);
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
      (window as unknown as { __AMP_METADATA_PAUSED__?: boolean }).__AMP_METADATA_PAUSED__ = paused;
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
      (window as unknown as { __AMP_DISCOVERY_INTENSITY__?: number }).__AMP_DISCOVERY_INTENSITY__ = clamped;
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
      (window as unknown as { __AMP_RANDOMNESS_INTENSITY__?: number }).__AMP_RANDOMNESS_INTENSITY__ = clamped;
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
      (window as unknown as { __AMP_MIX_REGEN_PAUSED__?: boolean }).__AMP_MIX_REGEN_PAUSED__ = enabled;
    }
    await persistSettings(settings);
  },

  setAutoPauseOnFocus: async (enabled) => {
    const settings = {
      ...get().settings,
      autoPauseOnFocus: enabled,
    };

    if (!enabled && audioFocusResumeTimer) {
      window.clearTimeout(audioFocusResumeTimer);
      audioFocusResumeTimer = null;
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

  enqueueSong: (songId) => {
    void useLibraryStore.getState().recordQueueAdd(songId);
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
      const rest = hasCurrent ? base.filter((id) => id !== currentId) : base;
      for (let i = rest.length - 1; i > 0; i -= 1) {
        const swap = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[swap]] = [rest[swap], rest[i]];
      }
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
