export type RepeatMode = 'off' | 'one' | 'all';
export type PlaybackMode = 'order' | 'shuffle' | 'repeat';

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
  replayGain?: number;
  loudnessLufs?: number;
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
  launchOnStartup: boolean;
  gameMode: boolean;
  miniNowPlayingOverlay: boolean;
  overlayAutoHide: boolean;
  lyricsVisualsEnabled: boolean;
  lyricsVisualTheme: 'ember' | 'aurora' | 'mono';
}

export type EqPreset = 'flat' | 'warm' | 'bass' | 'treble' | 'vocal' | 'club';

export interface ListeningStats {
  totalListeningSeconds: number;
  topSongIds: string[];
  topArtistNames: string[];
  topAlbumNames: string[];
}

export type LibraryTab = 'songs' | 'albums' | 'artists' | 'genres';
export type NowPlayingTab = 'now-playing' | 'lyrics' | 'queue';
