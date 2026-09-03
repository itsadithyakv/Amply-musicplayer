import { djb2 as hash } from '@/utils/hash';
import { normalizeSlug as normalizeKey, normalizeToken } from '@/utils/text';
import type { Playlist, Song } from '@/types/music';
import { recordPerfEvent, recordSelectorCacheHit, recordSelectorRebuild } from '@/services/perfDiagnostics';
import { writeStorageJsonDebounced } from '@/services/storageService';
import { getPrimaryArtistName } from '@/utils/artists';

export type OnlineSignalSource = 'lastfm' | 'musicbrainz';
type OnlineSignalStatus = 'ready' | 'missing' | 'failed';

type SimilarArtistSignal = {
  name: string;
  score: number;
  source: OnlineSignalSource;
};

type SimilarTrackSignal = {
  title: string;
  artist: string;
  score: number;
  source: OnlineSignalSource;
};

export type OnlineRecommendationSignal = {
  songId: string;
  artistKey: string;
  trackKey: string;
  tags: string[];
  genres: string[];
  moods: string[];
  similarArtists: SimilarArtistSignal[];
  similarTracks: SimilarTrackSignal[];
  mbids?: {
    artist?: string;
    recording?: string;
    releaseGroup?: string;
  };
  confidence: number;
  sources: OnlineSignalSource[];
  fetchedAt: number;
  status: OnlineSignalStatus;
  failedAt?: number;
  failureCount?: number;
};

export type OnlineRecommendationSignalsBySong = Record<string, OnlineRecommendationSignal>;

type RecommendationRankingOptions = {
  limit?: number;
  seed?: number;
  discoveryLevel?: number;
  randomnessLevel?: number;
  contextSongId?: string;
  targetTags?: string[];
  recentlySurfacedIds?: Iterable<string>;
};

type RecommendationIndex = {
  builtAt: number;
  songsById: Map<string, Song>;
  byArtist: Map<string, string[]>;
  byAlbum: Map<string, string[]>;
  byGenre: Map<string, string[]>;
  byMood: Map<string, string[]>;
  byEra: Map<string, string[]>;
  onlineSignals: OnlineRecommendationSignalsBySong;
  tagsBySongId: Map<string, Set<string>>;
  similarityBySongId: Map<string, string[]>;
  onlineSignalCount: number;
};

const INDEX_SUMMARY_PATH = 'recommendations/recommendation_index.json';
const ROTATION_PATH = 'recommendations/recommendation_rotation.json';
const DAY_SEC = 86_400;
const ENHANCE_EXCLUDED_PLAYLISTS = new Set(['smart_daily_mix', 'smart_recently_played', 'smart_album_spotlight']);
const current = {
  index: null as RecommendationIndex | null,
  signature: '',
};
const surfacedRotation = new Map<string, string[]>();

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const compactSongSignal = (song: Song): string =>
  [
    song.id,
    normalizeKey(getPrimaryArtistName(song.artist) || song.artist),
    normalizeKey(song.album),
    normalizeKey(song.genre),
    song.year ?? '',
    song.favorite ? 1 : 0,
    song.playCount ?? 0,
    song.skipCount ?? 0,
    song.manualQueueAdds ?? 0,
    song.lastPlayed ?? 0,
  ].join('|');

const seededNoise = (seed: number, id: string): number => {
  const h = hash(`${seed}:${id}`);
  return (h % 10_000) / 10_000;
};

const pushIndex = (map: Map<string, string[]>, key: string, id: string): void => {
  if (!key) {
    return;
  }
  const list = map.get(key) ?? [];
  if (!list.includes(id)) {
    list.push(id);
    map.set(key, list);
  }
};

const songTrackKey = (song: Song): string =>
  `${normalizeKey(getPrimaryArtistName(song.artist) || song.artist)}::${normalizeKey(song.title || song.filename)}`;

const songAlbumKey = (song: Song): string =>
  `${normalizeKey(getPrimaryArtistName(song.artist) || song.artist)}::${normalizeKey(song.album)}`;

const yearBucketFor = (year?: number): string => {
  if (!year || year < 1900) {
    return '';
  }
  const decade = Math.floor(year / 10) * 10;
  return `${decade}s`;
};

