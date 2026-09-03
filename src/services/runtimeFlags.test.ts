import { afterEach, describe, expect, it, vi } from 'vitest';
import { getFlag, getFlags, resetFlags, setFlags, subscribeFlag } from '@/services/runtimeFlags';

afterEach(() => {
  resetFlags();
});

describe('runtimeFlags', () => {
  it('has safe defaults', () => {
    expect(getFlag('isPlaying')).toBe(false);
    expect(getFlag('onlineRecsEnabled')).toBeUndefined();
    expect(getFlags().upNext).toEqual([]);
  });

  it('setFlags patches and skips no-op writes', () => {
    const listener = vi.fn();
    const off = subscribeFlag('isPlaying', listener);
    setFlags({ isPlaying: true });
    setFlags({ isPlaying: true });
    setFlags({ lowPerf: true });
    expect(getFlag('isPlaying')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(true, false);
    off();
    setFlags({ isPlaying: false });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
