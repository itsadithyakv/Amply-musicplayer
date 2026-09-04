import { seededShuffle } from '@/utils/random';

export interface DiversityCaps {
  artistCap: number;
  albumCap: number;
}

export interface Keyed {
  id: string;
  artistKey: string;
  albumKey: string;
}

/** artist cap max(2, ceil(15% of target)); album cap max(2, ceil(10% of target)). */
export const capsForTarget = (target: number): DiversityCaps => ({
  artistCap: Math.max(2, Math.ceil(0.15 * target)),
  albumCap: Math.max(2, Math.ceil(0.1 * target)),
});

/**
 * Walk an ordered candidate list and keep the first `target` items that satisfy the artist/album
 * caps and the optional `accept` predicate. Caps are enforced by skipping ahead (backfill), never
 * by giving up; the result is shorter than `target` only when the candidates run out.
 */
export const selectWithCaps = <T extends Keyed>(
  candidates: readonly T[],
  target: number,
  caps: DiversityCaps,
  accept?: (item: T) => boolean,
  onAccept?: (item: T) => void,
): T[] => {
  const result: T[] = [];
  if (target <= 0) {
    return result;
  }
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const seen = new Set<string>();
  for (const item of candidates) {
    if (seen.has(item.id)) {
      continue;
    }
    const artistUsed = artistCounts.get(item.artistKey) ?? 0;
    if (artistUsed >= caps.artistCap) {
      continue;
    }
    const albumUsed = albumCounts.get(item.albumKey) ?? 0;
    if (albumUsed >= caps.albumCap) {
      continue;
    }
    if (accept && !accept(item)) {
      continue;
    }
    seen.add(item.id);
    artistCounts.set(item.artistKey, artistUsed + 1);
    albumCounts.set(item.albumKey, albumUsed + 1);
    result.push(item);
    onAccept?.(item);
    if (result.length >= target) {
      break;
    }
  }
  return result;
};

const WINDOW = 5;
const MAX_PER_WINDOW = 2;

/**
 * Seeded shuffle followed by a deterministic spacing pass: no two adjacent songs share an artist,
 * at most two songs per artist in any window of five, and adjacent songs avoid sharing an album.
 * Constraints relax (in that order) only when the remaining songs make them impossible.
 */
export const shuffleWithSpacing = <T extends Keyed>(items: readonly T[], seed: number, salt: string): T[] => {
  const shuffled = seededShuffle(items, seed, salt);
  if (shuffled.length <= 2) {
    return shuffled;
  }
  const remaining = shuffled.slice();
  const remainingByArtist = new Map<string, number>();
  for (const item of remaining) {
    remainingByArtist.set(item.artistKey, (remainingByArtist.get(item.artistKey) ?? 0) + 1);
  }
  const result: T[] = [];

  const countInLastWindow = (artistKey: string): number => {
    let count = 0;
    for (let i = Math.max(0, result.length - (WINDOW - 1)); i < result.length; i += 1) {
      if (result[i].artistKey === artistKey) count += 1;
    }
    return count;
  };

  while (remaining.length) {
    const last = result[result.length - 1];
    // Tier 0: different artist, window ok, different album. Tier 1: same album as the previous
    // song. Tier 2: window would hold three of the artist. Tier 3: same artist as the previous song.
    // Within the best tier the artist with the most songs left goes first (keeps the tail
    // feasible), ties keep the shuffled order.
    let pickIndex = 0;
    let pickTier = Number.POSITIVE_INFINITY;
    let pickRemaining = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      const item = remaining[i];
      let tier: number;
      if (last !== undefined && last.artistKey === item.artistKey) {
        tier = 3;
      } else if (countInLastWindow(item.artistKey) >= MAX_PER_WINDOW) {
        tier = 2;
      } else if (last !== undefined && last.albumKey === item.albumKey) {
        tier = 1;
      } else {
        tier = 0;
      }
      if (tier > pickTier) {
        continue;
      }
      const left = remainingByArtist.get(item.artistKey) ?? 0;
      if (tier < pickTier || left > pickRemaining) {
        pickIndex = i;
        pickTier = tier;
        pickRemaining = left;
      }
    }

    const [picked] = remaining.splice(pickIndex, 1);
    remainingByArtist.set(picked.artistKey, (remainingByArtist.get(picked.artistKey) ?? 1) - 1);
    if ((remainingByArtist.get(picked.artistKey) ?? 0) <= 0) {
      remainingByArtist.delete(picked.artistKey);
    }
    result.push(picked);
  }
  return result;
};
