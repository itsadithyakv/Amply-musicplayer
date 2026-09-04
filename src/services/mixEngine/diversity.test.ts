import { describe, expect, it } from 'vitest';
import { capsForTarget, selectWithCaps, shuffleWithSpacing, type Keyed } from './diversity';
import { interleaveByShare, rouletteDraw, roundRobinByStratum } from './sampling';
import { mulberry32 } from '@/utils/random';

const item = (id: string, artistKey: string, albumKey = `${artistKey}::album`): Keyed => ({ id, artistKey, albumKey });

describe('capsForTarget', () => {
  it('follows the 15% / 10% rules with a floor of 2', () => {
    expect(capsForTarget(60)).toEqual({ artistCap: 9, albumCap: 6 });
    expect(capsForTarget(80)).toEqual({ artistCap: 12, albumCap: 8 });
    expect(capsForTarget(5)).toEqual({ artistCap: 2, albumCap: 2 });
  });
});

describe('selectWithCaps', () => {
  it('backfills past capped artists instead of giving up', () => {
    const candidates: Keyed[] = [];
    for (let i = 0; i < 30; i += 1) candidates.push(item(`a${i}`, 'big', 'big::one'));
    for (let i = 0; i < 10; i += 1) candidates.push(item(`b${i}`, `small${i}`));
    const picked = selectWithCaps(candidates, 12, { artistCap: 2, albumCap: 2 });
    expect(picked).toHaveLength(12);
    expect(picked.filter((entry) => entry.artistKey === 'big')).toHaveLength(2);
  });

  it('shortens the result when the pool cannot satisfy the caps', () => {
    const candidates = Array.from({ length: 30 }, (_, i) => item(`a${i}`, 'big', 'big::one'));
    expect(selectWithCaps(candidates, 12, { artistCap: 3, albumCap: 3 })).toHaveLength(3);
  });

  it('honours the accept predicate and never repeats an id', () => {
    const candidates = [item('x', 'a'), item('x', 'a'), item('y', 'b'), item('z', 'c')];
    const picked = selectWithCaps(candidates, 5, { artistCap: 5, albumCap: 5 }, (entry) => entry.id !== 'y');
    expect(picked.map((entry) => entry.id)).toEqual(['x', 'z']);
  });
});

describe('shuffleWithSpacing', () => {
  const library: Keyed[] = [];
  for (let artist = 0; artist < 8; artist += 1) {
    for (let n = 0; n < 6; n += 1) library.push(item(`s${artist}-${n}`, `artist${artist}`, `artist${artist}::${n % 2}`));
  }

  it('is deterministic and keeps every item', () => {
    const a = shuffleWithSpacing(library, 42, 'order');
    const b = shuffleWithSpacing(library, 42, 'order');
    expect(a.map((entry) => entry.id)).toEqual(b.map((entry) => entry.id));
    expect([...a].sort((x, y) => x.id.localeCompare(y.id))).toEqual([...library].sort((x, y) => x.id.localeCompare(y.id)));
    expect(shuffleWithSpacing(library, 43, 'order').map((entry) => entry.id)).not.toEqual(a.map((entry) => entry.id));
  });

  it('never places the same artist twice in a row and at most twice per window of five', () => {
    const ordered = shuffleWithSpacing(library, 42, 'order');
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].artistKey).not.toBe(ordered[i - 1].artistKey);
    }
    for (let i = 0; i + 5 <= ordered.length; i += 1) {
      const counts = new Map<string, number>();
      for (const entry of ordered.slice(i, i + 5)) counts.set(entry.artistKey, (counts.get(entry.artistKey) ?? 0) + 1);
      for (const count of counts.values()) expect(count).toBeLessThanOrEqual(2);
    }
  });

  it('degrades gracefully when constraints are impossible', () => {
    const twoArtists = [item('a1', 'a'), item('a2', 'a'), item('a3', 'a'), item('b1', 'b')];
    const ordered = shuffleWithSpacing(twoArtists, 1, 'x');
    expect(ordered).toHaveLength(4);
  });
});

describe('sampling', () => {
  it('rouletteDraw is deterministic, without replacement and biased towards high scores', () => {
    const pool = Array.from({ length: 200 }, (_, i) => i);
    const draw = (seed: number) => rouletteDraw(pool, (value) => value, 50, mulberry32(seed), 4);
    expect(draw(1)).toEqual(draw(1));
    expect(new Set(draw(1)).size).toBe(50);
    const mean = draw(1).reduce((sum, value) => sum + value, 0) / 50;
    expect(mean).toBeGreaterThan(120);
    expect(rouletteDraw(pool, (value) => value, 500, mulberry32(2), 1)).toHaveLength(200);
  });

  it('interleaveByShare keeps the requested proportion and backfills', () => {
    const merged = interleaveByShare(['a', 'a', 'a', 'a', 'a', 'a', 'a'], ['b', 'b', 'b'], 0.7);
    expect(merged.slice(0, 10).filter((value) => value === 'a')).toHaveLength(7);
    expect(interleaveByShare(['a'], ['b', 'b', 'b'], 0.9)).toEqual(['a', 'b', 'b', 'b']);
  });

  it('roundRobinByStratum cycles through strata', () => {
    const items = ['a1', 'a2', 'b1', 'c1', 'c2', 'c3'];
    const result = roundRobinByStratum(items, (value) => value[0], (keys) => keys);
    expect(result).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'c3']);
  });
});