const buildSignature = (songs: Song[], onlineSignals: OnlineRecommendationSignalsBySong): string => {
  let latestSignal = 0;
  let signalCount = 0;
  for (const signal of Object.values(onlineSignals)) {
    if (signal?.status === 'ready') {
      signalCount += 1;
      latestSignal = Math.max(latestSignal, signal.fetchedAt ?? 0);
    }
  }
  const first = songs[0]?.id ?? '';
  const last = songs[songs.length - 1]?.id ?? '';
  const songMetadataHash = hash(songs.map(compactSongSignal).join('::'));
  const onlineSignalHash = hash(
    Object.values(onlineSignals)
      .filter((signal) => signal?.status === 'ready')
      .map((signal) => [
        signal.songId,
        signal.fetchedAt,
        signal.confidence,
        signal.genres.join(','),
        signal.moods.join(','),
        signal.tags.slice(0, 8).join(','),
      ].join('|'))
      .join('::'),
  );
  return `${songs.length}:${first}:${last}:${songMetadataHash}:${signalCount}:${latestSignal}:${onlineSignalHash}`;
};

const addSongTags = (
  song: Song,
  signal: OnlineRecommendationSignal | undefined,
  tagsBySongId: Map<string, Set<string>>,
  byGenre: Map<string, string[]>,
  byMood: Map<string, string[]>,
): void => {
  const tags = new Set<string>();
  const localGenre = normalizeToken(song.genre);
  if (localGenre && localGenre !== 'unknown genre') {
    tags.add(localGenre);
    pushIndex(byGenre, localGenre, song.id);
  }
  for (const tag of signal?.genres ?? []) {
    const normalized = normalizeToken(tag);
    if (normalized) {
      tags.add(normalized);
      pushIndex(byGenre, normalized, song.id);
    }
  }
  for (const tag of signal?.tags ?? []) {
    const normalized = normalizeToken(tag);
    if (normalized) {
      tags.add(normalized);
      pushIndex(byGenre, normalized, song.id);
    }
  }
  for (const mood of signal?.moods ?? []) {
    const normalized = normalizeToken(mood);
    if (normalized) {
      tags.add(normalized);
      pushIndex(byMood, normalized, song.id);
    }
  }
  tagsBySongId.set(song.id, tags);
};

const buildRecommendationIndex = (
  songs: Song[],
  _activity: unknown = undefined,
  onlineSignals: OnlineRecommendationSignalsBySong = {},
): RecommendationIndex => {
  const signature = buildSignature(songs, onlineSignals);
  if (current.index && current.signature === signature) {
    recordSelectorCacheHit('recommendation-index');
    return current.index;
  }

  const startedAt = Date.now();
  const songsById = new Map<string, Song>();
  const byArtist = new Map<string, string[]>();
  const byAlbum = new Map<string, string[]>();
  const byGenre = new Map<string, string[]>();
  const byMood = new Map<string, string[]>();
  const byEra = new Map<string, string[]>();
  const tagsBySongId = new Map<string, Set<string>>();
  const trackKeyToId = new Map<string, string>();

  for (const song of songs) {
    songsById.set(song.id, song);
    trackKeyToId.set(songTrackKey(song), song.id);
    pushIndex(byArtist, normalizeKey(getPrimaryArtistName(song.artist) || song.artist), song.id);
    pushIndex(byAlbum, songAlbumKey(song), song.id);
    pushIndex(byEra, yearBucketFor(song.year), song.id);
    addSongTags(song, onlineSignals[song.id], tagsBySongId, byGenre, byMood);
  }

  const similarityBySongId = new Map<string, string[]>();
  let onlineSignalCount = 0;
  for (const [songId, signal] of Object.entries(onlineSignals)) {
    if (!signal || signal.status !== 'ready') {
      continue;
    }
    onlineSignalCount += 1;
    const similarIds = new Set<string>();
    for (const track of signal.similarTracks ?? []) {
      const trackId = trackKeyToId.get(`${normalizeKey(track.artist)}::${normalizeKey(track.title)}`);
      if (trackId && trackId !== songId) {
        similarIds.add(trackId);
      }
    }
    for (const artist of signal.similarArtists ?? []) {
      for (const id of byArtist.get(normalizeKey(artist.name)) ?? []) {
        if (id !== songId) {
          similarIds.add(id);
        }
      }
    }
    if (similarIds.size) {
      similarityBySongId.set(songId, [...similarIds]);
    }
  }

  const index: RecommendationIndex = {
    builtAt: Date.now(),
    songsById,
    byArtist,
    byAlbum,
    byGenre,
    byMood,
    byEra,
    onlineSignals,
    tagsBySongId,
    similarityBySongId,
    onlineSignalCount,
  };
  current.index = index;
  current.signature = signature;
  recordSelectorRebuild('recommendation-index');
  recordPerfEvent('recommendation.index.build', {
    songs: songs.length,
    onlineSignalCount,
    durationMs: Date.now() - startedAt,
  });
  void writeStorageJsonDebounced(
    INDEX_SUMMARY_PATH,
    {
      schemaVersion: 1,
      updatedAt: Date.now(),
      songCount: songs.length,
      onlineSignalCount,
      genreBuckets: byGenre.size,
      moodBuckets: byMood.size,
      similarityEdges: [...similarityBySongId.values()].reduce((sum, ids) => sum + ids.length, 0),
    },
    1800,
  );
  return index;
};

