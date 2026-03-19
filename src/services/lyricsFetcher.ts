import { parseLrc } from '@/utils/lrc';
import { readStorageText, writeStorageText } from '@/services/storageService';
import type { Song } from '@/types/music';

const cacheFolder = 'lyrics_cache';

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const cacheKeyForSong = (song: Song): string => {
  const artist = slugify(song.artist || 'unknown-artist');
  const title = slugify(song.title || 'unknown-title');
  return `${cacheFolder}/${artist}-${title}.lrc`;
};

const asString = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

const normalizePlainLyrics = (raw: string): string => {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
};

const normalizeMatchName = (value: string): string => {
  return value.trim().toLowerCase();
};

const safeIncludes = (haystack: string, needle: string): boolean => {
  return normalizeMatchName(haystack).includes(normalizeMatchName(needle));
};

const scoreCandidate = (song: Song, candidate: LyricsCandidate): number => {
  let score = 0;

  if (normalizeMatchName(candidate.trackName) === normalizeMatchName(song.title)) {
    score += 6;
  } else if (safeIncludes(candidate.trackName, song.title)) {
    score += 3;
  }

  if (normalizeMatchName(candidate.artistName) === normalizeMatchName(song.artist)) {
    score += 5;
  } else if (safeIncludes(candidate.artistName, song.artist)) {
    score += 2;
  }

  if (candidate.albumName && normalizeMatchName(candidate.albumName) === normalizeMatchName(song.album)) {
    score += 3;
  }

  if (candidate.isSynced) {
    score += 2;
  }

  if (candidate.durationSec && song.duration > 0) {
    const diff = Math.abs(candidate.durationSec - song.duration);
    if (diff <= 2) {
      score += 3;
    } else if (diff <= 7) {
      score += 2;
    } else if (diff <= 12) {
      score += 1;
    }
  }

  return score;
};

interface LrcLibSearchHit {
  id?: number | string;
  trackName?: string;
  track_name?: string;
  artistName?: string;
  artist_name?: string;
  albumName?: string;
  album_name?: string;
  duration?: number | string;
  syncedLyrics?: string;
  synced_lyrics?: string;
  plainLyrics?: string;
  plain_lyrics?: string;
}

const toCandidate = (song: Song, hit: LrcLibSearchHit, index: number): LyricsCandidate | null => {
  const synced = asString(hit.syncedLyrics) ?? asString(hit.synced_lyrics);
  const plainRaw = asString(hit.plainLyrics) ?? asString(hit.plain_lyrics);
  const plain = plainRaw ? normalizePlainLyrics(plainRaw) : null;
  const raw = synced ?? plain;

  if (!raw) {
    return null;
  }

  const trackName =
    asString(hit.trackName) ?? asString(hit.track_name) ?? song.title;
  const artistName =
    asString(hit.artistName) ?? asString(hit.artist_name) ?? song.artist;
  const albumName = asString(hit.albumName) ?? asString(hit.album_name);
  const durationSec = asNumber(hit.duration);
  const idSeed = asString(hit.id) ?? `${trackName}-${artistName}-${index}`;

  return {
    id: slugify(idSeed) || `candidate-${index + 1}`,
    trackName,
    artistName,
    albumName,
    durationSec,
    isSynced: Boolean(synced),
    raw,
    preview: plain ?? synced ?? '',
  };
};

const dedupeCandidates = (candidates: LyricsCandidate[]): LyricsCandidate[] => {
  const seen = new Set<string>();
  const result: LyricsCandidate[] = [];

  for (const candidate of candidates) {
    const key = candidate.raw.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(candidate);
  }

  return result;
};

const fetchSearchCandidates = async (song: Song): Promise<LyricsCandidate[]> => {
  const endpoint = `https://lrclib.net/api/search?artist_name=${encodeURIComponent(song.artist)}&track_name=${encodeURIComponent(song.title)}&album_name=${encodeURIComponent(song.album)}`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }

  const parsed = payload
    .map((entry, index) => toCandidate(song, entry as LrcLibSearchHit, index))
    .filter((entry): entry is LyricsCandidate => Boolean(entry));

  return dedupeCandidates(parsed);
};

