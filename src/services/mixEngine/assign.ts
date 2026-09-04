import type { MixFamily, MixKind } from './types';

/** A song may appear in at most this many mixes. */
export const MAX_MIXES_PER_SONG = 2;

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
}

export const createAssignmentState = (): AssignmentState => ({
  useCount: new Map(),
  families: new Map(),
  reserved: new Set(),
});

export const canUse = (
  state: AssignmentState,
  songId: string,
  family: MixFamily | undefined,
  forDaily = false,
): boolean => {
  const used = state.useCount.get(songId) ?? 0;
  if (used >= MAX_MIXES_PER_SONG) {
    return false;
  }
  if (!forDaily && used >= MAX_MIXES_PER_SONG - 1 && state.reserved.has(songId)) {
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
