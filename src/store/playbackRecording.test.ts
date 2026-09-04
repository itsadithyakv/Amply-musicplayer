import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngineCallbacks } from '@/services/audioEngine';
import type { Song } from '@/types/music';

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
const { getListeningEvents, useLibraryStore } = await import('@/store/libraryStore');

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

const library = () => useLibraryStore.getState();
const activity = (id: string) => library().getSongById(id)!;
/** Drain the setTimeout(0) hops the playback scheduler and the stores use. */
const flush = () => vi.advanceTimersByTimeAsync(20);

describe('playback recording', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-04T12:00:00Z'));
    window.localStorage.clear();
    await usePlayerStore.getState().initialize();
    useLibraryStore.setState({
      initialized: true,
      songs: [song('skim'), song('end'), song('again'), song('cap-a', 100), song('cap-b', 100)],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a 5-second skim is a skip, not a play', async () => {
    const before = getListeningEvents().length;
    await library().recordSongPlay('skim');
    expect(activity('skim').playCount).toBe(0);
    expect(activity('skim').lastPlayed).toBeUndefined();
    expect(activity('skim').lastPlayStarted).toBe(Math.floor(Date.now() / 1000));

    await library().recordPlaybackEvent('skim', { listenedSec: 5, durationSec: 200, manualSkip: true });
    const after = activity('skim');
    expect(after.playCount).toBe(0);
    expect(after.lastPlayed).toBeUndefined();
    expect(after.skipCount).toBe(1);
    expect(after.lastSkipped).toBe(Math.floor(Date.now() / 1000));
    expect(after.skipPositionRatio).toBeCloseTo(0.025);
    expect(after.totalPlaySeconds).toBe(5);

    const events = getListeningEvents();
    expect(events.length).toBe(before + 1);
    expect(events[events.length - 1]).toMatchObject({ songId: 'skim', skipped: true, at: Date.now() });
    expect(events[events.length - 1].listenedRatio).toBeCloseTo(0.025);
  });

  it('a natural end counts one play and never double-counts the session', async () => {
    const before = getListeningEvents().length;
    const original = library().recordPlaybackEvent;
    const recordCalls: string[] = [];
    useLibraryStore.setState({
      recordPlaybackEvent: async (songId, event) => {
        recordCalls.push(songId);
        await original(songId, event);
      },
    });

    usePlayerStore.setState({
      currentSongId: 'end',
      durationSec: 200,
      positionSec: 200,
      queueSongIds: ['end', 'again'],
      queueCursor: 0,
      manualQueueSongIds: [],
      repeatMode: 'off',
      shuffleEnabled: false,
      lastQueuePlaylistId: 'smart_daily_mix',
    });
    await library().recordSongPlay('end');
    await captured.onEnded?.();
    await flush();

    // onEnded records the completion; the auto-advance it triggers must not record again.
    expect(recordCalls).toEqual(['end']);
    expect(usePlayerStore.getState().currentSongId).toBe('again');
    const ended = activity('end');
    expect(ended.playCount).toBe(1);
    expect(ended.totalPlaySeconds).toBe(200);
    expect(ended.skipCount ?? 0).toBe(0);
    expect(ended.lastPlayed).toBe(Math.floor(Date.now() / 1000));
    expect(ended.lastCompleted).toBe(Math.floor(Date.now() / 1000));

    // A stray second record for the same session is ignored.
    await original('end', { listenedSec: 200, durationSec: 200, completed: true });
    expect(activity('end').playCount).toBe(1);
    expect(activity('end').totalPlaySeconds).toBe(200);

    const events = getListeningEvents();
    expect(events.length).toBe(before + 1);
    expect(events[events.length - 1]).toMatchObject({
      songId: 'end',
      skipped: false,
      listenedRatio: 1,
      source: 'smart_daily_mix',
    });

    // The next track opened a fresh session, so it can be recorded once more.
    expect(activity('again').lastPlayStarted).toBe(Math.floor(Date.now() / 1000));
    useLibraryStore.setState({ recordPlaybackEvent: original });
    await original('again', { listenedSec: 150, durationSec: 200 });
    expect(activity('again').playCount).toBe(1);
    expect(activity('again').skipCount ?? 0).toBe(0);
    expect(getListeningEvents().length).toBe(before + 2);
  });

  it('a replay is a new session and a partial listen can be both a play and a skip', async () => {
    await library().recordSongPlay('again');
    await library().recordPlaybackEvent('again', { listenedSec: 60, durationSec: 200, manualSkip: true });
    await library().recordSongPlay('again');
    await library().recordPlaybackEvent('again', { listenedSec: 60, durationSec: 200, manualSkip: true });
    const track = activity('again');
    expect(track.playCount).toBeGreaterThanOrEqual(2);
    expect(track.skipCount).toBeGreaterThanOrEqual(2);
    expect(track.skipPositionRatio).toBeCloseTo(0.3);
  });

  it('keeps the event log capped at 5000 entries', async () => {
    const start = getListeningEvents().length;
    const total = 5000 - start + 3;
    for (let i = 0; i < total; i += 1) {
      const id = i % 2 === 0 ? 'cap-a' : 'cap-b';
      await library().recordSongPlay(id);
      await library().recordPlaybackEvent(id, { listenedSec: 100, durationSec: 100, completed: true });
    }
    const events = getListeningEvents();
    expect(events.length).toBe(5000);
    expect(events[events.length - 1].songId).toBe(total % 2 === 1 ? 'cap-a' : 'cap-b');
    expect(activity('cap-a').playCount + activity('cap-b').playCount).toBe(total);
  });
});