const requireIndex = (): RecommendationIndex | null => current.index;

const baseSongScore = (
  song: Song,
  signal: OnlineRecommendationSignal | undefined,
  now: number,
  discoveryLevel: number,
): number => {
  const daysSincePlayed = song.lastPlayed ? Math.max(0, (now - song.lastPlayed) / DAY_SEC) : 180;
  const completionRate =
    song.playCount && song.duration > 0 && song.totalPlaySeconds
      ? clamp01(song.totalPlaySeconds / Math.max(1, song.playCount * song.duration))
      : 0.55;
  const skipPenalty = Math.min(1.8, (song.skipCount ?? 0) * 0.16);
  const favoriteBoost = song.favorite ? 1.25 : 0;
  const playBoost = Math.sqrt(Math.max(0, song.playCount ?? 0)) * (0.18 + (1 - discoveryLevel) * 0.12);
  const freshnessBoost = Math.min(1.4, daysSincePlayed / 90) * (0.4 + discoveryLevel * 0.9);
  const queueBoost = Math.sqrt(Math.max(0, song.manualQueueAdds ?? 0)) * 0.18;
  const onlineBoost = signal?.status === 'ready' ? clamp01(signal.confidence) * 0.36 : 0;
  return favoriteBoost + playBoost + freshnessBoost + queueBoost + completionRate * 0.55 + onlineBoost - skipPenalty;
};

