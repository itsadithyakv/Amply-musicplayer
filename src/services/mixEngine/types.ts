import type { ListeningProfile, Playlist, Song, TasteProfile } from '@/types/music';

/** One day's output of a mix, used for the anti-repeat rules. */
export interface MixHistoryEntry {
  dayKey: string;
  songIds: string[];
}

/** mixId -> entries, newest first, at most 14 entries per mix. */
export type MixHistory = Record<string, MixHistoryEntry[]>;

export interface ListeningEvent {
  songId: string;
  /** Milliseconds since the epoch (seconds are also accepted and auto-detected). */
  at: number;
  /** 0..1 share of the track that was actually heard. */
  listenedRatio: number;
  skipped: boolean;
  source?: string;
}

export interface MixEngineInput {
  songs: Song[];
  /** Unix seconds (the unit used by `Song.lastPlayed` / `addedAt`); milliseconds are auto-detected. */
  now: number;
  /** As returned by `Date.prototype.getTimezoneOffset()`: UTC minus local, in minutes. */
  tzOffsetMinutes: number;
  weeklySeed: number;
  dailySeed: number;
  /** "Regenerate": changes every mix, including the Daily Mix. */
  regenNonce?: number;
  listeningProfile?: ListeningProfile | null;
  tasteProfile?: TasteProfile | null;
  events?: ListeningEvent[];
  history?: MixHistory;
  /** 0..1, default 0.35. Shifts the explore share of every mix by up to +-15 points. */
  discoveryIntensity?: number;
  /** 0..1, default 0.3. Controls sampling temperature and rank jitter. */
  randomnessIntensity?: number;
  librarySizeHint?: number;
}

export interface MixDiagnostics {
  mixId: string;
  poolSize: number;
  eligible: number;
  produced: number;
  reason?: string;
}

export interface MixEngineOutput {
  playlists: Playlist[];
  history: MixHistory;
  diagnostics: MixDiagnostics[];
}

export type MixFamily = 'discovery' | 'loved' | 'recent';

export type MixKind =
  | 'daily'
  | 'on_repeat'
  | 'recently_played'
  | 'recently_added'
  | 'most_played'
  | 'rediscover'
  | 'favorites'
  | 'loved_played'
  | 'quick_hits'
  | 'long_sessions'
  | 'deep_cuts'
  | 'explore'
  | 'genre'
  | 'mood';

export interface MoodDefinition {
  id: string;
  name: string;
  description: string;
  /** Normalised genre hints (tokens or phrases). At least one must match for a song to be eligible. */
  genreHints: readonly string[];
  /** Normalised title hints; only boost the rank. */
  titleHints: readonly string[];
  /** Soft preferences that make sibling moods measurably different. */
  prefs: {
    maxDuration?: number;
    minDuration?: number;
    daypart?: 0 | 1 | 2 | 3;
    favoriteBoost?: number;
    olderYearsBoost?: boolean;
  };
}

export interface MixDefinition {
  id: string;
  kind: MixKind;
  name: string;
  description: string;
  type: Playlist['type'];
  target: number;
  /** Eligible songs required before the mix is emitted (`always` mixes are emitted regardless). */
  minEligible: number;
  /** 0..100 share drawn from the familiar ("exploit") pool; the rest comes from the unfamiliar pool. */
  exploitShare: number;
  family?: MixFamily;
  /** Emitted even when empty (the UI expects these ids to exist). */
  always: boolean;
  lite: boolean;
  seedScope: 'daily' | 'weekly';
  /** Keep the rank order instead of shuffling (Recently Played). */
  ordered?: boolean;
  genre?: string;
  mood?: MoodDefinition;
}
