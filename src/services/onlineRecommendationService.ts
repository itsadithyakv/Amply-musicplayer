import type { AppSettings, OnlineRecommendationProvider, Song } from '@/types/music';
import {
  type OnlineRecommendationSignal,
  type OnlineRecommendationSignalsBySong,
  type OnlineSignalSource,
} from '@/services/recommendationIndex';
import { scheduleIdle } from '@/services/playbackScheduler';
import { recordPerfEvent } from '@/services/perfDiagnostics';
import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { getMetadataLookupParts, getPrimaryArtistName, normalizeArtistLookupText } from '@/utils/artists';

type CachedProviderResponse = {
  source: OnlineSignalSource;
  status: 'ready' | 'failed';
  fetchedAt: number;
  cooldownUntil?: number;
  data?: unknown;
  error?: string;
};

type OnlineRecommendationCache = {
  schemaVersion: 1;
  updatedAt: number;
  signals: OnlineRecommendationSignalsBySong;
  providerResponses: Record<string, CachedProviderResponse>;
};

type RecommendationDiagnostics = {
  schemaVersion: 1;
  updatedAt: number;
  queueSize: number;
  providerHits: Record<OnlineSignalSource, number>;
  providerMisses: Record<OnlineSignalSource, number>;
  providerFailures: Record<OnlineSignalSource, number>;
  cacheHits: number;
  cacheMisses: number;
  skippedDuringPlayback: number;
  enrichmentRuns: number;
  onlineSignalCoverage: number;
  lastGenerationMs: number;
};

type OnlineRecommendationConfig = {
  enabled: boolean;
  lastFmApiKey: string;
  providerOrder: OnlineRecommendationProvider[];
};

type LastFmTag = {
  name?: string;
  count?: string | number;
};

type LastFmArtist = {
  name?: string;
  match?: string | number;
};

type LastFmTrack = {
  name?: string;
  artist?: string | { name?: string };
  match?: string | number;
};

type MusicBrainzRecording = {
  id?: string;
  score?: number;
  title?: string;
  tags?: Array<{ name?: string; count?: number }>;
  genres?: Array<{ name?: string; count?: number }>;
  'artist-credit'?: Array<{
    name?: string;
    artist?: {
      id?: string;
      name?: string;
      disambiguation?: string;
      tags?: Array<{ name?: string; count?: number }>;
      genres?: Array<{ name?: string; count?: number }>;
    };
  }>;
};

const CACHE_PATH = 'recommendations/online_recommendation_signals.json';
const DIAGNOSTICS_PATH = 'recommendations/recommendation_diagnostics.json';
const PROVIDER_CACHE_MAX = 900;
const SIGNAL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const FAILURE_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ENRICHMENT_BATCH_SIZE = 10;

const defaultCache: OnlineRecommendationCache = {
  schemaVersion: 1,
  updatedAt: 0,
  signals: {},
  providerResponses: {},
};

const defaultDiagnostics: RecommendationDiagnostics = {
  schemaVersion: 1,
  updatedAt: 0,
  queueSize: 0,
  providerHits: { lastfm: 0, musicbrainz: 0 },
  providerMisses: { lastfm: 0, musicbrainz: 0 },
  providerFailures: { lastfm: 0, musicbrainz: 0 },
  cacheHits: 0,
  cacheMisses: 0,
  skippedDuringPlayback: 0,
  enrichmentRuns: 0,
  onlineSignalCoverage: 0,
  lastGenerationMs: 0,
};

let cache: OnlineRecommendationCache | null = null;
let cachePromise: Promise<OnlineRecommendationCache> | null = null;
let diagnostics: RecommendationDiagnostics = { ...defaultDiagnostics };
let diagnosticsLoaded = false;
let config: OnlineRecommendationConfig = {
  enabled: false,
  lastFmApiKey: '',
  providerOrder: ['lastfm', 'musicbrainz'],
};
let configHydrated = false;
let songResolver: ((songId: string) => Song | undefined) | null = null;
let changedHandler: ((changedIds: string[]) => void) | null = null;
let activeBatch = false;
let musicBrainzLastRequestAt = 0;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeToken = (value: string | undefined | null): string =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeKey = (value: string | undefined | null): string => normalizeToken(value).replace(/\s+/g, '-');

