import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngineCallbacks } from '@/services/audioEngine';

let captured: AudioEngineCallbacks = {};

vi.mock('@/services/audioEngine', () => ({
  audioEngine: {
    setCallbacks: (callbacks: AudioEngineCallbacks) => {
      captured = callbacks;
    },
    applySettings: vi.fn(),
    setLoop: vi.fn(),
    getCurrentSongId: () => null,
    getPosition: () => 0,
    getDuration: () => 0,
    loadSong: vi.fn(async () => {}),
    preloadSongs: vi.fn(),
    play: vi.fn(),
    playFrom: vi.fn(),
    pause: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setRate: vi.fn(),
    isPlaying: () => false,
    dispose: vi.fn(),
  },
}));

const { usePlayerStore } = await import('@/store/playerStore');
const { getPlaybackProgressSnapshot } = await import('@/store/playbackProgressStore');

const progress = (position: number, duration: number) => {
  captured.onProgress?.(position, duration);
  vi.advanceTimersByTime(300);
};

describe('player progress after the 75% preload mark', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    window.localStorage.clear();
    await usePlayerStore.getState().initialize();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps updating position on a replayed track', () => {
    expect(captured.onProgress).toBeTypeOf('function');

    usePlayerStore.setState({ currentSongId: 'song-a', durationSec: 100 });
    progress(10, 100);
    expect(usePlayerStore.getState().positionSec).toBe(10);
    progress(80, 100); // crosses 75% -> preload bookkeeping runs once
    expect(usePlayerStore.getState().positionSec).toBe(80);

    usePlayerStore.setState({ currentSongId: 'song-b', durationSec: 100 });
    progress(90, 100);
    expect(usePlayerStore.getState().positionSec).toBe(90);

    // Replay song-a: previously onProgress bailed out here and the seek bar froze.
    usePlayerStore.setState({ currentSongId: 'song-a', durationSec: 100 });
    progress(77, 100);
    expect(usePlayerStore.getState().positionSec).toBe(77);
    progress(95, 100);
    expect(usePlayerStore.getState().positionSec).toBe(95);
    expect(getPlaybackProgressSnapshot().positionSec).toBe(95);
  });
});
