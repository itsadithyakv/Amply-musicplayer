/**
 * String hashes. Three distinct algorithms are kept because each is used as a persisted
 * cache key somewhere; changing an algorithm would silently invalidate existing caches.
 */

/** djb2-style hash, absolute value. Used for seeded shuffles and rotation buckets. */
export const djb2 = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

/** djb2 with xor mixing, unsigned. Used by queueCacheService library fingerprints. */
export const djb2Xor = (value: string): number => {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h) ^ value.charCodeAt(i);
  }
  return h >>> 0;
};

/** FNV-1a 32-bit, rendered in base36. Used for compact artwork src keys. */
export const fnv1a36 = (value: string): string => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};
