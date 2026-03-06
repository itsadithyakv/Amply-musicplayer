import { Howl, Howler } from 'howler';
import { toPlayableSrc } from '@/services/storageService';
import type { AppSettings, Song } from '@/types/music';

interface LoadOptions {
  autoplay?: boolean;
  transition?: boolean;
  startAtSec?: number;
}

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

class AudioEngine {
  private currentHowl: Howl | null = null;

  private preloadedHowl: Howl | null = null;

  private currentSong: Song | null = null;

  private progressTimer: number | null = null;

  private onProgress: ((position: number, duration: number) => void) | null = null;

  private onEnded: (() => void) | null = null;

  private settings: AppSettings = {
    libraryPath: 'music',
    crossfadeEnabled: true,
    crossfadeDurationSec: 6,
    gaplessEnabled: true,
    volumeNormalizationEnabled: true,
    playbackSpeed: 1,
  };

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
    const targetHowl = this.createHowl(song, autoplay, startAtSec);

    if (!this.currentHowl) {
      this.currentHowl = targetHowl;
      this.currentSong = song;
      return;
    }

    if (!transition || !this.settings.crossfadeEnabled) {
      this.currentHowl.stop();
      this.currentHowl.unload();
      this.currentHowl = targetHowl;
      this.currentSong = song;
      return;
    }

    const oldHowl = this.currentHowl;
    const currentVolume = oldHowl.volume();
    const fadeDurationMs = Math.max(1000, this.settings.crossfadeDurationSec * 1000);

    targetHowl.volume(0);
    if (autoplay) {
      targetHowl.play();
    }
    targetHowl.fade(0, currentVolume, fadeDurationMs);

    oldHowl.fade(currentVolume, 0, fadeDurationMs);
    window.setTimeout(() => {
      oldHowl.stop();
      oldHowl.unload();
    }, fadeDurationMs + 50);

    this.currentHowl = targetHowl;
    this.currentSong = song;
  }

  preloadSong(song: Song): void {
    if (!this.settings.gaplessEnabled) {
      return;
    }

    if (this.preloadedHowl) {
      this.preloadedHowl.unload();
      this.preloadedHowl = null;
    }

    this.preloadedHowl = new Howl({
      src: resolveSongSources(song),
      format: resolveSongFormats(song),
      html5: true,
      preload: true,
      volume: 0,
      rate: this.settings.playbackSpeed,
    });
  }

  play(): void {
    this.currentHowl?.play();
  }

  pause(): void {
    this.currentHowl?.pause();
  }

  stop(): void {
    this.currentHowl?.stop();
    this.stopProgressLoop();
  }

  seek(positionSec: number): void {
    this.currentHowl?.seek(positionSec);
    this.publishProgress();
  }

  setVolume(volume: number): void {
    Howler.volume(volume);
  }

  setRate(rate: number): void {
    this.currentHowl?.rate(rate);
  }

  isPlaying(): boolean {
    return this.currentHowl?.playing() ?? false;
  }

  private createHowl(song: Song, autoplay: boolean, startAtSec: number): Howl {
    const normalizedVolume = this.resolveTrackVolume(song);
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
      onload: () => {
        this.publishProgress();
      },
      onplay: () => {
        if (startAtSec > 0) {
          howl.seek(startAtSec);
        }
        this.startProgressLoop();
      },
      onplayerror: (_soundId, error) => {
        console.error('[Amply] Play error', song.path, error);
        howl.once('unlock', () => {
          howl.play();
        });
      },
      onloaderror: (_soundId, error) => {
        console.error('[Amply] Load error', song.path, error);
      },
      onpause: () => {
        this.stopProgressLoop();
      },
      onstop: () => {
        this.stopProgressLoop();
      },
      onend: () => {
        this.stopProgressLoop();
        this.onEnded?.();
      },
    });

    return howl;
  }

  private resolveTrackVolume(song: Song): number {
    if (!this.settings.volumeNormalizationEnabled || typeof song.replayGain !== 'number') {
      return Howler.volume();
    }

    const dbGain = song.replayGain;
    const amp = Math.pow(10, dbGain / 20);
    return Math.max(0.15, Math.min(1, Howler.volume() * amp));
  }

  private startProgressLoop(): void {
    if (this.progressTimer) {
      window.clearInterval(this.progressTimer);
    }

    this.progressTimer = window.setInterval(() => {
      this.publishProgress();
    }, 250);
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
  }
}

export const audioEngine = new AudioEngine();
