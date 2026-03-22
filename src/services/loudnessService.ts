import { invoke } from '@tauri-apps/api/core';
import { isTauri, readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import type { Song } from '@/types/music';

const cachePath = 'metadata_cache/loudness_cache.json';

type LoudnessCacheEntry = {
  lufs: number;
  analyzedAt: number;
};

type LoudnessCache = Record<string, LoudnessCacheEntry>;

type LoudnessLoadResult =
  | { status: 'ready'; lufs: number; fromCache: boolean; cachePath: string }
  | { status: 'missing'; cachePath: string }
  | { status: 'no-tauri'; cachePath: string };

export const hydrateSongsWithCachedLoudness = async (songs: Song[]): Promise<Song[]> => {
  const cache = await readStorageJson<LoudnessCache>(cachePath, {});

  return songs.map((song) => {
    const cached = cache[song.id]?.lufs;
    if (typeof cached !== 'number') {
      return song;
    }

    return {
      ...song,
      loudnessLufs: cached,
    };
  });
};

export const loadSongLoudness = async (song: Song): Promise<LoudnessLoadResult> => {
  const cache = await readStorageJson<LoudnessCache>(cachePath, {});
  const cached = cache[song.id]?.lufs;
  if (typeof cached === 'number') {
    return {
      status: 'ready',
      lufs: cached,
      fromCache: true,
      cachePath: `storage/${cachePath}`,
    };
  }

  if (!isTauri()) {
    return {
      status: 'no-tauri',
      cachePath: `storage/${cachePath}`,
    };
  }

  if (!song.path) {
    return {
      status: 'missing',
      cachePath: `storage/${cachePath}`,
    };
  }

  try {
    const lufs = await invoke<number>('audio_analyze_loudness', { path: song.path });
    const next: LoudnessCache = {
      ...cache,
      [song.id]: {
        lufs,
        analyzedAt: Math.floor(Date.now() / 1000),
      },
    };
    await writeStorageJsonDebounced(cachePath, next);
    return {
      status: 'ready',
      lufs,
      fromCache: false,
      cachePath: `storage/${cachePath}`,
    };
  } catch {
    return {
      status: 'missing',
      cachePath: `storage/${cachePath}`,
    };
  }
};

export const hasCachedLoudness = async (song: Song): Promise<boolean> => {
  const cache = await readStorageJson<LoudnessCache>(cachePath, {});
  return typeof cache[song.id]?.lufs === 'number';
};
