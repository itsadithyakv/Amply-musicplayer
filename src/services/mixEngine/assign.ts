import type { MixFamily, MixKind } from './types';

/** A song may appear in at most this many mixes. */
export const MAX_MIXES_PER_SONG = 2;

/** Below this many songs there are too few to go round two mixes each, so each may sit in three. */
export const SMALL_LIBRARY_SONGS = 300;

export const maxMixesPerSongFor = (librarySize: number): number =>
  librarySize < SMALL_LIBRARY_SONGS ? MAX_MIXES_PER_SONG + 1 : MAX_MIXES_PER_SONG;

/** Mixes in the same family never share a song. */
export const FAMILY_OF: Partial<Record<MixKind, MixFamily>> = {
  explore: 'discovery',
  deep_cuts: 'discovery',
  rediscover: 'discovery',
  favorites: 'loved',
  loved_played: 'loved',
  recently_played: 'recent',
  on_repeat: 'recent',
};

/**
 * Greedy cross-mix exclusivity state. Mixes are resolved in priority order; each asks
 * `canUse` while walking its candidates and `note`s what it kept.
 */
export interface AssignmentState {
  useCount: Map<string, number>;
  families: Map<string, Set<MixFamily>>;
  /**
   * Songs reserved for the Daily Mix. Other mixes may use each of them once at most, which
   * guarantees Daily a slot for every reserved song without Daily's own picks influencing them.
   */
  reserved: Set<string>;
  /** How many mixes a song may sit in; see `maxMixesPerSongFor`. */
  cap: number;
}

export const createAssignmentState = (cap: number = MAX_MIXES_PER_SONG): AssignmentState => ({
  useCount: new Map(),
  families: new Map(),
  reserved: new Set(),
  cap,
});

export const canUse = (
  state: AssignmentState,
  songId: string,
  family: MixFamily | undefined,
  forDaily = false,
  /** Favorites: the songs the user chose always belong in it, however many mixes they are in. */
  ignoreCap = false,
): boolean => {
  const used = state.useCount.get(songId) ?? 0;
  if (!ignoreCap && used >= state.cap) {
    return false;
  }
  if (!ignoreCap && !forDaily && used >= state.cap - 1 && state.reserved.has(songId)) {
    return false;
  }
  if (family && state.families.get(songId)?.has(family)) {
    return false;
  }
  return true;
};

export const noteUse = (state: AssignmentState, songId: string, family: MixFamily | undefined): void => {
  state.useCount.set(songId, (state.useCount.get(songId) ?? 0) + 1);
  if (family) {
    let set = state.families.get(songId);
    if (!set) {
      set = new Set();
      state.families.set(songId, set);
    }
    set.add(family);
  }
};

/** Soft penalty that steers later mixes away from songs earlier mixes already took. */
export const usagePenalty = (state: AssignmentState, songId: string): number => {
  const used = state.useCount.get(songId) ?? 0;
  const base = used === 0 ? 1 : used === 1 ? 0.6 : 0.36;
  return state.reserved.has(songId) ? base * 0.8 : base;
};
