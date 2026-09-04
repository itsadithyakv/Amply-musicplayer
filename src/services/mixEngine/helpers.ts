import type { Playlist } from '@/types/music';
import { CORE_MIXES } from './score';

const LITE_MIX_IDS: ReadonlySet<string> = new Set(CORE_MIXES.filter((def) => def.lite).map((def) => def.id));

/** Mixes a lite run (`generateMixesLite`) produces; everything else is carried over from the last full run. */
export const isLiteMixPlaylistId = (id: string): boolean => LITE_MIX_IDS.has(id);

/**
 * Overlay a lite run onto the previous (full) set: lite mixes are replaced in place so the display
 * order of the full run is kept, lite mixes the previous set did not have are appended, and stale
 * lite ids the run no longer emits are dropped.
 */
export const mergeLiteMixes = (previous: Playlist[], lite: Playlist[]): Playlist[] => {
  if (!previous.length) {
    return lite;
  }
  const liteById = new Map(lite.map((playlist) => [playlist.id, playlist]));
  const merged: Playlist[] = [];
  const seen = new Set<string>();
  for (const playlist of previous) {
    if (isLiteMixPlaylistId(playlist.id)) {
      const fresh = liteById.get(playlist.id);
      if (fresh) {
        merged.push(fresh);
        seen.add(fresh.id);
      }
      continue;
    }
    merged.push(playlist);
    seen.add(playlist.id);
  }
  for (const playlist of lite) {
    if (!seen.has(playlist.id)) {
      merged.push(playlist);
    }
  }
  return merged;
};
