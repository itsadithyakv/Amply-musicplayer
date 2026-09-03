import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from '@/services/storageService';
import { DEFAULT_SETTINGS } from '@/store/defaultSettings';
import type { AppSettings, Song } from '@/types/music';

export interface LoadOptions {
  autoplay?: boolean;
  transition?: boolean;
  startAtSec?: number;
}

export interface AudioEngineCallbacks {
  onProgress?: (position: number, duration: number) => void;
  onEnded?: () => void;
}

/** Contract shared by the native (Tauri) engine and the browser stub. */
export interface AudioEngine {
  setCallbacks(callbacks: AudioEngineCallbacks): void;
  applySettings(settings: AppSettings): void;
  setLoop(enabled: boolean): void;
  getCurrentSongId(): string | null;
  getPosition(): number;
  getDuration(): number;
  loadSong(song: Song, options?: LoadOptions): Promise<void>;
  preloadSongs(songs: Song[]): void;
  play(): void;
  playFrom(positionSec: number): void;
  pause(): void;
  stop(): void;
  seek(positionSec: number): void;
  setVolume(volume: number): void;
  setRate(rate: number): void;
  isPlaying(): boolean;
  dispose(): void;
}

type AudioProgressEvent = {
  position: number;
  duration: number;
};

const CROSSFADE_MIN_DURATION_SEC = 20;
const SILENCE_TRIM_START_SEC = 0.08;

const resolveStartOffset = (song: Song, startAtSec: number): number =>
  startAtSec > 0 ? startAtSec : Math.max(0, Math.min(SILENCE_TRIM_START_SEC, song.duration * 0.02));

/**
 * Playback through the Rust engine (rodio). Progress and ended events arrive as Tauri events.
 * Position is interpolated between ticks and scaled by the playback rate.
 */
class NativeAudioEngine implements AudioEngine {
  private currentSong: Song | null = null;
  private currentPosition = 0;
  private currentDuration = 0;
  private isPlayingFlag = false;
  private lastProgressAt = 0;
  private onProgress: AudioEngineCallbacks['onProgress'] | null = null;
  private onEnded: AudioEngineCallbacks['onEnded'] | null = null;
  private settings: AppSettings = DEFAULT_SETTINGS;
  private masterVolume = 0.85;
  private unlisten: UnlistenFn[] = [];
  private bindPromise: Promise<void>;

  constructor() {
    this.bindPromise = this.bindNativeEvents();
  }

  private async bindNativeEvents(): Promise<void> {
    const offProgress = await listen<AudioProgressEvent>('amply://audio-progress', (event) => {
      const { position, duration } = event.payload;
      this.currentPosition = position;
      this.currentDuration = duration;
      this.lastProgressAt = performance.now();
      this.onProgress?.(position, duration);
    });
    const offEnded = await listen('amply://audio-ended', () => {
      this.isPlayingFlag = false;
      this.onEnded?.();
    });
    this.unlisten.push(offProgress, offEnded);
  }

  setCallbacks(callbacks: AudioEngineCallbacks): void {
    this.onProgress = callbacks.onProgress ?? null;
    this.onEnded = callbacks.onEnded ?? null;
  }

  applySettings(settings: AppSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (settings.playbackSpeed !== previous.playbackSpeed) {
      void invoke('audio_set_rate', { rate: settings.playbackSpeed });
    }
    if (settings.outputDeviceName !== previous.outputDeviceName) {
      void invoke('audio_set_output_device', { name: settings.outputDeviceName ?? null });
    }
    if (settings.eqBands.join(',') !== previous.eqBands.join(',')) {
      void invoke('audio_set_eq_gains', { gains: settings.eqBands });
    }
    if (settings.lyricsVisualsEnabled !== previous.lyricsVisualsEnabled) {
      void invoke('audio_set_visualizer_enabled', { enabled: settings.lyricsVisualsEnabled });
    }
    this.refreshTrackVolume();
  }

  setLoop(enabled: boolean): void {
    void invoke('audio_set_loop', { enabled });
  }

  getCurrentSongId(): string | null {
    return this.currentSong?.id ?? null;
  }

  getPosition(): number {
    if (this.isPlayingFlag && this.lastProgressAt > 0) {
      const elapsed = ((performance.now() - this.lastProgressAt) / 1000) * (this.settings.playbackSpeed || 1);
      return Math.min(this.currentDuration || Infinity, this.currentPosition + elapsed);
    }
    return this.currentPosition;
  }

  getDuration(): number {
    return this.currentDuration;
  }

  async loadSong(song: Song, options: LoadOptions = {}): Promise<void> {
    const { autoplay = true, transition = true, startAtSec = 0 } = options;
    const path = song.path || song.source;
    if (!path) {
      return;
    }
    const currentDuration = this.currentSong?.duration ?? 0;
    const canCrossfade =
      transition &&
      this.settings.crossfadeEnabled &&
      !this.settings.gaplessEnabled &&
      currentDuration >= CROSSFADE_MIN_DURATION_SEC &&
      song.duration >= CROSSFADE_MIN_DURATION_SEC;

    const startOffset = resolveStartOffset(song, startAtSec);
    const shouldAutoplay = autoplay || canCrossfade;

    if (!canCrossfade && !this.settings.gaplessEnabled) {
      void invoke('audio_stop');
    }

    await invoke('audio_load_song', {
      path,
      autoplay: shouldAutoplay,
      transition: canCrossfade,
      startAtSec: startOffset,
      durationSec: song.duration,
      crossfadeDurationSec: this.settings.crossfadeDurationSec,
      crossfade: canCrossfade,
      trackVolume: this.resolveTrackVolume(song),
      gaplessEnabled: this.settings.gaplessEnabled,
    });

    this.currentSong = song;
    this.currentDuration = song.duration;
    this.currentPosition = startOffset;
    this.lastProgressAt = performance.now();
    this.isPlayingFlag = shouldAutoplay;
    this.onProgress?.(this.currentPosition, this.currentDuration);
  }

