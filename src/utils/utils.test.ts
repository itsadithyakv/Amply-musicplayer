import { describe, expect, it, vi } from 'vitest';
import { djb2, djb2Xor, fnv1a36 } from '@/utils/hash';
import { mulberry32, pickRandom, rngFor, seededShuffle, shuffle } from '@/utils/random';
import { normalizeLooseKey, normalizeSearchText, normalizeSlug, normalizeToken, tokenizeSearchText } from '@/utils/text';
import { dailySeed, dayKey, getIsoWeek, isoWeekKey, seedFromKey, weeklySeed } from '@/utils/dateSeed';
import { cancelIdle, requestIdle, yieldToIdle } from '@/utils/idle';
import { getMetadataArtistName, getMetadataLookupParts } from '@/utils/artists';

describe('metadata artist resolution', () => {
  it('trusts a real artist tag over an "Artist - Title" hint in the title', () => {
    expect(getMetadataArtistName('The Beatles', 'Blackbird - 2018 Mix')).toBe('The Beatles');
    expect(getMetadataArtistName('Radiohead', 'Nude - Live')).toBe('Radiohead');
  });

  it('uses the title hint only when the tag is missing or junk', () => {
    expect(getMetadataArtistName('Unknown Artist', 'Daft Punk - Around the World')).toBe('Daft Punk');
    expect(getMetadataArtistName('', 'Daft Punk - Around the World')).toBe('Daft Punk');
    expect(getMetadataArtistName('Some Channel - Topic', 'Daft Punk - Around the World')).toBe('Daft Punk');
  });

  it('keeps the tagged artist in lookup parts', () => {
    expect(getMetadataLookupParts('The Beatles', 'Blackbird - 2018 Mix').artist).toBe('The Beatles');
  });
});

describe('hash', () => {
  it('is stable and non-negative (djb2)', () => {
    expect(djb2('amply')).toBe(djb2('amply'));
    expect(djb2('amply')).toBeGreaterThanOrEqual(0);
    expect(djb2('amply')).not.toBe(djb2('Amply'));
    expect(djb2('')).toBe(0);
  });
  it('djb2Xor is unsigned 32-bit', () => {
    const value = djb2Xor('some long library fingerprint string');
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(value)).toBe(true);
  });
  it('fnv1a36 renders base36', () => {
    expect(fnv1a36('data:image/jpeg;base64,abc')).toMatch(/^[0-9a-z]+$/);
    expect(fnv1a36('a')).not.toBe(fnv1a36('b'));
  });
});

describe('random', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    seqA.forEach((n) => {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    });
  });
  it('rngFor forks distinct streams per salt', () => {
    expect(rngFor(1, 'a')()).not.toBe(rngFor(1, 'b')());
  });
  it('shuffle returns a permutation and does not mutate', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const copy = [...input];
    const out = shuffle(input, mulberry32(7));
    expect(input).toEqual(copy);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
  });
  it('seededShuffle is reproducible', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(seededShuffle(items, 2026, 'daily')).toEqual(seededShuffle(items, 2026, 'daily'));
    expect(seededShuffle(items, 2026, 'daily')).not.toEqual(seededShuffle(items, 2027, 'daily'));
  });
  it('pickRandom handles empty lists', () => {
    expect(pickRandom([])).toBeUndefined();
    expect(pickRandom(['x'])).toBe('x');
  });
});

describe('text', () => {
  it('normalizeSearchText strips punctuation and folds case', () => {
    expect(normalizeSearchText('  Hello,  WORLD! ')).toBe('hello world');
    expect(tokenizeSearchText('Daft Punk - One More Time')).toEqual(['daft', 'punk', '-', 'one', 'more', 'time']);
  });
  it('normalizeToken and normalizeSlug', () => {
    expect(normalizeToken('  Simon & Garfunkel  ')).toBe('simon and garfunkel');
    expect(normalizeSlug('Simon & Garfunkel')).toBe('simon-and-garfunkel');
    expect(normalizeToken(null)).toBe('');
  });
  it('normalizeLooseKey only trims and lowercases', () => {
    expect(normalizeLooseKey('  A.B ')).toBe('a.b');
  });
});

describe('dateSeed', () => {
  it('handles ISO week boundaries around new year', () => {
    expect(getIsoWeek(new Date(Date.UTC(2021, 0, 1)))).toEqual({ year: 2020, week: 53 });
    expect(getIsoWeek(new Date(Date.UTC(2024, 11, 30)))).toEqual({ year: 2025, week: 1 });
    expect(isoWeekKey(new Date(Date.UTC(2026, 8, 3)))).toBe('2026-W36');
  });
  it('dayKey and seeds are numeric and stable', () => {
    const date = new Date(Date.UTC(2026, 8, 3, 12));
    expect(dayKey(date)).toBe('2026-09-03');
    expect(seedFromKey('2026-09-03')).toBe(20260903);
    expect(seedFromKey('2026-W36')).toBe(202636);
    expect(dailySeed(date)).toBe(20260903);
    expect(weeklySeed(date)).toBe(202636);
  });
});

describe('idle', () => {
  it('falls back to setTimeout and cancels with the matching API', () => {
    vi.useFakeTimers();
    const g = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    const savedReq = g.requestIdleCallback;
    const savedCancel = g.cancelIdleCallback;
    delete g.requestIdleCallback;
    delete g.cancelIdleCallback;
    try {
      const cb = vi.fn();
      const handle = requestIdle(cb, { fallbackDelayMs: 50 });
      expect(handle.kind).toBe('timeout');
      cancelIdle(handle);
      vi.advanceTimersByTime(100);
      expect(cb).not.toHaveBeenCalled();
      const cb2 = vi.fn();
      requestIdle(cb2, { fallbackDelayMs: 10 });
      vi.advanceTimersByTime(20);
      expect(cb2).toHaveBeenCalledTimes(1);
    } finally {
      g.requestIdleCallback = savedReq;
      g.cancelIdleCallback = savedCancel;
      vi.useRealTimers();
    }
  });
  it('uses requestIdleCallback when present', () => {
    const g = globalThis as { requestIdleCallback?: unknown; cancelIdleCallback?: unknown };
    const savedReq = g.requestIdleCallback;
    const savedCancel = g.cancelIdleCallback;
    const cancel = vi.fn();
    g.requestIdleCallback = vi.fn(() => 99);
    g.cancelIdleCallback = cancel;
    try {
      const handle = requestIdle(() => {});
      expect(handle).toEqual({ kind: 'idle', id: 99 });
      cancelIdle(handle);
      expect(cancel).toHaveBeenCalledWith(99);
    } finally {
      g.requestIdleCallback = savedReq;
      g.cancelIdleCallback = savedCancel;
    }
  });
  it('yieldToIdle resolves', async () => {
    await expect(yieldToIdle(10)).resolves.toBeUndefined();
  });
});
