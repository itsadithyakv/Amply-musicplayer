import { describe, expect, it } from 'vitest';
import { usePlayerStore } from './playerStore';

describe('player settings defaults', () => {
  it('keeps lyrics visuals opt-in', () => {
    expect(usePlayerStore.getState().settings.lyricsVisualsEnabled).toBe(false);
  });
});
