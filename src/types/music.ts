export type RepeatMode = 'off' | 'one' | 'all';

export interface Song {
  id: string;
  path: string;
  source: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number;
  track: number;
  year?: number;
  albumArt?: string;
  addedAt: number;
  playCount: number;
  lastPlayed?: number;
  favorite: boolean;
  skipCount?: number;
  lastSkipped?: number;
  totalPlaySeconds?: number;
  lastPlayDurationSec?: number;
  lastPlayStarted?: number;
  lastCompleted?: number;
  manualQueueAdds?: number;
  lastManualQueueAdd?: number;
  replayGain?: number;
  loudnessLufs?: number;
}

export interface ListeningProfile {
  hourly: number[];
  weekday: number[];
  recentArtists: Record<string, { count: number; lastPlayed: number }>;
  recentGenres: Record<string, { count: number; lastPlayed: number }>;
  updatedAt?: number;
}

export interface ListeningActivity {
  dailySeconds: Record<string, number>;
  updatedAt?: number;
}

export interface TasteProfile {
  updatedAt: number;
  topArtists: Array<{ name: string; count: number }>;
  topGenres: Array<{ name: string; count: number }>;
  dayparts: {
    morning: number;
    afternoon: number;
    evening: number;
    night: number;
  };
  skipRate: number;
  completionRate: number;
  explorationRate: number;
}

export interface Playlist {
  id: string;
  name: string;
  type: 'smart' | 'custom' | 'daily';
  description: string;
  songIds: string[];
  artwork?: string;
  updatedAt: number;
}

export interface LyricLine {
  timeMs: number | null;
  text: string;
}

export interface AppSettings {
  libraryPath: string;
  crossfadeEnabled: boolean;
  crossfadeDurationSec: number;
  gaplessEnabled: boolean;
  volumeNormalizationEnabled: boolean;
  playbackSpeed: number;
  outputDeviceName?: string;
  eqPreset: EqPreset;
  eqBands: number[];
  launchOnStartup: boolean;
  gameMode: boolean;
  miniNowPlayingOverlay: boolean;
  overlayAutoHide: boolean;
  lyricsVisualsEnabled: boolean;
  lyricsVisualTheme: 'ember' | 'aurora' | 'mono';
  metadataFetchPaused: boolean;
  discoveryIntensity: number;
  randomnessIntensity: number;
  pauseMixRegenDuringPlayback: boolean;
  autoPauseOnFocus: boolean;
  autoPauseIgnoreApps: string[];
  autoPauseIgnoreFullscreen: boolean;
}

export type EqPreset = 'flat' | 'warm' | 'bass' | 'treble' | 'vocal' | 'club' | 'custom';

export type LibraryTab = 'songs' | 'albums' | 'artists' | 'genres';
export type NowPlayingTab = 'now-playing' | 'lyrics' | 'queue';
