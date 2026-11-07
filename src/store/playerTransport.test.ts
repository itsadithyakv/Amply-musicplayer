import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngineCallbacks } from '@/services/audioEngine';
import type { Song } from '@/types/music';

let captured: AudioEngineCallbacks = {};
const engine = vi.hoisted(() => ({ setLoop: vi.fn(), loadSong: vi.fn(async () => {}) }));

vi.mock('@/services/audioEngine', () => ({
  audioEngine: {
    setCallbacks: (callbacks: AudioEngineCallbacks) => {
      captured = callbacks;
    },
    applySettings: vi.fn(),
    setLoop: engine.setLoop,
    getCurrentSongId: () => null,
    getPosition: () => 0,
    getDuration: () => 0,
    loadSong: engine.loadSong,
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
const { useLibraryStore } = await import('@/store/libraryStore');
const { useProStore } = await import('@/store/proStore');

const song = (id: string, duration = 200): Song => ({
  id,
  path: `D:/music/${id}.mp3`,
  source: 'local',
  filename: `${id}.mp3`,
  title: id,
  artist: 'Artist',
  album: 'Album',
  genre: 'Pop',
  duration,
  track: 1,
  addedAt: 1_700_000_000,
  playCount: 0,
  favorite: false,
});

const player = () => usePlayerStore.getState();
const queueOf = (ids: string[], current: string, cursor = ids.indexOf(current)) =>
  usePlayerStore.setState({
    currentSongId: current,
    queueSongIds: ids,
    queueCursor: cursor,
    manualQueueSongIds: [],
    historySongIds: [],
    shuffleEnabled: false,
    repeatMode: 'off',
    isPlaying: true,
    durationSec: 200,
    positionSec: 0,
  });
const loaded = () => (engine.loadSong.mock.calls as unknown as Array<[Song]>).at(-1)?.[0];

describe('transport', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    window.localStorage.clear();
    engine.loadSong.mockClear();
    engine.setLoop.mockClear();
    await player().initialize();
    useLibraryStore.setState({ initialized: true, songs: ['a', 'b', 'c', 'd'].map((id) => song(id)) });
    useProStore.setState({ isPro: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('Previous walks back through history instead of bouncing', async () => {
    queueOf(['a', 'b', 'c'], 'a');
    await player().playSongById('a', false);
    await player().playSongById('b', false);
    await player().playSongById('c', false);
    await player().playPrevious();
    expect(player().currentSongId).toBe('b');
    await player().playPrevious();
    expect(player().currentSongId).toBe('a');
  });

  it('a queued song that left the library is skipped, not retried forever', async () => {
    queueOf(['a', 'gone', 'b'], 'a');
    await player().playNext(false, { skipRecord: true });
    expect(player().currentSongId).toBe('b');
    expect(player().queueSongIds).toEqual(['a', 'b']);
  });

  it('stops cleanly when nothing playable is left', async () => {
    queueOf(['a', 'gone'], 'a');
    await player().playNext(false, { skipRecord: true });
    expect(player().currentSongId).toBe('a');
    expect(player().isPlaying).toBe(false);
  });

  it('turning shuffle on clears repeat-one in the engine too', () => {
    queueOf(['a', 'b'], 'a');
    usePlayerStore.setState({ repeatMode: 'one' });
    player().setShuffleEnabled(true);
    expect(player().repeatMode).toBe('off');
    expect(engine.setLoop).toHaveBeenLastCalledWith(false);
  });

  it('removing the current row keeps the next song next', async () => {
    queueOf(['a', 'b', 'c', 'd'], 'b');
    player().removeQueuedSong('b');
    await player().playNext(false, { skipRecord: true });
    expect(player().currentSongId).toBe('c');
  });

  describe('crossfade at the end of a song', () => {
    const withCrossfade = () => {
      usePlayerStore.setState((state) => ({
        settings: { ...state.settings, crossfadeEnabled: true, gaplessEnabled: false, crossfadeDurationSec: 6 },
      }));
      queueOf(['a', 'b'], 'a');
      engine.loadSong.mockClear();
    };

    it('starts the next song before the current one ends, once', async () => {
      useProStore.setState({ isPro: true });
      withCrossfade();
      captured.onProgress?.(190, 200);
      expect(engine.loadSong).not.toHaveBeenCalled();
      captured.onProgress?.(194.5, 200);
      await vi.advanceTimersByTimeAsync(20);
      expect(player().currentSongId).toBe('b');
      expect(engine.loadSong).toHaveBeenCalledTimes(1);
      expect(loaded()?.id).toBe('b');
      // The next song's own early ticks must not advance it again.
      captured.onProgress?.(0.2, 200);
      await vi.advanceTimersByTimeAsync(20);
      expect(engine.loadSong).toHaveBeenCalledTimes(1);
    });

    it('does nothing on a free install, whatever was saved', async () => {
      withCrossfade();
      captured.onProgress?.(199, 200);
      await vi.advanceTimersByTimeAsync(20);
      expect(engine.loadSong).not.toHaveBeenCalled();
      expect(player().currentSongId).toBe('a');
    });

    it('leaves a repeated song alone', async () => {
      useProStore.setState({ isPro: true });
      withCrossfade();
      usePlayerStore.setState({ repeatMode: 'one' });
      captured.onProgress?.(199, 200);
      await vi.advanceTimersByTimeAsync(20);
      expect(engine.loadSong).not.toHaveBeenCalled();
    });
  });
});

describe('shuffle', () => {
  const ids = Array.from({ length: 12 }, (_, index) => `s${index}`);

  beforeEach(async () => {
    vi.useFakeTimers();
    await player().initialize();
    useLibraryStore.setState({ initialized: true, songs: ids.map((id) => song(id)) });
    usePlayerStore.setState({ shuffleEnabled: false, unshuffledQueueSongIds: null, repeatMode: 'off', manualQueueSongIds: [] });
    player().setQueue(ids, 's0');
    await player().playSongById('s0', false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays every song once before any repeats, in the order the queue shows', async () => {
    player().setShuffleEnabled(true);
    const shown = [...player().queueSongIds];
    expect(shown[0]).toBe('s0');
    expect([...shown].sort()).toEqual([...ids].sort());
    const played = ['s0'];
    for (let step = 1; step < ids.length; step += 1) {
      await player().playNext(false, { skipRecord: true });
      played.push(player().currentSongId!);
    }
    expect(played).toEqual(shown);
    await player().playNext(false, { skipRecord: true });
    expect(player().isPlaying).toBe(false);
  });

  it('turning it off goes back to the queue order from the song playing', async () => {
    player().setShuffleEnabled(true);
    await player().playNext(false, { skipRecord: true });
    const current = player().currentSongId!;
    player().setShuffleEnabled(false);
    expect(player().queueSongIds).toEqual(ids);
    expect(player().queueSongIds[player().queueCursor]).toBe(current);
    expect(player().unshuffledQueueSongIds).toBeNull();
  });

  it('a new queue started while shuffle is on starts with the chosen song and keeps its own order', () => {
    player().setShuffleEnabled(true);
    player().setQueue(ids, 's5');
    expect(player().queueSongIds[0]).toBe('s5');
    expect(player().queueCursor).toBe(0);
    expect(player().unshuffledQueueSongIds).toEqual(ids);
  });
});
