import type { Rng } from '@/utils/random';

/**
 * Seeded roulette-wheel sampling without replacement. Scores are min-max normalised inside the
 * pool and turned into weights `exp(sharpness * norm)`, so `sharpness` 0 is a uniform draw and a
 * high value approaches a greedy top-k. Deterministic for a given rng. O(pool x count).
 */
export const rouletteDraw = <T>(
  pool: readonly T[],
  scoreOf: (item: T) => number,
  count: number,
  rng: Rng,
  sharpness: number,
): T[] => {
  const size = pool.length;
  const take = Math.min(count, size);
  if (take <= 0) {
    return [];
  }
  const items = pool.slice();
  const weights = new Array<number>(size);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const raw = new Array<number>(size);
  for (let i = 0; i < size; i += 1) {
    const score = scoreOf(items[i]);
    raw[i] = Number.isFinite(score) ? score : 0;
    if (raw[i] < min) min = raw[i];
    if (raw[i] > max) max = raw[i];
  }
  const span = max - min;
  let total = 0;
  for (let i = 0; i < size; i += 1) {
    const norm = span > 0 ? (raw[i] - min) / span : 1;
    weights[i] = Math.exp(sharpness * norm);
    total += weights[i];
  }

  const result: T[] = [];
  let remaining = size;
  while (result.length < take && remaining > 0) {
    let pick = rng() * total;
    let index = 0;
    for (; index < remaining - 1; index += 1) {
      pick -= weights[index];
      if (pick <= 0) {
        break;
      }
    }
    result.push(items[index]);
    total -= weights[index];
    remaining -= 1;
    items[index] = items[remaining];
    weights[index] = weights[remaining];
    if (total <= 1e-12) {
      // Floating error can leave a tiny negative total; recompute from what is left.
      total = 0;
      for (let i = 0; i < remaining; i += 1) total += weights[i];
    }
  }
  return result;
};

/**
 * Interleave two ordered lists so that a prefix of any length holds roughly `shareA` of A.
 * When one list runs out the other continues (backfill).
 */
export const interleaveByShare = <T>(a: readonly T[], b: readonly T[], shareA: number): T[] => {
  const result: T[] = [];
  let ia = 0;
  let ib = 0;
  const share = Math.max(0, Math.min(1, shareA));
  while (ia < a.length || ib < b.length) {
    const takenA = ia;
    const total = ia + ib;
    const wantA = total === 0 ? share >= 0.5 : takenA / total < share;
    if ((wantA && ia < a.length) || ib >= b.length) {
      result.push(a[ia]);
      ia += 1;
    } else {
      result.push(b[ib]);
      ib += 1;
    }
  }
  return result;
};

/**
 * Round-robin across strata (in the given stratum order), keeping each stratum's internal order.
 * Used for the cold-start Daily Mix so genres x decades are all represented early in the list.
 */
export const roundRobinByStratum = <T>(
  items: readonly T[],
  stratumOf: (item: T) => string,
  strataOrder: (keys: string[]) => string[],
): T[] => {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = stratumOf(item);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }
  const keys = strataOrder([...buckets.keys()].sort());
  const cursors = new Map<string, number>();
  const result: T[] = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const key of keys) {
      const bucket = buckets.get(key);
      const cursor = cursors.get(key) ?? 0;
      if (!bucket || cursor >= bucket.length) {
        continue;
      }
      result.push(bucket[cursor]);
      cursors.set(key, cursor + 1);
      progressed = true;
    }
  }
  return result;
};
