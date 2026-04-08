import { invoke } from '@tauri-apps/api/core';
import { parseLrc } from '@/utils/lrc';
import { markSongCached } from '@/services/metadataCacheIndex';
import type { Song } from '@/types/music';
import { isTauri } from '@/services/storageService';

export interface LyricsResult {
  raw: string;
  lines: ReturnType<typeof parseLrc>;
  fromCache: boolean;
  cachePath: string;
  isSynced: boolean;
}

export interface LyricsCandidate {
  id: string;
  trackName: string;
  artistName: string;
  albumName: string | null;
  durationSec: number | null;
  isSynced: boolean;
  raw: string;
  preview: string;
}

type LyricsLoadResult =
  | { status: 'ready'; lyrics: LyricsResult; cachePath: string }
  | { status: 'missing'; cachePath: string };

const buildLyricsResult = (raw: string, fromCache: boolean, cachePath: string): LyricsResult => {
  const lines = parseLrc(raw);
  return {
    raw,
    lines,
    fromCache,
    cachePath,
    isSynced: lines.some((line) => line.timeMs !== null),
  };
};

const validateLyricsQuality = (lyrics: LyricsResult): boolean => {
  const lines = lyrics.lines;

  if (lines.length === 0) {
    return false;
  }

  if (lyrics.isSynced) {
    const timedLines = lines.filter(line => line.timeMs !== null);
    if (timedLines.length < lines.length * 0.5) {
      return false;
    }

    const times = timedLines.map(line => line.timeMs!).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i += 1) {
      if (times[i] < times[i - 1]) {
        return false;
      }
      if (times[i] - times[i - 1] > 300000) {
        return false;
      }
    }
  }

  const textLines = lines.filter(line => line.text.trim().length > 0);
  if (textLines.length < 2) {
    return false;
  }

  const uniqueTexts = new Set(textLines.map(line => line.text.toLowerCase().trim()));
  if (uniqueTexts.size < textLines.length * 0.3) {
    return false;
  }

  return true;
};

const toRustSong = (song: Song) => ({
  id: song.id ?? null,
  title: song.title,
  artist: song.artist,
  album: song.album ?? null,
  duration: song.duration ?? null,
  genre: song.genre ?? null,
});

export const findLyricsCandidates = async (song: Song): Promise<LyricsCandidate[]> => {
  if (!isTauri()) {
    return [];
  }

  const candidates = await invoke<LyricsCandidate[]>('lyrics_find_candidates_rust', {
    song: toRustSong(song),
  });

  return candidates.map((candidate) => ({
    ...candidate,
    albumName: candidate.albumName ?? null,
    durationSec: candidate.durationSec ?? null,
  }));
};

export const saveLyricsSelection = async (song: Song, candidate: LyricsCandidate): Promise<LyricsResult> => {
  if (!isTauri()) {
    throw new Error('Lyrics save requires Tauri');
  }

  const preview = buildLyricsResult(candidate.raw, false, '');
  if (!validateLyricsQuality(preview)) {
    throw new Error('Lyrics failed quality validation');
  }

  const result = await invoke<{ status: 'ready' | 'missing'; raw?: string | null; cachePath: string }>(
    'lyrics_save_selection_rust',
    {
      song: toRustSong(song),
      candidate: {
        ...candidate,
        albumName: candidate.albumName ?? null,
        durationSec: candidate.durationSec ?? null,
      },
    },
  );

  if (result.status !== 'ready' || !result.raw) {
    throw new Error('Failed to save lyrics');
  }

  if (song.id) {
    void markSongCached(song.id, 'lyrics');
  }
  return buildLyricsResult(result.raw, false, result.cachePath);
};

export const loadLyrics = async (song: Song): Promise<LyricsLoadResult> => {
  if (!isTauri()) {
    return {
      status: 'missing',
      cachePath: 'storage/lyrics_cache/unknown.lrc',
    };
  }

  const result = await invoke<{ status: 'ready' | 'missing'; raw?: string | null; cachePath: string; fromCache?: boolean | null }>(
    'lyrics_load_rust',
    { song: toRustSong(song) },
  );

  if (result.status === 'ready' && result.raw) {
    const lyrics = buildLyricsResult(result.raw, Boolean(result.fromCache), result.cachePath);
    if (validateLyricsQuality(lyrics)) {
      if (song.id) {
        void markSongCached(song.id, 'lyrics');
      }
      return { status: 'ready', lyrics, cachePath: result.cachePath };
    }
  }

  return { status: 'missing', cachePath: result.cachePath };
};

export const readCachedLyrics = async (song: Song): Promise<LyricsLoadResult> => {
  if (!isTauri()) {
    return {
      status: 'missing',
      cachePath: 'storage/lyrics_cache/unknown.lrc',
    };
  }

  const result = await invoke<{ status: 'ready' | 'missing'; raw?: string | null; cachePath: string; fromCache?: boolean | null }>(
    'lyrics_read_cached_rust',
    { song: toRustSong(song) },
  );

  if (result.status === 'ready' && result.raw) {
    const lyrics = buildLyricsResult(result.raw, true, result.cachePath);
    if (song.id) {
      void markSongCached(song.id, 'lyrics');
    }
    return { status: 'ready', lyrics, cachePath: result.cachePath };
  }

  return { status: 'missing', cachePath: result.cachePath };
};