const rankRecommendations = (
  candidateIds: string[],
  options: RecommendationRankingOptions = {},
): string[] => {
  const index = requireIndex();
  if (!index || candidateIds.length <= 1) {
    return candidateIds;
  }
  const startedAt = Date.now();
  const now = Math.floor(Date.now() / 1000);
  const seed = options.seed ?? now;
  const discoveryLevel = clamp01(options.discoveryLevel ?? 0.35);
  const randomnessLevel = clamp01(options.randomnessLevel ?? 0.3);
  const targetTags = new Set((options.targetTags ?? []).map(normalizeToken).filter(Boolean));
  const recentlySurfacedIds = new Set(options.recentlySurfacedIds ?? []);
  const contextSimilar = new Set(
    options.contextSongId ? index.similarityBySongId.get(options.contextSongId) ?? [] : [],
  );

  const scored = candidateIds
    .map((id) => {
      const song = index.songsById.get(id);
      if (!song) {
        return null;
      }
      const tags = index.tagsBySongId.get(id) ?? new Set<string>();
      let tagBoost = 0;
      for (const tag of targetTags) {
        if (tags.has(tag)) {
          tagBoost += 0.28;
        }
      }
      const score =
        baseSongScore(song, index.onlineSignals[id], now, discoveryLevel) +
        tagBoost +
        (contextSimilar.has(id) ? 0.65 : 0) -
        (recentlySurfacedIds.has(id) ? 0.9 : 0) +
        seededNoise(seed, id) * (0.2 + randomnessLevel * 0.8);
      return { id, song, score };
    })
    .filter((entry): entry is { id: string; song: Song; score: number } => Boolean(entry))
    .sort((a, b) => b.score - a.score);

  const result: string[] = [];
  const artistCounts = new Map<string, number>();
  const albumCounts = new Map<string, number>();
  const limit = options.limit ?? scored.length;

  while (result.length < limit && scored.length) {
    let bestIndex = 0;
    let bestAdjusted = Number.NEGATIVE_INFINITY;
    for (let indexOffset = 0; indexOffset < Math.min(scored.length, 40); indexOffset += 1) {
      const entry = scored[indexOffset];
      const artist = normalizeKey(getPrimaryArtistName(entry.song.artist) || entry.song.artist);
      const album = songAlbumKey(entry.song);
      const adjusted =
        entry.score -
        (artistCounts.get(artist) ?? 0) * (0.62 + randomnessLevel * 0.5) -
        (albumCounts.get(album) ?? 0) * (0.78 + randomnessLevel * 0.6);
      if (adjusted > bestAdjusted) {
        bestAdjusted = adjusted;
        bestIndex = indexOffset;
      }
    }
    const [picked] = scored.splice(bestIndex, 1);
    result.push(picked.id);
    const artist = normalizeKey(getPrimaryArtistName(picked.song.artist) || picked.song.artist);
    const album = songAlbumKey(picked.song);
    artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    albumCounts.set(album, (albumCounts.get(album) ?? 0) + 1);
  }

  recordPerfEvent('recommendation.rank', {
    candidates: candidateIds.length,
    returned: result.length,
    durationMs: Date.now() - startedAt,
  });
  return result;
};

const inferPlaylistTags = (playlist: Playlist): string[] => {
  const source = `${playlist.id} ${playlist.name} ${playlist.description}`;
  const tags = [
    'pop',
    'rock',
    'hip hop',
    'electronic',
    'dance',
    'indie',
    'jazz',
    'classical',
    'country',
    'latin',
    'r and b',
    'soul',
    'chill',
    'energetic',
    'focus',
    'acoustic',
  ];
  const normalized = normalizeToken(source);
  return tags.filter((tag) => normalized.includes(normalizeToken(tag)));
};

export const enhanceSmartPlaylistsWithRecommendationIndex = (
  playlists: Playlist[],
  songs: Song[],
  onlineSignals: OnlineRecommendationSignalsBySong = {},
  options: {
    seed?: number;
    discoveryLevel?: number;
    randomnessLevel?: number;
  } = {},
): Playlist[] => {
  if (!playlists.length || !songs.length) {
    return playlists;
  }
  const signalCount = Object.values(onlineSignals).filter((signal) => signal?.status === 'ready').length;
  if (!signalCount) {
    return playlists;
  }

  buildRecommendationIndex(songs, undefined, onlineSignals);
  const seed = options.seed ?? Date.now();
  const enhanced = playlists.map((playlist) => {
    if (ENHANCE_EXCLUDED_PLAYLISTS.has(playlist.id) || playlist.songIds.length <= 3) {
      return playlist;
    }
    const ranked = rankRecommendations(playlist.songIds, {
      limit: playlist.songIds.length,
      seed: seed + hash(playlist.id),
      discoveryLevel: options.discoveryLevel,
      randomnessLevel: options.randomnessLevel,
      targetTags: inferPlaylistTags(playlist),
      recentlySurfacedIds: surfacedRotation.get(playlist.id) ?? [],
    });
    if (ranked.length !== playlist.songIds.length) {
      return playlist;
    }
    surfacedRotation.set(playlist.id, ranked.slice(0, 24));
    const changed = ranked.some((id, index) => id !== playlist.songIds[index]);
    return changed ? { ...playlist, songIds: ranked } : playlist;
  });

  recordPerfEvent('recommendation.playlists.enhance', {
    playlists: playlists.length,
    onlineSignalCount: signalCount,
  });
  void writeStorageJsonDebounced(
    ROTATION_PATH,
    {
      schemaVersion: 1,
      updatedAt: Date.now(),
      playlists: Object.fromEntries(surfacedRotation.entries()),
    },
    2200,
  );
  return enhanced;
};
