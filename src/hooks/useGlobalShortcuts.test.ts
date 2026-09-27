import { describe, expect, it } from 'vitest';
import { nextVolumeForKey } from '@/hooks/useGlobalShortcuts';

describe('nextVolumeForKey', () => {
  it('steps volume by 5% and clamps to 0..1', () => {
    expect(nextVolumeForKey('ArrowUp', 0.5)).toBe(0.55);
    expect(nextVolumeForKey('ArrowDown', 0.5)).toBe(0.45);
    expect(nextVolumeForKey('ArrowUp', 0.98)).toBe(1);
    expect(nextVolumeForKey('ArrowDown', 0.02)).toBe(0);
  });

  it('mutes, then restores the volume from before the mute', () => {
    expect(nextVolumeForKey('KeyM', 0.6)).toBe(0);
    expect(nextVolumeForKey('KeyM', 0)).toBe(0.6);
  });

  it('ignores other keys', () => {
    expect(nextVolumeForKey('KeyA', 0.5)).toBeNull();
  });
});