const isCloseMetadataMatch = (candidate: string | undefined | null, target: string | undefined | null): boolean => {
  const left = normalizeArtistLookupText(candidate ?? '');
  const right = normalizeArtistLookupText(target ?? '');
  if (!left || !right) {
    return false;
  }
  return left === right || (left.length >= 3 && right.length >= 3 && (left.includes(right) || right.includes(left)));
};

const recordingArtistNames = (recording: MusicBrainzRecording): string =>
  (recording['artist-credit'] ?? [])
    .map((credit) => credit.name ?? credit.artist?.name ?? '')
    .filter(Boolean)
    .join(', ');

const scoreMusicBrainzRecording = (recording: MusicBrainzRecording, artist: string, title: string): number => {
  if (!isCloseMetadataMatch(recording.title, title)) {
    return 0;
  }
  const artistNames = recordingArtistNames(recording);
  if (!isCloseMetadataMatch(artistNames, artist)) {
    return 0;
  }
  const providerScore = typeof recording.score === 'number' ? Math.min(100, Math.max(0, recording.score)) / 10 : 0;
  const exactTitle = normalizeArtistLookupText(recording.title ?? '') === normalizeArtistLookupText(title) ? 8 : 4;
  const exactArtist = normalizeArtistLookupText(artistNames) === normalizeArtistLookupText(artist) ? 8 : 4;
  const tagScore = (recording.genres?.length ?? 0) * 2 + (recording.tags?.length ?? 0);
  return providerScore + exactTitle + exactArtist + tagScore;
};

