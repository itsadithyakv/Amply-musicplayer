import { parseLrc } from '@/utils/lrc';
import { getPrimaryArtistName } from '@/utils/artists';
import { readStorageText, writeStorageText } from '@/services/storageService';
import { markSongCached } from '@/services/metadataCacheIndex';
import type { Song } from '@/types/music';

const cacheFolder = 'lyrics_cache';

// Request deduplication cache
const pendingRequests = new Map<string, Promise<LyricsCandidate[]>>();

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const cacheKeyForSong = (song: Song): string => {
  const primaryArtist = getPrimaryArtistName(song.artist) ?? song.artist;
  const artist = slugify(primaryArtist || 'unknown-artist');
  const title = slugify(song.title || 'unknown-title');
  // Include album in cache key to differentiate different versions
  const album = song.album ? slugify(song.album) : '';
  return `${cacheFolder}/${artist}-${title}${album ? `-${album}` : ''}.lrc`;
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
  const primaryArtist = getPrimaryArtistName(song.artist) ?? song.artist;
  let score = 0;

  if (normalizeMatchName(candidate.trackName) === normalizeMatchName(song.title)) {
    score += 6;
  } else if (safeIncludes(candidate.trackName, song.title)) {
    score += 3;
  }

  if (normalizeMatchName(candidate.artistName) === normalizeMatchName(primaryArtist)) {
    score += 5;
  } else if (safeIncludes(candidate.artistName, primaryArtist)) {
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

const validateLyricsQuality = (lyrics: LyricsResult): boolean => {
  const lines = lyrics.lines;

  // Must have at least some content
  if (lines.length === 0) {
    return false;
  }

  // For synced lyrics, check timing consistency
  if (lyrics.isSynced) {
    const timedLines = lines.filter(line => line.timeMs !== null);
    if (timedLines.length < lines.length * 0.5) {
      return false; // Less than 50% of lines have timing
    }

    // Check for reasonable timing progression
    const times = timedLines.map(line => line.timeMs!).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      if (times[i] < times[i - 1]) {
        return false; // Timestamps not in order
      }
      if (times[i] - times[i - 1] > 300000) { // 5 minutes gap
        return false; // Unrealistic gap
      }
    }
  }

  // Check for minimum content quality
  const textLines = lines.filter(line => line.text.trim().length > 0);
  if (textLines.length < 2) {
    return false; // Need at least 2 lines of actual text
  }

  // Check for spam/repeated content
  const uniqueTexts = new Set(textLines.map(line => line.text.toLowerCase().trim()));
  if (uniqueTexts.size < textLines.length * 0.3) {
    return false; // Too much repeated content
  }

  return true;
};

const fetchSearchCandidates = async (song: Song): Promise<LyricsCandidate[]> => {
  const artist = getPrimaryArtistName(song.artist) ?? song.artist;
  const title = song.title?.trim();
  if (!artist?.trim() || !title) {
    return [];
  }

  // Create a cache key for deduplication
  const requestKey = `${artist}-${title}-${song.album ?? ''}`.toLowerCase();
  const existingRequest = pendingRequests.get(requestKey);
  if (existingRequest) {
    return existingRequest;
  }

  const requestPromise = (async () => {
    try {
      const params = new URLSearchParams();
      params.set('artist_name', artist);
      params.set('track_name', title);
      if (song.album?.trim()) {
        params.set('album_name', song.album);
      }

      const endpoint = `https://lrclib.net/api/search?${params.toString()}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      try {
        const response = await fetch(endpoint, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Amply/1.0 (https://github.com/ampl-musicplayer)',
          },
        });
        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const payload = (await response.json()) as unknown;
        if (!Array.isArray(payload)) {
          throw new Error('Invalid API response format');
        }

        const parsed = payload
          .map((entry, index) => toCandidate(song, entry as LrcLibSearchHit, index))
          .filter((entry): entry is LyricsCandidate => Boolean(entry));

        return dedupeCandidates(parsed);
      } catch (error) {
        clearTimeout(timeoutId);
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('Request timeout');
        }
        throw error;
      }
    } finally {
      pendingRequests.delete(requestKey);
    }
  })();

  pendingRequests.set(requestKey, requestPromise);
  return requestPromise;
};

const fetchSingleCandidate = async (song: Song): Promise<LyricsCandidate[]> => {
  const artist = getPrimaryArtistName(song.artist) ?? song.artist;
  const title = song.title?.trim();
  if (!artist?.trim() || !title) {
    return [];
  }

  const params = new URLSearchParams();
  params.set('artist_name', artist);
  params.set('track_name', title);
  if (song.album?.trim()) {
    params.set('album_name', song.album);
  }

  const endpoint = `https://lrclib.net/api/get?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Amply/1.0 (https://github.com/ampl-musicplayer)',
      },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as unknown;
    if (!payload || Array.isArray(payload)) {
      return [];
    }

    const candidate = toCandidate(song, payload as LrcLibSearchHit, 0);
    return candidate ? [candidate] : [];
  } catch (error) {
    clearTimeout(timeoutId);
    console.warn('[Lyrics] Single candidate fetch failed:', error);
    return [];
  }
};

// Fallback API using a different service (example implementation)
const fetchFallbackCandidates = async (song: Song): Promise<LyricsCandidate[]> => {
  // This is a placeholder for a fallback API
  // In a real implementation, you might use:
  // - Musixmatch API
  // - Genius API
  // - Local lyrics database
  // - Web scraping (with proper attribution)

  console.log('[Lyrics] Primary API failed, trying fallback for:', song.title);
  return [];
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

export const saveLyricsSelection = async (song: Song, candidate: LyricsCandidate): Promise<LyricsResult> => {
  const result = buildLyricsResult(candidate.raw, false, cacheKeyForSong(song));

  // Validate lyrics quality before saving
  if (!validateLyricsQuality(result)) {
    throw new Error('Lyrics failed quality validation');
  }

  const key = cacheKeyForSong(song);
  await writeStorageText(key, candidate.raw);
  if (song.id) {
    void markSongCached(song.id, 'lyrics');
  }
  return result;
};

export const findLyricsCandidates = async (song: Song): Promise<LyricsCandidate[]> => {
  let candidates = await fetchSearchCandidates(song);

  if (!candidates.length) {
    candidates = await fetchSingleCandidate(song);
  }

  if (!candidates.length) {
    candidates = await fetchFallbackCandidates(song);
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

    // Validate cached lyrics quality
    if (validateLyricsQuality(lyrics)) {
      if (song.id) {
        void markSongCached(song.id, 'lyrics');
      }
      return {
        status: 'ready',
        lyrics,
        cachePath: lyrics.cachePath,
      };
    } else {
      // Invalid cached lyrics, remove them
      console.warn('[Lyrics] Removing invalid cached lyrics for:', song.title);
      try {
        await writeStorageText(key, '');
      } catch (error) {
        console.warn('[Lyrics] Failed to remove invalid cache:', error);
      }
    }
  }

  const candidates = await findLyricsCandidates(song);

  if (!candidates.length) {
    return {
      status: 'missing',
      cachePath: `storage/${key}`,
    };
  }

  const ranked = rankCandidatesWithScore(song, candidates);
  const best = ranked[0]?.candidate;
  if (!best) {
    return {
      status: 'missing',
      cachePath: `storage/${key}`,
    };
  }

  try {
    const lyrics = await saveLyricsSelection(song, best);
    return { status: 'ready', lyrics, cachePath: lyrics.cachePath };
  } catch (error) {
    console.warn('[Lyrics] Failed to save best candidate:', error);
    return {
      status: 'missing',
      cachePath: `storage/${key}`,
    };
  }
};

export const readCachedLyrics = async (song: Song): Promise<LyricsLoadResult> => {
  const key = cacheKeyForSong(song);
  const cached = await readStorageText(key);
  if (cached?.trim()) {
    const lyrics = buildLyricsResult(cached, true, key);
    if (song.id) {
      void markSongCached(song.id, 'lyrics');
    }
    return { status: 'ready', lyrics, cachePath: lyrics.cachePath };
  }
  return { status: 'missing', cachePath: `storage/${key}` };
};