const fetchSingleCandidate = async (song: Song): Promise<LyricsCandidate[]> => {
  const endpoint = `https://lrclib.net/api/get?artist_name=${encodeURIComponent(song.artist)}&track_name=${encodeURIComponent(song.title)}&album_name=${encodeURIComponent(song.album)}`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as unknown;
  if (!payload || Array.isArray(payload)) {
    return [];
  }

  const candidate = toCandidate(song, payload as LrcLibSearchHit, 0);
  return candidate ? [candidate] : [];
};

const buildLyricsResult = (raw: string, fromCache: boolean, cacheKey: string): LyricsResult => {
  const lines = parseLrc(raw);
  return {
    raw,
    lines,
    fromCache,
    cachePath: `storage/${cacheKey}`,
    isSynced: lines.some((line) => line.timeMs !== null),
  };
};

const rankCandidatesWithScore = (
  song: Song,
  candidates: LyricsCandidate[],
): Array<{ candidate: LyricsCandidate; score: number }> => {
  return [...candidates]
    .map((candidate) => ({ candidate, score: scoreCandidate(song, candidate) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
};

const rankCandidates = (song: Song, candidates: LyricsCandidate[]): LyricsCandidate[] => {
  return rankCandidatesWithScore(song, candidates).map((entry) => entry.candidate);
};

const isCertainMatch = (
  song: Song,
  top: { candidate: LyricsCandidate; score: number },
  runnerUp?: { candidate: LyricsCandidate; score: number },
): boolean => {
  const candidate = top.candidate;
  const exactTitle = normalizeMatchName(candidate.trackName) === normalizeMatchName(song.title);
  const exactArtist = normalizeMatchName(candidate.artistName) === normalizeMatchName(song.artist);
  const durationClose =
    candidate.durationSec && song.duration > 0
      ? Math.abs(candidate.durationSec - song.duration) <= 4
      : false;

  if (exactTitle && exactArtist && (candidate.isSynced || durationClose)) {
    return true;
  }

  if (top.score >= 8 && (!runnerUp || top.score - runnerUp.score >= 2)) {
    return true;
  }

  return false;
};

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

export type LyricsLoadResult =
  | { status: 'ready'; lyrics: LyricsResult; cachePath: string }
  | { status: 'choose'; candidates: LyricsCandidate[]; cachePath: string }
  | { status: 'missing'; cachePath: string };

export const saveLyricsSelection = async (song: Song, candidate: LyricsCandidate): Promise<LyricsResult> => {
  const key = cacheKeyForSong(song);
  await writeStorageText(key, candidate.raw);
  return buildLyricsResult(candidate.raw, false, key);
};

export const findLyricsCandidates = async (song: Song): Promise<LyricsCandidate[]> => {
  let candidates = await fetchSearchCandidates(song);

  if (!candidates.length) {
    candidates = await fetchSingleCandidate(song);
  }

  if (!candidates.length) {
    return [];
  }

  return rankCandidates(song, candidates);
};

export const loadLyrics = async (song: Song): Promise<LyricsLoadResult> => {
  const key = cacheKeyForSong(song);
  const cached = await readStorageText(key);

  if (cached?.trim()) {
    const lyrics = buildLyricsResult(cached, true, key);
    return {
      status: 'ready',
      lyrics,
      cachePath: lyrics.cachePath,
    };
  }

  const candidates = await findLyricsCandidates(song);

  if (!candidates.length) {
    return {
      status: 'missing',
      cachePath: `storage/${key}`,
    };
  }

  const ranked = rankCandidatesWithScore(song, candidates);

  if (ranked.length >= 1) {
    const lyrics = await saveLyricsSelection(song, ranked[0].candidate);
    return { status: 'ready', lyrics, cachePath: lyrics.cachePath };
  }

  return {
    status: 'choose',
    candidates: ranked.map((entry) => entry.candidate),
    cachePath: `storage/${key}`,
  };
};

export const hasCachedLyrics = async (song: Song): Promise<boolean> => {
  const key = cacheKeyForSong(song);
  const cached = await readStorageText(key);
  return Boolean(cached?.trim());
};