  preloadSongs(songs: Song[]): void {
    if (!this.settings.gaplessEnabled) {
      void invoke('audio_preload', { paths: [] });
      return;
    }
    const seen = new Set<string>();
    const paths: string[] = [];
    for (const song of songs) {
      if (!song?.id || seen.has(song.id) || song.id === this.currentSong?.id || !song.path) {
        continue;
      }
      seen.add(song.id);
      paths.push(song.path);
      if (paths.length >= 2) {
        break;
      }
    }
    void invoke('audio_preload', { paths });
  }

  play(): void {
    void invoke('audio_play');
    this.isPlayingFlag = true;
    this.lastProgressAt = performance.now();
  }

  playFrom(positionSec: number): void {
    void invoke('audio_play_from', { positionSec });
    this.isPlayingFlag = true;
    this.currentPosition = positionSec;
    this.lastProgressAt = performance.now();
  }

  pause(): void {
    void invoke('audio_pause');
    this.isPlayingFlag = false;
  }

  stop(): void {
    void invoke('audio_stop');
    this.isPlayingFlag = false;
    this.currentPosition = 0;
  }

  seek(positionSec: number): void {
    void invoke('audio_seek', { positionSec });
    this.currentPosition = positionSec;
    this.lastProgressAt = performance.now();
    this.onProgress?.(positionSec, this.currentDuration);
  }

  setVolume(volume: number): void {
    this.masterVolume = volume;
    this.refreshTrackVolume();
  }

  setRate(rate: number): void {
    void invoke('audio_set_rate', { rate });
  }

  isPlaying(): boolean {
    return this.isPlayingFlag;
  }

  dispose(): void {
    void this.bindPromise.then(() => {
      this.unlisten.forEach((fn) => fn());
      this.unlisten = [];
    });
    this.onProgress = null;
    this.onEnded = null;
  }

  private resolveTrackVolume(_song: Song): number {
    return this.masterVolume;
  }

  private refreshTrackVolume(): void {
    if (!this.currentSong) {
      return;
    }
    void invoke('audio_set_volume', { volume: this.resolveTrackVolume(this.currentSong) });
  }
}

/**
 * Browser-mode stub (plain `vite dev`, tests). Produces no sound; advances a fake clock so
 * transport UI, progress and auto-advance keep working.
 */
class SilentAudioEngine implements AudioEngine {
  private currentSong: Song | null = null;
  private position = 0;
  private duration = 0;
  private playing = false;
  private rate = 1;
  private loop = false;
  private timer: number | null = null;
  private lastTickAt = 0;
  private onProgress: AudioEngineCallbacks['onProgress'] | null = null;
  private onEnded: AudioEngineCallbacks['onEnded'] | null = null;

  setCallbacks(callbacks: AudioEngineCallbacks): void {
    this.onProgress = callbacks.onProgress ?? null;
    this.onEnded = callbacks.onEnded ?? null;
  }

  applySettings(settings: AppSettings): void {
    this.rate = settings.playbackSpeed || 1;
  }

  setLoop(enabled: boolean): void {
    this.loop = enabled;
  }

  getCurrentSongId(): string | null {
    return this.currentSong?.id ?? null;
  }

  getPosition(): number {
    return this.position;
  }

  getDuration(): number {
    return this.duration;
  }

  async loadSong(song: Song, options: LoadOptions = {}): Promise<void> {
    const { autoplay = true, startAtSec = 0 } = options;
    this.currentSong = song;
    this.duration = song.duration || 0;
    this.position = resolveStartOffset(song, startAtSec);
    this.onProgress?.(this.position, this.duration);
    if (autoplay) {
      this.play();
    } else {
      this.pause();
    }
  }

  preloadSongs(): void {}

  play(): void {
    if (!this.currentSong) {
      return;
    }
    this.playing = true;
    this.lastTickAt = performance.now();
    if (this.timer === null) {
      this.timer = window.setInterval(() => this.tick(), 250);
    }
  }

  playFrom(positionSec: number): void {
    this.position = positionSec;
    this.play();
  }

  pause(): void {
    this.playing = false;
    this.clearTimer();
  }

  stop(): void {
    this.pause();
    this.position = 0;
  }

  seek(positionSec: number): void {
    this.position = Math.max(0, Math.min(this.duration || positionSec, positionSec));
    this.lastTickAt = performance.now();
    this.onProgress?.(this.position, this.duration);
  }

  setVolume(): void {}

  setRate(rate: number): void {
    this.rate = rate || 1;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  dispose(): void {
    this.clearTimer();
    this.onProgress = null;
    this.onEnded = null;
  }

  private tick(): void {
    if (!this.playing) {
      return;
    }
    const now = performance.now();
    this.position += ((now - this.lastTickAt) / 1000) * this.rate;
    this.lastTickAt = now;
    if (this.duration > 0 && this.position >= this.duration) {
      if (this.loop) {
        this.position = 0;
      } else {
        this.position = this.duration;
        this.playing = false;
        this.clearTimer();
        this.onProgress?.(this.position, this.duration);
        this.onEnded?.();
        return;
      }
    }
    this.onProgress?.(this.position, this.duration);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

export const audioEngine: AudioEngine = isTauri() ? new NativeAudioEngine() : new SilentAudioEngine();
