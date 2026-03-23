import { Howl, Howler } from 'howler';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri, toPlayableSrc } from '@/services/storageService';
import type { AppSettings, Song } from '@/types/music';

interface LoadOptions {
  autoplay?: boolean;
  transition?: boolean;
  startAtSec?: number;
}

type AudioProgressEvent = {
  position: number;
  duration: number;
};

const resolveExtension = (value: string): string | null => {
  const clean = value.split(/[?#]/)[0];
  const ext = clean.split('.').pop()?.toLowerCase();
  return ext ?? null;
};

const toFileUri = (path: string): string => {
  const normalized = path.replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }

  if (normalized.startsWith('/')) {
    return `file://${encodeURI(normalized)}`;
  }

  return encodeURI(normalized);
};

const resolveSongSources = (song: Song): string[] => {
  const candidates: string[] = [];

  if (song.path) {
    candidates.push(toPlayableSrc(song.path));
    candidates.push(toFileUri(song.path));
  }

  if (song.source) {
    candidates.push(song.source);
  }

  return Array.from(new Set(candidates.filter(Boolean)));
};

const resolveSongFormats = (song: Song): string[] | undefined => {
  const extension = resolveExtension(song.path || song.source || '');

  if (!extension) {
    return undefined;
  }

  if (extension === 'm4a' || extension === 'mp4') {
    return ['m4a', 'mp4'];
  }

  return [extension];
};

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

class NativeAudioEngine {
  private currentSong: Song | null = null;
  private currentPosition = 0;
  private currentDuration = 0;
  private isPlayingFlag = false;
  private lastProgressAt = 0;
  private onProgress: ((position: number, duration: number) => void) | null = null;
  private onEnded: (() => void) | null = null;
  private settings: AppSettings = defaultSettings;
  private masterVolume = 0.85;
  private readonly crossfadeMinDurationSec = 20;
  private readonly silenceTrimStartSec = 0.08;
  private listening = false;

  constructor() {
    if (isTauri()) {
      void this.bindNativeEvents();
    }
  }

  private async bindNativeEvents(): Promise<void> {
    if (this.listening) {
      return;
    }
    this.listening = true;

    await listen<AudioProgressEvent>('amply://audio-progress', (event) => {
      const { position, duration } = event.payload;
      this.currentPosition = position;
      this.currentDuration = duration;
      this.lastProgressAt = performance.now();
      this.onProgress?.(position, duration);
    });

    await listen('amply://audio-ended', () => {
      this.isPlayingFlag = false;
      this.onEnded?.();
    });
  }

  setCallbacks(callbacks: {
    onProgress?: (position: number, duration: number) => void;
    onEnded?: () => void;
  }): void {
    this.onProgress = callbacks.onProgress ?? null;
    this.onEnded = callbacks.onEnded ?? null;
  }

  applySettings(settings: AppSettings): void {
    const previous = this.settings;
    this.settings = settings;
    void invoke('audio_set_rate', { rate: settings.playbackSpeed });
    if (settings.outputDeviceName !== previous.outputDeviceName) {
      void invoke('audio_set_output_device', { name: settings.outputDeviceName ?? null });
    }
    if (settings.eqPreset !== previous.eqPreset) {
      void invoke('audio_set_eq_preset', { preset: settings.eqPreset });
    }
    this.refreshTrackVolumes();
  }

  setLoop(enabled: boolean): void {
    void invoke('audio_set_loop', { enabled });
  }

  getCurrentSongId(): string | null {
    return this.currentSong?.id ?? null;
  }

  getPosition(): number {
    if (this.isPlayingFlag && this.lastProgressAt > 0) {
      const delta = (performance.now() - this.lastProgressAt) / 1000;
      return Math.min(this.currentDuration || Infinity, this.currentPosition + delta);
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
      currentDuration >= this.crossfadeMinDurationSec &&
      song.duration >= this.crossfadeMinDurationSec;

    const trimmedStart =
      startAtSec > 0
        ? startAtSec
        : Math.max(0, Math.min(this.silenceTrimStartSec, song.duration * 0.02));

    const volume = this.resolveTrackVolume(song);
    const shouldAutoplay = autoplay || canCrossfade;

    if (!canCrossfade) {
      void invoke('audio_stop');
    }

    await invoke('audio_load_song', {
      path,
      autoplay: shouldAutoplay,
      transition: canCrossfade,
      startAtSec: trimmedStart,
      durationSec: song.duration,
      crossfadeDurationSec: this.settings.crossfadeDurationSec,
      crossfade: canCrossfade,
      trackVolume: volume,
    });

    this.currentSong = song;
    this.currentDuration = song.duration;
    this.currentPosition = trimmedStart;
    this.lastProgressAt = performance.now();
    this.isPlayingFlag = shouldAutoplay;
    this.onProgress?.(this.currentPosition, this.currentDuration);
  }

  preloadSong(song: Song): void {
    this.preloadSongs([song]);
  }

  preloadSongs(songs: Song[]): void {
    if (!this.settings.gaplessEnabled) {
      void invoke('audio_preload', { paths: [] });
      return;
    }

    const unique: Song[] = [];
    const seen = new Set<string>();
    for (const song of songs) {
      if (!song?.id || seen.has(song.id) || song.id === this.currentSong?.id) {
        continue;
      }
      seen.add(song.id);
      unique.push(song);
      if (unique.length >= 3) {
        break;
      }
    }

    void invoke('audio_preload', {
      paths: unique
        .map((song) => song.path)
        .filter((path): path is string => typeof path === 'string' && path.length > 0),
    });
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
    this.refreshTrackVolumes();
  }

  setRate(rate: number): void {
    void invoke('audio_set_rate', { rate });
  }

  isPlaying(): boolean {
    return this.isPlayingFlag;
  }

  private resolveTrackVolume(song: Song): number {
    if (!this.settings.volumeNormalizationEnabled || typeof song.replayGain !== 'number') {
      return this.masterVolume;
    }

    const dbGain = song.replayGain;
    const amp = Math.pow(10, dbGain / 20);
    return Math.max(0.1, Math.min(1, this.masterVolume * amp));
  }

  private refreshTrackVolumes(): void {
    if (!this.currentSong) {
      return;
    }
    const volume = this.resolveTrackVolume(this.currentSong);
    void invoke('audio_set_volume', { volume });
  }
}

class HowlerAudioEngine {
  private currentHowl: Howl | null = null;

  private fadingHowl: Howl | null = null;

  private preloadedHowls = new Map<string, Howl>();
  private preloadedMeta = new Map<string, Song>();

  private currentSong: Song | null = null;

  private progressTimer: number | null = null;
  private progressIntervalMs = 250;
  private visibilityHandler: (() => void) | null = null;

  private onProgress: ((position: number, duration: number) => void) | null = null;

  private onEnded: (() => void) | null = null;

  private loopCurrent = false;

  private pendingSeek: number | null = null;

  private loadToken = 0;

  private settings: AppSettings = defaultSettings;

  private readonly crossfadeMinDurationSec = 20;

  private readonly silenceTrimStartSec = 0.08;

  setCallbacks(callbacks: {
    onProgress?: (position: number, duration: number) => void;
    onEnded?: () => void;
  }): void {
    this.onProgress = callbacks.onProgress ?? null;
    this.onEnded = callbacks.onEnded ?? null;
  }

  applySettings(settings: AppSettings): void {
    this.settings = settings;
    if (this.currentHowl) {
      this.currentHowl.rate(settings.playbackSpeed);
    }
    this.preloadedHowls.forEach((howl) => {
      howl.rate(settings.playbackSpeed);
    });
    this.refreshTrackVolumes();
  }

  setLoop(enabled: boolean): void {
    this.loopCurrent = enabled;
    if (this.currentHowl) {
      this.currentHowl.loop(enabled);
    }
  }

  getCurrentSongId(): string | null {
    return this.currentSong?.id ?? null;
  }

  getPosition(): number {
    if (!this.currentHowl) {
      return 0;
    }

    return Number(this.currentHowl.seek() || 0);
  }

  getDuration(): number {
    return this.currentHowl?.duration() ?? 0;
  }

  async loadSong(song: Song, options: LoadOptions = {}): Promise<void> {
    const { autoplay = true, transition = true, startAtSec = 0 } = options;
    const token = (this.loadToken += 1);
    const currentDuration = this.currentHowl?.duration() ?? 0;
    const canCrossfade =
      transition &&
      this.settings.crossfadeEnabled &&
      !this.settings.gaplessEnabled &&
      currentDuration >= this.crossfadeMinDurationSec &&
      song.duration >= this.crossfadeMinDurationSec;

    if (!this.currentHowl) {
      const targetHowl = this.createHowl(song, autoplay, startAtSec);
      this.currentHowl = targetHowl;
      this.currentSong = song;
      return;
    }

    if (!canCrossfade) {
      this.stopAllSounds();
      const targetHowl = this.createHowl(song, false, startAtSec);
      this.currentHowl = targetHowl;
      this.currentSong = song;
      if (autoplay) {
        targetHowl.play();
      }
      return;
    }

    const targetHowl = this.createHowl(song, true, startAtSec);
    const oldHowl = this.currentHowl;
    this.fadingHowl = oldHowl;
    const currentVolume = oldHowl.volume();
    const fadeDurationMs = Math.max(1000, this.settings.crossfadeDurationSec * 1000);

    targetHowl.volume(0);
    targetHowl.fade(0, currentVolume, fadeDurationMs);

    oldHowl.fade(currentVolume, 0, fadeDurationMs);
    window.setTimeout(() => {
      if (this.loadToken !== token) {
        oldHowl.stop();
        oldHowl.unload();
        if (this.fadingHowl === oldHowl) {
          this.fadingHowl = null;
        }
        return;
      }
      oldHowl.stop();
      oldHowl.unload();
      if (this.fadingHowl === oldHowl) {
        this.fadingHowl = null;
      }
    }, fadeDurationMs + 50);

    this.currentHowl = targetHowl;
    this.currentSong = song;
  }

  preloadSong(song: Song): void {
    this.preloadSongs([song]);
  }

  preloadSongs(songs: Song[]): void {
    if (!this.settings.gaplessEnabled) {
      this.preloadedHowls.forEach((howl) => howl.unload());
      this.preloadedHowls.clear();
      this.preloadedMeta.clear();
      return;
    }

    const unique: Song[] = [];
    const seen = new Set<string>();
    for (const song of songs) {
      if (!song?.id || seen.has(song.id) || song.id === this.currentSong?.id) {
        continue;
      }
      seen.add(song.id);
      unique.push(song);
      if (unique.length >= 3) {
        break;
      }
    }

    const nextIds = new Set(unique.map((song) => song.id));
    this.preloadedHowls.forEach((howl, id) => {
      if (!nextIds.has(id)) {
        howl.unload();
        this.preloadedHowls.delete(id);
        this.preloadedMeta.delete(id);
      }
    });

    unique.forEach((song) => {
      if (this.preloadedHowls.has(song.id)) {
        return;
      }
      const howl = new Howl({
        src: resolveSongSources(song),
        format: resolveSongFormats(song),
        html5: true,
        preload: true,
        volume: 0,
        rate: this.settings.playbackSpeed,
      });
      this.preloadedHowls.set(song.id, howl);
      this.preloadedMeta.set(song.id, song);
    });
  }

  play(): void {
    if (!this.currentHowl || this.currentHowl.playing()) {
      return;
    }
    this.currentHowl.play();
  }

  playFrom(positionSec: number): void {
    if (!this.currentHowl) {
      return;
    }

    if (this.currentHowl.playing()) {
      this.currentHowl.seek(positionSec);
      return;
    }

    this.stopOtherHowls(this.currentHowl);
    this.pendingSeek = positionSec;
    this.currentHowl.play();
    if (this.currentHowl.playing()) {
      this.currentHowl.seek(positionSec);
      this.pendingSeek = null;
    }
  }

  pause(): void {
    this.currentHowl?.pause();
    if (this.fadingHowl) {
      this.fadingHowl.stop();
      this.fadingHowl.unload();
      this.fadingHowl = null;
    }
    this.preloadedHowls.forEach((howl) => {
      if (howl.playing()) {
        howl.stop();
      }
    });
  }

  stop(): void {
    this.currentHowl?.stop();
    if (this.fadingHowl) {
      this.fadingHowl.stop();
      this.fadingHowl.unload();
      this.fadingHowl = null;
    }
    this.stopProgressLoop();
  }

  seek(positionSec: number): void {
    this.currentHowl?.seek(positionSec);
    this.publishProgress();
  }

  setVolume(volume: number): void {
    Howler.volume(volume);
    this.refreshTrackVolumes();
  }

  setRate(rate: number): void {
    this.currentHowl?.rate(rate);
  }

  isPlaying(): boolean {
    return this.currentHowl?.playing() ?? false;
  }

  private createHowl(song: Song, autoplay: boolean, startAtSec: number): Howl {
    const normalizedVolume = this.resolveTrackVolume(song);
    const preloaded = this.takePreloadedHowl(song.id);
    if (preloaded) {
      this.attachHowlHandlers(preloaded, song, startAtSec);
      preloaded.volume(normalizedVolume);
      preloaded.rate(this.settings.playbackSpeed);
      preloaded.loop(this.loopCurrent);
      if (autoplay) {
        preloaded.play();
      }
      return preloaded;
    }

    const sources = resolveSongSources(song);
    const formats = resolveSongFormats(song);

    const howl = new Howl({
      src: sources,
      format: formats,
      html5: true,
      preload: true,
      autoplay,
      volume: normalizedVolume,
      rate: this.settings.playbackSpeed,
      loop: this.loopCurrent,
    });

    this.attachHowlHandlers(howl, song, startAtSec);
    return howl;
  }

  private takePreloadedHowl(songId: string): Howl | null {
    const howl = this.preloadedHowls.get(songId) ?? null;
    if (howl) {
      this.preloadedHowls.delete(songId);
      this.preloadedMeta.delete(songId);
    }
    return howl;
  }

  private attachHowlHandlers(howl: Howl, song: Song, startAtSec: number): void {
    howl.off();
    howl.on('load', () => {
      this.publishProgress();
    });
    howl.on('play', () => {
      if (this.pendingSeek !== null) {
        howl.seek(this.pendingSeek);
        this.pendingSeek = null;
      } else if (startAtSec > 0) {
        howl.seek(startAtSec);
      } else {
        const trimmedStart = Math.max(0, Math.min(this.silenceTrimStartSec, song.duration * 0.02));
        if (trimmedStart > 0) {
          howl.seek(trimmedStart);
        }
      }
      this.startProgressLoop();
    });
    howl.on('playerror', (_soundId, error) => {
      console.error('[Amply] Play error', song.path, error);
      howl.once('unlock', () => {
        howl.play();
      });
    });
    howl.on('loaderror', (_soundId, error) => {
      console.error('[Amply] Load error', song.path, error);
    });
    howl.on('pause', () => {
      this.stopProgressLoop();
    });
    howl.on('stop', () => {
      this.stopProgressLoop();
    });
    howl.on('end', () => {
      if (this.loopCurrent) {
        return;
      }
      this.stopProgressLoop();
      this.onEnded?.();
    });
  }

  private stopOtherHowls(keep?: Howl): void {
    if (this.currentHowl && this.currentHowl !== keep) {
      this.currentHowl.stop();
      this.currentHowl.unload();
    }

    if (this.fadingHowl && this.fadingHowl !== keep) {
      this.fadingHowl.stop();
      this.fadingHowl.unload();
      this.fadingHowl = null;
    }

    this.preloadedHowls.forEach((howl) => {
      if (howl !== keep && howl.playing()) {
        howl.stop();
      }
    });
  }

  private stopAllSounds(): void {
    Howler.stop();
    if (this.currentHowl) {
      this.currentHowl.unload();
    }
    if (this.fadingHowl) {
      this.fadingHowl.unload();
      this.fadingHowl = null;
    }
    this.preloadedHowls.forEach((howl) => howl.unload());
    this.preloadedHowls.clear();
  }

  private resolveTrackVolume(song: Song): number {
    if (!this.settings.volumeNormalizationEnabled || typeof song.replayGain !== 'number') {
      return Howler.volume();
    }

    const dbGain = song.replayGain;
    const amp = Math.pow(10, dbGain / 20);
    return Math.max(0.1, Math.min(1, Howler.volume() * amp));
  }

  private refreshTrackVolumes(): void {
    const current = this.currentSong;
    if (current && this.currentHowl) {
      this.currentHowl.volume(this.resolveTrackVolume(current));
    }

    this.preloadedHowls.forEach((howl, id) => {
      const song = this.preloadedMeta.get(id);
      if (song) {
        howl.volume(this.resolveTrackVolume(song));
      }
    });
  }

  private startProgressLoop(): void {
    if (this.progressTimer) {
      window.clearInterval(this.progressTimer);
    }
    const resolveInterval = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return 1000;
      }
      return 250;
    };
    this.progressIntervalMs = resolveInterval();
    this.progressTimer = window.setInterval(() => {
      this.publishProgress();
    }, this.progressIntervalMs);

    if (!this.visibilityHandler && typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        const next = resolveInterval();
        if (next !== this.progressIntervalMs) {
          this.startProgressLoop();
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  private publishProgress(): void {
    if (!this.currentHowl || !this.onProgress) {
      return;
    }

    this.onProgress(Number(this.currentHowl.seek() || 0), this.currentHowl.duration() || 0);
  }

  private stopProgressLoop(): void {
    if (!this.progressTimer) {
      return;
    }

    window.clearInterval(this.progressTimer);
    this.progressTimer = null;
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }
}

export const audioEngine = isTauri() ? new NativeAudioEngine() : new HowlerAudioEngine();