const pickBestMusicBrainzRecording = (
  recordings: MusicBrainzRecording[],
  artist: string,
  title: string,
): MusicBrainzRecording | undefined =>
  [...recordings]
    .map((recording) => ({ recording, score: scoreMusicBrainzRecording(recording, artist, title) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.recording;

const normalizeProviderOrder = (value: unknown): OnlineRecommendationProvider[] => {
  if (!Array.isArray(value)) {
    return ['lastfm', 'musicbrainz'];
  }
  const allowed = new Set<OnlineRecommendationProvider>(['lastfm', 'musicbrainz']);
  const normalized = value.filter((entry): entry is OnlineRecommendationProvider => allowed.has(entry));
  return normalized.length ? [...new Set(normalized)] : ['lastfm', 'musicbrainz'];
};

const normalizeConfig = (settings: Partial<AppSettings>): OnlineRecommendationConfig => ({
  enabled: settings.onlineRecommendationsEnabled === true,
  lastFmApiKey: typeof settings.lastFmApiKey === 'string' ? settings.lastFmApiKey.trim() : '',
  providerOrder: normalizeProviderOrder(settings.onlineRecommendationProviderOrder),
});

const isPlaybackBusy = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const flags = window as unknown as { __AMP_IS_PLAYING__?: boolean };
  return flags.__AMP_IS_PLAYING__ === true;
};

const bumpDiagnostic = (mutate: (next: RecommendationDiagnostics) => void): void => {
  diagnostics = {
    ...diagnostics,
    providerHits: { ...diagnostics.providerHits },
    providerMisses: { ...diagnostics.providerMisses },
    providerFailures: { ...diagnostics.providerFailures },
    updatedAt: Date.now(),
  };
  mutate(diagnostics);
  void writeStorageJsonDebounced(DIAGNOSTICS_PATH, diagnostics, 1800);
};

const loadDiagnostics = async (): Promise<void> => {
  if (diagnosticsLoaded) {
    return;
  }
  diagnosticsLoaded = true;
  const persisted = await readStorageJson<RecommendationDiagnostics>(DIAGNOSTICS_PATH, defaultDiagnostics);
  diagnostics = {
    ...defaultDiagnostics,
    ...persisted,
    providerHits: { ...defaultDiagnostics.providerHits, ...(persisted.providerHits ?? {}) },
    providerMisses: { ...defaultDiagnostics.providerMisses, ...(persisted.providerMisses ?? {}) },
    providerFailures: { ...defaultDiagnostics.providerFailures, ...(persisted.providerFailures ?? {}) },
  };
};

const normalizeCache = (persisted: Partial<OnlineRecommendationCache> | null): OnlineRecommendationCache => ({
  schemaVersion: 1,
  updatedAt: typeof persisted?.updatedAt === 'number' ? persisted.updatedAt : 0,
  signals: persisted?.signals && typeof persisted.signals === 'object' ? persisted.signals : {},
  providerResponses:
    persisted?.providerResponses && typeof persisted.providerResponses === 'object'
      ? persisted.providerResponses
      : {},
});

const loadCache = async (): Promise<OnlineRecommendationCache> => {
  if (cache) {
    return cache;
  }
  if (!cachePromise) {
    cachePromise = readStorageJson<OnlineRecommendationCache>(CACHE_PATH, defaultCache).then((persisted) => {
      cache = normalizeCache(persisted);
      return cache;
    });
  }
  return cachePromise;
};

const persistCache = async (next: OnlineRecommendationCache): Promise<void> => {
  const responseEntries = Object.entries(next.providerResponses)
    .sort((a, b) => (b[1].fetchedAt ?? 0) - (a[1].fetchedAt ?? 0))
    .slice(0, PROVIDER_CACHE_MAX);
  cache = {
    ...next,
    providerResponses: Object.fromEntries(responseEntries),
    updatedAt: Date.now(),
  };
  void writeStorageJsonDebounced(CACHE_PATH, cache, 1800);
};

const ensureConfig = async (): Promise<OnlineRecommendationConfig> => {
  if (configHydrated) {
    return config;
  }
  const persisted = await readStorageJson<Partial<AppSettings> & Record<string, unknown>>('settings.json', {});
  config = normalizeConfig(persisted);
  configHydrated = true;
  return config;
};

const scoreFromUnknown = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

const requestJson = async (url: string, timeoutMs = 7000): Promise<unknown> => {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(handle);
  }
};

const fetchCachedJson = async (
  source: OnlineSignalSource,
  cacheKey: string,
  url: string,
  maxAgeMs = SIGNAL_TTL_MS,
): Promise<unknown | null> => {
  const onlineCache = await loadCache();
  const cached = onlineCache.providerResponses[cacheKey];
  const now = Date.now();
  if (cached?.status === 'ready' && cached.data && now - cached.fetchedAt < maxAgeMs) {
    bumpDiagnostic((next) => {
      next.providerHits[source] += 1;
    });
    return cached.data;
  }
  if (cached?.status === 'failed' && cached.cooldownUntil && cached.cooldownUntil > now) {
    bumpDiagnostic((next) => {
      next.providerFailures[source] += 1;
    });
    return null;
  }

  bumpDiagnostic((next) => {
    next.providerMisses[source] += 1;
  });
  try {
    if (source === 'musicbrainz') {
      const waitMs = Math.max(0, 1100 - (Date.now() - musicBrainzLastRequestAt));
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      musicBrainzLastRequestAt = Date.now();
    }
    const data = await requestJson(url);
    onlineCache.providerResponses[cacheKey] = {
      source,
      status: 'ready',
      fetchedAt: Date.now(),
      data,
    };
    await persistCache(onlineCache);
    return data;
  } catch (error) {
    onlineCache.providerResponses[cacheKey] = {
      source,
      status: 'failed',
      fetchedAt: Date.now(),
      cooldownUntil: Date.now() + FAILURE_COOLDOWN_MS,
      error: error instanceof Error ? error.message : 'Request failed',
    };
    await persistCache(onlineCache);
    bumpDiagnostic((next) => {
      next.providerFailures[source] += 1;
    });
    return null;
  }
};

const unique = (values: string[], limit = 16): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeToken(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
};

const normalizeOnlineTags = (rawTags: string[]): { tags: string[]; genres: string[]; moods: string[] } => {
  const genres: string[] = [];
  const moods: string[] = [];
  const tags: string[] = [];
  const genreRules: Array<{ label: string; words: string[] }> = [
    { label: 'pop', words: ['pop', 'k pop', 'kpop'] },
    { label: 'rock', words: ['rock', 'punk', 'metal', 'grunge', 'alternative'] },
    { label: 'hip hop', words: ['hip hop', 'hip-hop', 'rap', 'trap'] },
    { label: 'electronic', words: ['electronic', 'edm', 'dance', 'house', 'techno', 'trance', 'dubstep'] },
    { label: 'r and b', words: ['r and b', 'r&b', 'soul', 'neo soul'] },
    { label: 'indie', words: ['indie', 'lofi', 'lo fi'] },
    { label: 'jazz', words: ['jazz', 'swing', 'bebop'] },
    { label: 'classical', words: ['classical', 'orchestral', 'symphony'] },
    { label: 'country', words: ['country', 'americana'] },
    { label: 'latin', words: ['latin', 'reggaeton', 'salsa', 'bachata'] },
    { label: 'world', words: ['world', 'bollywood', 'hindi', 'indian', 'afrobeat'] },
  ];
  const moodRules: Array<{ label: string; words: string[] }> = [
    { label: 'chill', words: ['chill', 'relax', 'ambient', 'downtempo', 'mellow'] },
    { label: 'energetic', words: ['energetic', 'party', 'workout', 'upbeat', 'anthem'] },
    { label: 'focus', words: ['focus', 'study', 'instrumental', 'minimal'] },
    { label: 'dark', words: ['dark', 'moody', 'melancholy'] },
    { label: 'happy', words: ['happy', 'summer', 'feel good'] },
    { label: 'sad', words: ['sad', 'heartbreak', 'emo'] },
    { label: 'acoustic', words: ['acoustic', 'folk', 'singer songwriter'] },
  ];

  for (const raw of rawTags) {
    const tag = normalizeToken(raw);
    if (!tag) {
      continue;
    }
    tags.push(tag);
    const genre = genreRules.find((rule) => rule.words.some((word) => tag.includes(normalizeToken(word))));
    if (genre) {
      genres.push(genre.label);
    }
    const mood = moodRules.find((rule) => rule.words.some((word) => tag.includes(normalizeToken(word))));
    if (mood) {
      moods.push(mood.label);
    }
  }

  return {
    tags: unique(tags, 20),
    genres: unique(genres, 8),
    moods: unique(moods, 8),
  };
};

const lastFmUrl = (apiKey: string, method: string, params: Record<string, string>): string => {
  const query = new URLSearchParams({
    method,
    api_key: apiKey,
    format: 'json',
    autocorrect: '1',
    ...params,
  });
  return `https://ws.audioscrobbler.com/2.0/?${query.toString()}`;
};

const extractLastFmTags = (value: unknown): string[] => {
  const root = value as { toptags?: { tag?: LastFmTag[] } } | null;
  const tags = Array.isArray(root?.toptags?.tag) ? root.toptags.tag : [];
  return tags
    .sort((a, b) => scoreFromUnknown(b.count) - scoreFromUnknown(a.count))
    .map((tag) => tag.name ?? '')
    .filter(Boolean)
    .slice(0, 16);
};

const extractLastFmSimilarArtists = (value: unknown): Array<{ name: string; score: number }> => {
  const root = value as { similarartists?: { artist?: LastFmArtist[] } } | null;
  const artists = Array.isArray(root?.similarartists?.artist) ? root.similarartists.artist : [];
  return artists
    .map((artist) => ({ name: artist.name ?? '', score: scoreFromUnknown(artist.match) || 0.4 }))
    .filter((artist) => artist.name)
    .slice(0, 20);
};

const extractLastFmSimilarTracks = (value: unknown): Array<{ title: string; artist: string; score: number }> => {
  const root = value as { similartracks?: { track?: LastFmTrack[] } } | null;
  const tracks = Array.isArray(root?.similartracks?.track) ? root.similartracks.track : [];
  return tracks
    .map((track) => ({
      title: track.name ?? '',
      artist:
        typeof track.artist === 'string'
          ? track.artist
          : typeof track.artist?.name === 'string'
            ? track.artist.name
            : '',
      score: scoreFromUnknown(track.match) || 0.35,
    }))
    .filter((track) => track.title && track.artist)
    .slice(0, 24);
};

const fetchLastFmSignals = async (
  song: Song,
  apiKey: string,
): Promise<Pick<OnlineRecommendationSignal, 'tags' | 'genres' | 'moods' | 'similarArtists' | 'similarTracks' | 'sources'>> => {
  if (!apiKey) {
    return { tags: [], genres: [], moods: [], similarArtists: [], similarTracks: [], sources: [] };
  }
  const lookup = getMetadataLookupParts(song.artist, song.title || song.filename);
  const artist = lookup.artist || getPrimaryArtistName(song.artist) || song.artist;
  const track = lookup.title || song.title || song.filename;
  const artistKey = normalizeKey(artist);
  const trackKey = normalizeKey(track);
  const [artistTags, trackTags, similarArtists, similarTracks] = await Promise.all([
    fetchCachedJson(
      'lastfm',
      `lastfm:artist-tags:${artistKey}`,
      lastFmUrl(apiKey, 'artist.getTopTags', { artist }),
    ),
    fetchCachedJson(
      'lastfm',
      `lastfm:track-tags:${artistKey}:${trackKey}`,
      lastFmUrl(apiKey, 'track.getTopTags', { artist, track }),
    ),
    fetchCachedJson(
      'lastfm',
      `lastfm:similar-artists:${artistKey}`,
      lastFmUrl(apiKey, 'artist.getSimilar', { artist, limit: '20' }),
    ),
    fetchCachedJson(
      'lastfm',
      `lastfm:similar-tracks:${artistKey}:${trackKey}`,
      lastFmUrl(apiKey, 'track.getSimilar', { artist, track, limit: '24' }),
    ),
  ]);
  const normalized = normalizeOnlineTags([...extractLastFmTags(artistTags), ...extractLastFmTags(trackTags)]);
  const source: OnlineSignalSource = 'lastfm';
  return {
    ...normalized,
    similarArtists: extractLastFmSimilarArtists(similarArtists).map((entry) => ({ ...entry, source })),
    similarTracks: extractLastFmSimilarTracks(similarTracks).map((entry) => ({ ...entry, source })),
    sources:
      normalized.tags.length || similarArtists || similarTracks
        ? ['lastfm']
        : [],
  };
};

const fetchMusicBrainzSignals = async (
  song: Song,
): Promise<Pick<OnlineRecommendationSignal, 'tags' | 'genres' | 'moods' | 'similarArtists' | 'similarTracks' | 'sources' | 'mbids'>> => {
  const lookup = getMetadataLookupParts(song.artist, song.title || song.filename);
  const artist = lookup.artist || getPrimaryArtistName(song.artist) || song.artist;
  const track = lookup.title || song.title || song.filename;
  const artistKey = normalizeKey(artist);
  const trackKey = normalizeKey(track);
  const query = new URLSearchParams({
    fmt: 'json',
    limit: '8',
    inc: 'tags+genres+artist-credits',
    query: `recording:"${track.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`,
  });
  const response = await fetchCachedJson(
    'musicbrainz',
    `musicbrainz:recording:${artistKey}:${trackKey}`,
    `https://musicbrainz.org/ws/2/recording/?${query.toString()}`,
  );
  const root = response as { recordings?: MusicBrainzRecording[] } | null;
  const recording = Array.isArray(root?.recordings)
    ? pickBestMusicBrainzRecording(root.recordings, artist, track)
    : undefined;
  const artistCreditTags =
    recording?.['artist-credit']?.flatMap((credit) => [
      ...(credit.artist?.genres ?? []).map((entry) => entry.name ?? ''),
      ...(credit.artist?.tags ?? []).map((entry) => entry.name ?? ''),
      credit.artist?.disambiguation ?? '',
    ]) ?? [];
  const rawTags = [
    ...(recording?.genres ?? []).map((entry) => entry.name ?? ''),
    ...(recording?.tags ?? []).map((entry) => entry.name ?? ''),
    ...artistCreditTags,
  ];
  const normalized = normalizeOnlineTags(rawTags);
  return {
    ...normalized,
    similarArtists: [],
    similarTracks: [],
    sources: normalized.tags.length || normalized.genres.length ? ['musicbrainz'] : [],
    mbids: {
      recording: recording?.id,
      artist: recording?.['artist-credit']?.[0]?.artist?.id,
    },
  };
};

const mergeSignals = (
  song: Song,
  parts: Array<Partial<OnlineRecommendationSignal>>,
  previous?: OnlineRecommendationSignal,
): OnlineRecommendationSignal => {
  const lookup = getMetadataLookupParts(song.artist, song.title || song.filename);
  const artist = lookup.artist || getPrimaryArtistName(song.artist) || song.artist;
  const track = lookup.title || song.title || song.filename;
  const tags = unique(parts.flatMap((part) => part.tags ?? []), 24);
  const genres = unique(parts.flatMap((part) => part.genres ?? []), 10);
  const moods = unique(parts.flatMap((part) => part.moods ?? []), 10);
  const similarArtists = parts.flatMap((part) => part.similarArtists ?? []).slice(0, 28);
  const similarTracks = parts.flatMap((part) => part.similarTracks ?? []).slice(0, 32);
  const sources = unique(parts.flatMap((part) => part.sources ?? []), 4) as OnlineSignalSource[];
  const confidence = Math.min(
    1,
    sources.length * 0.26 + tags.length * 0.025 + genres.length * 0.05 + moods.length * 0.04 + similarArtists.length * 0.012,
  );
  const ready = Boolean(tags.length || genres.length || moods.length || similarArtists.length || similarTracks.length);
  const now = Date.now();
  return {
    songId: song.id,
    artistKey: normalizeKey(artist),
    trackKey: `${normalizeKey(artist)}::${normalizeKey(track)}`,
    tags,
    genres,
    moods,
    similarArtists,
    similarTracks,
    mbids: parts.find((part) => part.mbids)?.mbids ?? previous?.mbids,
    confidence,
    sources,
    fetchedAt: now,
    status: ready ? 'ready' : 'missing',
    failureCount: previous?.failureCount ?? 0,
  };
};

export const setRecommendationSongResolver = (resolver: (songId: string) => Song | undefined): void => {
  songResolver = resolver;
};

export const setOnlineRecommendationRefreshHandler = (handler: (changedIds: string[]) => void): void => {
  changedHandler = handler;
};

export const enableOnlineRecommendations = (settings: Partial<AppSettings>): void => {
  config = normalizeConfig(settings);
  configHydrated = true;
  if (typeof window !== 'undefined') {
    (window as unknown as { __AMP_ONLINE_RECS_ENABLED__?: boolean }).__AMP_ONLINE_RECS_ENABLED__ = config.enabled;
  }
  recordPerfEvent('recommendation.online.config', {
    enabled: config.enabled,
    providers: config.providerOrder,
    hasLastFmKey: Boolean(config.lastFmApiKey),
  });
};

export const loadOnlineRecommendationSignals = async (): Promise<OnlineRecommendationSignalsBySong> => {
  const onlineCache = await loadCache();
  return onlineCache.signals;
};

const refreshOnlineSignals = async (
  target: string | { songId?: string; artistKey?: string; albumKey?: string },
): Promise<OnlineRecommendationSignal | undefined> => {
  await Promise.all([loadDiagnostics(), loadCache()]);
  const settings = await ensureConfig();
  if (!settings.enabled) {
    recordPerfEvent('recommendation.online.skip', { reason: 'disabled' });
    return undefined;
  }

  const songId = typeof target === 'string' ? target : target.songId;
  if (!songId || !songResolver) {
    return undefined;
  }
  const song = songResolver(songId);
  if (!song) {
    return undefined;
  }

  const onlineCache = await loadCache();
  const previous = onlineCache.signals[songId];
  if (previous?.status === 'ready' && Date.now() - previous.fetchedAt < SIGNAL_TTL_MS) {
    bumpDiagnostic((next) => {
      next.cacheHits += 1;
    });
    return previous;
  }
  if (previous?.status === 'failed' && previous.failedAt && Date.now() - previous.failedAt < FAILURE_COOLDOWN_MS) {
    bumpDiagnostic((next) => {
      next.cacheHits += 1;
    });
    return previous;
  }

  bumpDiagnostic((next) => {
    next.cacheMisses += 1;
  });

  const startedAt = Date.now();
  const parts: Array<Partial<OnlineRecommendationSignal>> = [];
  for (const provider of settings.providerOrder) {
    if (provider === 'lastfm') {
      if (!settings.lastFmApiKey) {
        continue;
      }
      parts.push(await fetchLastFmSignals(song, settings.lastFmApiKey));
    } else if (provider === 'musicbrainz') {
      parts.push(await fetchMusicBrainzSignals(song));
    }
  }

  let signal: OnlineRecommendationSignal;
  try {
    signal = mergeSignals(song, parts, previous);
  } catch (error) {
    const lookup = getMetadataLookupParts(song.artist, song.title || song.filename);
    const artist = lookup.artist || song.artist;
    const track = lookup.title || song.title || song.filename;
    signal = {
      songId: song.id,
      artistKey: normalizeKey(artist),
      trackKey: `${normalizeKey(artist)}::${normalizeKey(track)}`,
      tags: [],
      genres: [],
      moods: [],
      similarArtists: [],
      similarTracks: [],
      confidence: 0,
      sources: [],
      fetchedAt: Date.now(),
      status: 'failed',
      failedAt: Date.now(),
      failureCount: (previous?.failureCount ?? 0) + 1,
    };
    recordPerfEvent('recommendation.online.error', {
      songId,
      message: error instanceof Error ? error.message : 'Signal merge failed',
    });
  }

  onlineCache.signals[songId] = signal;
  await persistCache(onlineCache);
  bumpDiagnostic((next) => {
    next.lastGenerationMs = Date.now() - startedAt;
  });
  recordPerfEvent('recommendation.online.refresh', {
    songId,
    status: signal.status,
    sources: signal.sources,
    durationMs: Date.now() - startedAt,
  });
  return signal;
};

export const scheduleOnlineEnrichment = (
  songIds: string[],
  priority: 'idle' | 'background' | 'visible-route' = 'idle',
  options: { onSignalsChanged?: (changedIds: string[]) => void } = {},
): (() => void) => {
  const uniqueIds = [...new Set(songIds.filter(Boolean))].slice(0, ENRICHMENT_BATCH_SIZE);
  if (!uniqueIds.length) {
    return () => {};
  }
  if (isPlaybackBusy()) {
    bumpDiagnostic((next) => {
      next.skippedDuringPlayback += 1;
      next.queueSize = uniqueIds.length;
    });
    recordPerfEvent('recommendation.online.skip', { reason: 'playback-active', queued: uniqueIds.length });
    return () => {};
  }

  return scheduleIdle(
    async () => {
      if (activeBatch || isPlaybackBusy()) {
        bumpDiagnostic((next) => {
          next.skippedDuringPlayback += 1;
          next.queueSize = uniqueIds.length;
        });
        return;
      }
      const settings = await ensureConfig();
      if (!settings.enabled) {
        return;
      }
      activeBatch = true;
      const changedIds: string[] = [];
      const startedAt = Date.now();
      try {
        for (const songId of uniqueIds) {
          if (isPlaybackBusy()) {
            break;
          }
          const before = (await loadCache()).signals[songId]?.fetchedAt ?? 0;
          const signal = await refreshOnlineSignals(songId);
          if (signal && signal.fetchedAt !== before) {
            changedIds.push(songId);
          }
        }
      } finally {
        activeBatch = false;
      }
      const onlineCache = await loadCache();
      const signalCount = Object.values(onlineCache.signals).filter((signal) => signal.status === 'ready').length;
      bumpDiagnostic((next) => {
        next.queueSize = Math.max(0, uniqueIds.length - changedIds.length);
        next.enrichmentRuns += 1;
        next.onlineSignalCoverage = signalCount;
        next.lastGenerationMs = Date.now() - startedAt;
      });
      if (changedIds.length) {
        options.onSignalsChanged?.(changedIds);
        changedHandler?.(changedIds);
      }
    },
    {
      delayMs: priority === 'background' ? 4500 : 1600,
      timeoutMs: priority === 'background' ? 9000 : 5000,
      groupKey: 'online-recommendations',
      reason: `recommendation.online.${priority}`,
    },
  );
};

export const pickOnlineRecommendationSeedIds = (songs: Song[], limit = 48): string[] => {
  return [...songs]
    .map((song) => {
      const knownGenre = normalizeToken(song.genre) && normalizeToken(song.genre) !== 'unknown genre';
      const score =
        (song.favorite ? 80 : 0) +
        Math.sqrt(Math.max(0, song.playCount ?? 0)) * 12 +
        Math.sqrt(Math.max(0, song.manualQueueAdds ?? 0)) * 10 +
        (knownGenre ? 0 : 18) +
        (song.lastPlayed ? 8 : 0);
      return { id: song.id, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.id);
};
