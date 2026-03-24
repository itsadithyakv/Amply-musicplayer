import { create } from 'zustand';
import type { AppSettings, NowPlayingTab, RepeatMode } from '@/types/music';
import { audioEngine } from '@/services/audioEngine';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauri, readStorageJson, writeStorageJson } from '@/services/storageService';
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
  initialize: () => Promise<void>;
  setQueue: (songIds: string[], startSongId?: string) => void;
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
  launchOnStartup: false,
  gameMode: false,
  miniNowPlayingOverlay: false,
  overlayAutoHide: true,
  lyricsVisualsEnabled: true,
  lyricsVisualTheme: 'ember',
  metadataFetchPaused: false,
};

let sleepTimerHandle: number | null = null;
let progressFlushHandle: number | null = null;
let lastProgressUpdate = 0;
let pendingProgress: { position: number; duration: number } | null = null;
const PROGRESS_UPDATE_MS = 250;
let lastPreloadSongId: string | null = null;

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

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    const persisted = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
    let settings: AppSettings = {
      ...defaultSettings,
      ...persisted,
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

    audioEngine.setCallbacks({
      onProgress: (position, duration) => {
        const currentId = get().currentSongId;
        if (
          currentId &&
          duration > 0 &&
          position / duration >= 0.75 &&
          (lastPreloadSongId !== currentId || position < duration * 0.9)
        ) {
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
        await get().playNext();
      },
    });

    audioEngine.applySettings(settings);
    audioEngine.setVolume(get().volume);
    if (typeof window !== 'undefined') {
      (window as unknown as { __AMP_METADATA_PAUSED__?: boolean }).__AMP_METADATA_PAUSED__ = settings.metadataFetchPaused;
    }

    set({ initialized: true, settings });
  },

  setQueue: (songIds, startSongId) => {
    const startIndex = startSongId ? Math.max(0, songIds.indexOf(startSongId)) : 0;
    set({
      queueSongIds: songIds,
      queueCursor: startIndex,
      albumQueueView: null,
    });
    const nextState = get();
    const preloadIds = buildUpcomingSongIds(nextState, getPreloadCount());
    setGlobalPlaybackHints(nextState.currentSongId, preloadIds);
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
          void useLibraryStore.getState().fetchMissingMetadataForSong(songId);
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
      set({ isPlaying: false, positionSec: position });
      return;
    }

    const songId = get().currentSongId;
    if (!songId) {
      const library = useLibraryStore.getState();
      const dailyMix = library.playlists.find((playlist) => playlist.id === 'smart_daily_mix');
      const dailyFirst = dailyMix?.songIds?.[0];
      if (dailyMix?.songIds?.length) {
        get().setQueue(dailyMix.songIds, dailyFirst);
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
    set({ isPlaying: true, positionSec: resumeAt });
  },

  pausePlayback: () => {
    const position = audioEngine.getPosition();
    audioEngine.pause();
    setGlobalPlayingFlag(false);
    set({ isPlaying: false, positionSec: position });
    setGlobalPlaybackHints(get().currentSongId, buildUpcomingSongIds(get()));
  },

  resumePlayback: () => {
    const songId = get().currentSongId;
    if (!songId) {
      const library = useLibraryStore.getState();
      const dailyMix = library.playlists.find((playlist) => playlist.id === 'smart_daily_mix');
      const dailyFirst = dailyMix?.songIds?.[0];
      if (dailyMix?.songIds?.length) {
        get().setQueue(dailyMix.songIds, dailyFirst);
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
    set({ isPlaying: true, positionSec: resumeAt });
    setGlobalPlaybackHints(get().currentSongId, buildUpcomingSongIds(get()));
  },

  playNext: async (manual = false) => {
    const state = get();
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
    audioEngine.setRate(clamped);
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
    const settings = {
      ...get().settings,
      eqPreset: preset,
    };
    audioEngine.applySettings(settings);
    set({ settings });
    await persistSettings(settings);
  },

  setCrossfadeEnabled: async (enabled) => {
    const settings = {
      ...get().settings,
      crossfadeEnabled: enabled,
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

  setSleepTimer: (minutes) => {
    if (sleepTimerHandle) {
      window.clearTimeout(sleepTimerHandle);
      sleepTimerHandle = null;
    }

    if (!minutes || minutes <= 0) {
      set({ sleepTimerEndsAt: null, sleepTimerDurationMin: null });
      return;
    }

    const target = Date.now() + minutes * 60_000;
    sleepTimerHandle = window.setTimeout(() => {
      audioEngine.pause();
      setGlobalPlayingFlag(false);
      set({ isPlaying: false, sleepTimerEndsAt: null });
    }, minutes * 60_000);

    set({ sleepTimerEndsAt: target, sleepTimerDurationMin: minutes });
  },

  enqueueSong: (songId) => {
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
