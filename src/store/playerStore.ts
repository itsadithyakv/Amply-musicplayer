import { create } from 'zustand';
import type { AppSettings, NowPlayingTab, PlaybackMode, RepeatMode } from '@/types/music';
import { audioEngine } from '@/services/audioEngine';
import { useLibraryStore } from '@/store/libraryStore';
import { isTauri, readStorageJson, writeStorageJson } from '@/services/storageService';

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
  settings: AppSettings;
  sleepTimerEndsAt: number | null;
  initialize: () => Promise<void>;
  setQueue: (songIds: string[], startSongId?: string) => void;
  playSongById: (songId: string, transition?: boolean) => Promise<void>;
  togglePlayPause: () => void;
  playNext: () => Promise<void>;
  playPrevious: () => Promise<void>;
  seekTo: (positionSec: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  cyclePlaybackMode: () => void;
  setNowPlayingTab: (tab: NowPlayingTab) => void;
  setPlaybackSpeed: (speed: number) => Promise<void>;
  setCrossfadeEnabled: (enabled: boolean) => Promise<void>;
  setCrossfadeDuration: (durationSec: number) => Promise<void>;
  setGaplessEnabled: (enabled: boolean) => Promise<void>;
  setVolumeNormalizationEnabled: (enabled: boolean) => Promise<void>;
  setLaunchOnStartup: (enabled: boolean) => Promise<void>;
  setLyricsVisualsEnabled: (enabled: boolean) => Promise<void>;
  setLyricsVisualTheme: (theme: AppSettings['lyricsVisualTheme']) => Promise<void>;
  setSleepTimer: (minutes: number | null) => void;
  enqueueSong: (songId: string) => void;
  removeQueuedSong: (songId: string) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
}

const defaultSettings: AppSettings = {
  libraryPath: 'music',
  crossfadeEnabled: true,
  crossfadeDurationSec: 6,
  gaplessEnabled: true,
  volumeNormalizationEnabled: true,
  playbackSpeed: 1,
  launchOnStartup: false,
  lyricsVisualsEnabled: true,
  lyricsVisualTheme: 'ember',
};

let sleepTimerHandle: number | null = null;

const resolvePlaybackMode = (state: Pick<PlayerState, 'shuffleEnabled' | 'repeatMode'>): PlaybackMode => {
  if (state.shuffleEnabled) {
    return 'shuffle';
  }

  if (state.repeatMode === 'all' || state.repeatMode === 'one') {
    return 'repeat';
  }

  return 'order';
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
  settings: defaultSettings,
  sleepTimerEndsAt: null,

  initialize: async () => {
    if (get().initialized) {
      return;
    }

    const persisted = await readStorageJson<Partial<AppSettings>>('settings.json', {});
    let settings: AppSettings = {
      ...defaultSettings,
      ...persisted,
    };

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
        set({ positionSec: position, durationSec: duration });
      },
      onEnded: async () => {
        await get().playNext();
      },
    });

    audioEngine.applySettings(settings);
    audioEngine.setVolume(get().volume);

    set({ initialized: true, settings });
  },

  setQueue: (songIds, startSongId) => {
    const startIndex = startSongId ? Math.max(0, songIds.indexOf(startSongId)) : 0;
    set({
      queueSongIds: songIds,
      queueCursor: startIndex,
    });
  },

  playSongById: async (songId, transition = true) => {
    const song = useLibraryStore.getState().getSongById(songId);
    if (!song) {
      return;
    }

    const state = get();

    await audioEngine.loadSong(song, {
      autoplay: true,
      transition,
      startAtSec: 0,
    });

    const queueCursor = state.queueSongIds.indexOf(songId);
    const updatedHistory = [...state.historySongIds, songId].slice(-100);
    const nextSongId = resolveNextSongId({ ...state, currentSongId: songId, queueCursor });

    if (nextSongId) {
      const nextSong = useLibraryStore.getState().getSongById(nextSongId);
      if (nextSong) {
        audioEngine.preloadSong(nextSong);
      }
    }

    set({
      currentSongId: songId,
      queueCursor: queueCursor >= 0 ? queueCursor : state.queueCursor,
      isPlaying: true,
      positionSec: 0,
      durationSec: song.duration,
      historySongIds: updatedHistory,
      manualQueueSongIds:
        state.manualQueueSongIds[0] === songId ? state.manualQueueSongIds.slice(1) : state.manualQueueSongIds,
    });

    await useLibraryStore.getState().recordSongPlay(songId);
    void useLibraryStore.getState().refreshSongGenreIfUnknown(songId);
  },

  togglePlayPause: () => {
    const playing = audioEngine.isPlaying();
    if (playing) {
      audioEngine.pause();
      set({ isPlaying: false });
      return;
    }

    const songId = get().currentSongId;
    if (!songId) {
      const first = get().queueSongIds[0] ?? useLibraryStore.getState().songs[0]?.id;
      if (first) {
        void get().playSongById(first, false);
      }
      return;
    }

    audioEngine.play();
    set({ isPlaying: true });
  },

  playNext: async () => {
    const state = get();
    const nextSongId = resolveNextSongId(state);

    if (!nextSongId) {
      set({ isPlaying: false, positionSec: 0 });
      return;
    }

    await get().playSongById(nextSongId);
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

    await get().playSongById(previousSongId);
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

  toggleShuffle: () => {
    set((state) => {
      const nextShuffle = !state.shuffleEnabled;
      return {
        shuffleEnabled: nextShuffle,
        repeatMode: nextShuffle ? 'off' : state.repeatMode,
      };
    });
  },

  cycleRepeat: () => {
    set((state) => {
      const repeatMode: RepeatMode = state.repeatMode === 'off' ? 'all' : 'off';
      return {
        repeatMode,
        shuffleEnabled: repeatMode !== 'off' ? false : state.shuffleEnabled,
      };
    });
  },

  cyclePlaybackMode: () => {
    set((state) => {
      const mode = resolvePlaybackMode(state);
      if (mode === 'order') {
        return { shuffleEnabled: true, repeatMode: 'off' as RepeatMode };
      }

      if (mode === 'shuffle') {
        return { shuffleEnabled: false, repeatMode: 'all' as RepeatMode };
      }

      return { shuffleEnabled: false, repeatMode: 'off' as RepeatMode };
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

  setSleepTimer: (minutes) => {
    if (sleepTimerHandle) {
      window.clearTimeout(sleepTimerHandle);
      sleepTimerHandle = null;
    }

    if (!minutes || minutes <= 0) {
      set({ sleepTimerEndsAt: null });
      return;
    }

    const target = Date.now() + minutes * 60_000;
    sleepTimerHandle = window.setTimeout(() => {
      audioEngine.pause();
      set({ isPlaying: false, sleepTimerEndsAt: null });
    }, minutes * 60_000);

    set({ sleepTimerEndsAt: target });
  },

  enqueueSong: (songId) => {
    set((state) => ({
      manualQueueSongIds: state.manualQueueSongIds.includes(songId)
        ? state.manualQueueSongIds
        : [...state.manualQueueSongIds, songId],
    }));
  },

  removeQueuedSong: (songId) => {
    set((state) => ({
      manualQueueSongIds: state.manualQueueSongIds.filter((id) => id !== songId),
    }));
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
}));
