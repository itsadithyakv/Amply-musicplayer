/**
 * Smart-playlist ("mix") engine.
 *
 * Pure and deterministic: the same `MixEngineInput` always yields the same output. Time is taken
 * from `input.now`, never from the clock. See engine.ts for the pipeline
 * (signals -> eligibility predicates -> explore/exploit sampling -> exclusivity + diversity -> spacing).
 */
import { runEngine } from './engine';
import type { MixEngineInput, MixEngineOutput } from './types';

export type {
  ListeningEvent,
  MixDiagnostics,
  MixEngineInput,
  MixEngineOutput,
  MixHistory,
  MixHistoryEntry,
} from './types';

export { canonicalGenre, GENRE_TAXONOMY, inferGenreForSong } from './genres';
export { isLiteMixPlaylistId, mergeLiteMixes } from './helpers';

/** Every mix: core, genre and mood mixes. */
export const generateMixes = (input: MixEngineInput): MixEngineOutput => runEngine(input, false);

/** Daily, On Repeat, Recently Played, Favorites and Explore only (fast path). */
export const generateMixesLite = (input: MixEngineInput): MixEngineOutput => runEngine(input, true);

/** Genre and mood mixes (everything shown under "More mixes"); same semantics as the old export. */
export const isMoreMixPlaylistId = (id: string): boolean => {
  if (id.startsWith('smart_genre_mix_')) {
    return true;
  }
  return id.startsWith('smart_') && id.endsWith('_mix') && id !== 'smart_daily_mix';
};
