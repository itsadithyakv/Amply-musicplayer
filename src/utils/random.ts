import { djb2 } from '@/utils/hash';

export type Rng = () => number;

/** Small, fast seeded PRNG (32-bit state). Deterministic for a given seed. */
export const mulberry32 = (seed: number): Rng => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

/** RNG derived from a numeric seed plus a string salt, so callers can fork independent streams. */
export const rngFor = (seed: number, salt: string): Rng => mulberry32(djb2(`${salt}:${seed}`));

/** Fisher–Yates shuffle into a new array. Defaults to Math.random. */
export const shuffle = <T>(items: readonly T[], rng: Rng = Math.random): T[] => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

/** Deterministic shuffle for a seed/salt pair. */
export const seededShuffle = <T>(items: readonly T[], seed: number, salt = 'shuffle'): T[] =>
  shuffle(items, rngFor(seed, salt));

/** Pick one element uniformly (undefined for an empty list). */
export const pickRandom = <T>(items: readonly T[], rng: Rng = Math.random): T | undefined =>
  items.length ? items[Math.floor(rng() * items.length)] : undefined;
