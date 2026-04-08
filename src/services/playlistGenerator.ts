import type { ListeningProfile, Playlist, Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';
import {
  getAlbumTracklistKey,
  normalizeTrackTitle,
  type AlbumTracklistCache,
} from '@/services/albumTracklistService';
import { isUnknownGenre } from '@/services/songMetadataService';
import { buildAlbumArtFrequency, buildArtworkSet } from '@/services/playlistArtworkService';

const byPlayCount = (a: Song, b: Song) => b.playCount - a.playCount;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const DAY_SEC = 86_400;

const hash = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
};

const rngFor = (seed: number, salt: string): (() => number) => mulberry32(hash(`${salt}:${seed}`));

const seededShuffle = (songs: Song[], seed: number, salt = 'shuffle'): Song[] => {
  const rng = rngFor(seed, salt);
  const shuffled = [...songs];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

const getIsoWeek = (date: Date): { year: number; week: number } => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
};

const weeklySeed = (): number => {
  const { year, week } = getIsoWeek(new Date());
  return Number(`${year}${String(week).padStart(2, '0')}`);
};

const dailySeed = (): number => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return Number(`${year}${month}${day}`);
};

const resolveDiscoveryLevel = (value?: number): number => clamp(value ?? 0.35, 0, 1);
const resolveRandomnessLevel = (value?: number): number => clamp(value ?? 0.3, 0, 1);

const scaleExplorationConfig = (
  baseInterval: number,
  baseLimit: number,
  level: number,
): { interval: number; limit: number } => ({
  interval: Math.max(3, Math.round(baseInterval - level * 3)),
  limit: Math.max(2, Math.round(baseLimit + level * 6)),
});

export const isMoreMixPlaylistId = (id: string): boolean => {
  if (id.startsWith('smart_genre_mix_')) {
    return true;
  }
  if (id.startsWith('smart_') && id.endsWith('_mix') && id !== 'smart_daily_mix') {
    return true;
  }
  return false;
};

export const isHeavyMixPlaylistId = (id: string): boolean => {
  return isMoreMixPlaylistId(id) || id === 'smart_album_spotlight';
};

const spreadByKey = (songs: Song[], keyFor: (song: Song) => string): Song[] => {
  if (songs.length <= 2) {
    return songs;
  }
  const buckets = new Map<string, Song[]>();
  const positions = new Map<string, number>();
  for (const song of songs) {
    const key = keyFor(song) || 'unknown';
    const bucket = buckets.get(key) ?? [];
    bucket.push(song);
    buckets.set(key, bucket);
  }
  for (const key of buckets.keys()) {
    positions.set(key, 0);
  }
  const keys = [...buckets.keys()];
  const result: Song[] = [];
  let lastKey: string | null = null;

  const remainingFor = (key: string) => {
    const bucket = buckets.get(key);
    const pos = positions.get(key) ?? 0;
    return bucket ? Math.max(0, bucket.length - pos) : 0;
  };

  while (result.length < songs.length) {
    let bestKey: string | null = null;
    let bestAlt: string | null = null;
    let bestRemaining = -1;
    let altRemaining = -1;
    for (const key of keys) {
      const remaining = remainingFor(key);
      if (remaining <= 0) {
        continue;
      }
      if (key !== lastKey) {
        if (remaining > bestRemaining) {
          bestRemaining = remaining;
          bestKey = key;
        }
      } else if (remaining > altRemaining) {
        altRemaining = remaining;
        bestAlt = key;
      }
    }
    const pickKey: string | null = bestKey ?? bestAlt;
    if (!pickKey) {
      break;
    }
    const bucket = buckets.get(pickKey)!;
    const pos = positions.get(pickKey) ?? 0;
    const song = bucket[pos];
    if (!song) {
      positions.set(pickKey, pos + 1);
      continue;
    }
    result.push(song);
    positions.set(pickKey, pos + 1);
    lastKey = pickKey;
  }

  return result.length === songs.length ? result : songs;
};

const albumKeyFor = (song: Song): string => {
  const artist = getPrimaryArtistName(song.artist).toLowerCase();
  const album = song.album?.trim().toLowerCase() ?? '';
  return `${artist}::${album}`;
};

const shuffleWithSpacing = (songs: Song[], seed: number, salt = 'spacing'): Song[] => {
  const shuffled = seededShuffle(songs, seed, salt);
  const byArtist = spreadByKey(shuffled, (song) => getPrimaryArtistName(song.artist).toLowerCase() || song.artist.toLowerCase());
  return spreadByKey(byArtist, albumKeyFor);
};

const sortAlbumTracks = (songs: Song[]): Song[] => {
  return [...songs].sort((a, b) => {
    const trackDelta = (a.track || Number.MAX_SAFE_INTEGER) - (b.track || Number.MAX_SAFE_INTEGER);
    if (trackDelta !== 0) {
      return trackDelta;
    }
    const titleCmp = a.title.localeCompare(b.title);
    if (titleCmp !== 0) {
      return titleCmp;
    }
    return a.filename.localeCompare(b.filename);
  });
};

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const normalizeGenreBucket = (genreRaw: string): string | null => {
  const genre = genreRaw.trim().toLowerCase();
  if (!genre || isUnknownGenre(genre)) {
    return null;
  }

  const rules: Array<{ label: string; keywords: string[] }> = [
    { label: 'Pop', keywords: ['pop', 'k-pop', 'kpop'] },
    { label: 'Rock', keywords: ['rock', 'alt', 'alternative', 'punk', 'grunge'] },
    { label: 'Hip-Hop', keywords: ['hip hop', 'hip-hop', 'rap', 'trap'] },
    { label: 'Electronic', keywords: ['electronic', 'edm', 'dance', 'house', 'techno', 'trance', 'dubstep'] },
    { label: 'R&B', keywords: ['r&b', 'soul', 'neo soul'] },
    { label: 'Indie', keywords: ['indie', 'lofi', 'lo-fi'] },
    { label: 'Jazz', keywords: ['jazz', 'swing', 'bebop'] },
    { label: 'Classical', keywords: ['classical', 'orchestral', 'symphony'] },
    { label: 'Country', keywords: ['country', 'americana'] },
    { label: 'Latin', keywords: ['latin', 'reggaeton', 'salsa', 'bachata'] },
    { label: 'World', keywords: ['world', 'bollywood', 'hindi', 'indian', 'afro', 'afrobeat'] },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((keyword) => genre.includes(keyword))) {
      return rule.label;
    }
  }

  return null;
};

const getGenreBucketForSong = (song: Song): string => {
  const raw = song.genre?.trim() ?? '';
  const normalized = raw ? normalizeGenreBucket(raw) : null;
  if (normalized) {
    return normalized;
  }
  if (raw && !isUnknownGenre(raw)) {
    return raw;
  }
  return 'Unknown Genre';
};

const interleaveByGenre = (songs: Song[]): Song[] => {
  const buckets = new Map<string, Song[]>();
  songs.forEach((song) => {
    const genre = getGenreBucketForSong(song);
    const list = buckets.get(genre) ?? [];
    list.push(song);
    buckets.set(genre, list);
  });

  const genres = [...buckets.keys()];
  const result: Song[] = [];

  while (genres.length) {
    for (let i = genres.length - 1; i >= 0; i -= 1) {
      const genre = genres[i];
      const bucket = buckets.get(genre);
      if (!bucket?.length) {
        genres.splice(i, 1);
        continue;
      }
      result.push(bucket.shift()!);
      if (!bucket.length) {
        genres.splice(i, 1);
      }
    }
  }

  return result;
};

const getSongEnergyScore = (song: Song): number => {
  const genre = song.genre?.toLowerCase() ?? '';
  const bucket = normalizeGenreBucket(song.genre ?? '')?.toLowerCase() ?? '';
  const loudness = song.loudnessLufs ?? -14;
  let score = 0;

  if (['dance', 'edm', 'electronic', 'house', 'disco', 'pop', 'rock', 'hip hop', 'hip-hop', 'rap'].some((hint) => genre.includes(hint) || bucket.includes(hint))) {
    score += 2.5;
  }
  if (song.duration > 0 && song.duration <= 260) {
    score += 1.2;
  }
  score += Math.max(0, Math.min(3, (loudness + 18) / 3));

  return score;
};

const getDaypart = (hour: number): number => {
  if (hour < 6) return 0;
  if (hour < 12) return 1;
  if (hour < 18) return 2;
  return 3;
};

const getSkipRate = (song: Song): number => {
  const skips = song.skipCount ?? 0;
  const plays = song.playCount ?? 0;
  if (skips <= 0 || plays <= 0) {
    return 0;
  }
  return Math.min(1, skips / Math.max(1, plays));
};

const getListenRatio = (song: Song): number | null => {
  if (!song.duration || song.duration <= 0) {
    return null;
  }
  const totalSeconds = song.totalPlaySeconds ?? 0;
  const plays = song.playCount ?? 0;
  if (!totalSeconds || plays <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, totalSeconds / (plays * song.duration)));
};

const getExplorationBoost = (song: Song, now: number): number => {
  const plays = song.playCount ?? 0;
  const recentPenalty = song.lastPlayed ? Math.max(0, 4 - (now - song.lastPlayed) / 86_400) : 0;
  const lowPlayBoost = plays <= 1 ? 2.4 : plays <= 3 ? 1.4 : 0.4;
  return Math.max(0, lowPlayBoost - recentPenalty * 0.8);
};

const getTrendBoost = (song: Song, profile?: ListeningProfile): number => {
  if (!profile) return 0;
  const artistKey = getPrimaryArtistName(song.artist).trim().toLowerCase();
  const artistCount = profile.recentArtists[artistKey]?.count ?? 0;
  const genreKey = song.genre?.trim().toLowerCase() ?? '';
  const genreCount = profile.recentGenres[genreKey]?.count ?? 0;
  return Math.min(4, artistCount * 0.25 + genreCount * 0.12);
};

const getTimeOfDayBoost = (song: Song, profile: ListeningProfile | undefined, now: number): number => {
  if (!profile) return 0;
  if (!song.lastPlayed) return 0;
  const nowHour = new Date(now * 1000).getHours();
  const lastHour = new Date(song.lastPlayed * 1000).getHours();
  const nowPart = getDaypart(nowHour);
  const lastPart = getDaypart(lastHour);
  if (nowPart !== lastPart) return 0;
  const maxHour = Math.max(1, ...profile.hourly);
  const affinity = profile.hourly[nowHour] / maxHour;
  return affinity * 1.1;
};

type RecencyMode = 'avoid' | 'prefer' | 'neutral';

const applyRecencyWeight = (song: Song, now: number, windowDays: number, mode: RecencyMode): number => {
  if (!song.lastPlayed) {
    return 1.05;
  }
  const ageDays = (now - song.lastPlayed) / DAY_SEC;
  if (mode === 'prefer') {
    const boost = 1 + clamp((windowDays - ageDays) / windowDays, 0, 1) * 0.7;
    return clamp(boost, 0.6, 1.7);
  }
  if (mode === 'avoid') {
    return clamp(ageDays / windowDays, 0.25, 1);
  }
  return 1;
};

const applyAddedWeight = (song: Song, now: number, windowDays: number): number => {
  const ageDays = (now - song.addedAt) / DAY_SEC;
  return clamp(1.4 - ageDays / windowDays, 0.35, 1.4);
};

const applyRotationWeight = (song: Song, rotation?: Map<string, number>): number => {
  if (!rotation) {
    return 1;
  }
  const used = rotation.get(song.id) ?? 0;
  if (!used) {
    return 1;
  }
  return 1 / (1 + used * 0.9);
};

const baseTasteScore = (
  song: Song,
  now: number,
  profile: ListeningProfile | undefined,
  discoveryLevel: number,
  randomnessLevel: number,
): number => {
  const favoriteBoost = song.favorite ? 1.4 * (1 - randomnessLevel * 0.5) : 0;
  const playBoost = Math.min(3.2, Math.sqrt(song.playCount ?? 0) * 0.35) * (1 - randomnessLevel * 0.7);
  const completionBoost = (getListenRatio(song) ?? 0.5) * 1.1;
  const energyBoost = getSongEnergyScore(song) * 0.12;
  const trendBoost = getTrendBoost(song, profile) * 0.45;
  const timeBoost = getTimeOfDayBoost(song, profile, now) * 0.35;
  const explorationBoost =
    getExplorationBoost(song, now) * (0.45 + discoveryLevel * 0.6 + randomnessLevel * 0.9);
  const manualBoost = Math.min(1.2, (song.manualQueueAdds ?? 0) * 0.2);
  const skipPenalty = getSkipRate(song) * 2.2;
  return (
    0.6 +
    favoriteBoost +
    playBoost +
    completionBoost +
    energyBoost +
    trendBoost +
    timeBoost +
    explorationBoost +
    manualBoost -
    skipPenalty
  );
};

const weightedSampleUnique = (
  songs: Song[],
  count: number,
  weightFor: (song: Song) => number,
  rng: () => number,
): Song[] => {
  if (!songs.length || count <= 0) {
    return [];
  }
  const pool = [...songs];
  const result: Song[] = [];

  while (pool.length && result.length < count) {
    let total = 0;
    const weights = pool.map((song) => {
      const weight = Math.max(0, weightFor(song));
      total += weight;
      return weight;
    });
    if (total <= 0) {
      break;
    }
    let pick = rng() * total;
    let index = 0;
    for (index = 0; index < weights.length; index += 1) {
      pick -= weights[index];
      if (pick <= 0) {
        break;
      }
    }
    const chosen = pool.splice(Math.min(index, pool.length - 1), 1)[0];
    result.push(chosen);
  }

  return result;
};

type CurateOptions = {
  seed: number;
  salt: string;
  count: number;
  pool: Song[];
  now: number;
  profile?: ListeningProfile;
  discoveryLevel: number;
  randomnessLevel: number;
  albumRotation?: Map<string, number>;
  recencyMode?: RecencyMode;
  recencyDays?: number;
  preferAdded?: boolean;
  addedDays?: number;
  extraPlayBoost?: number;
  extraFavoriteBoost?: number;
  extraExplorationBoost?: number;
  rotation?: Map<string, number>;
};

const curateFromPool = (options: CurateOptions): Song[] => {
  const {
    seed,
    salt,
    count,
    pool,
    now,
    profile,
    discoveryLevel,
    randomnessLevel,
    albumRotation,
    recencyMode = 'avoid',
    recencyDays = 3,
    preferAdded = false,
    addedDays = 30,
    extraPlayBoost = 0,
    extraFavoriteBoost = 0,
    extraExplorationBoost = 0,
    rotation,
  } = options;
  const rng = rngFor(seed, salt);
  const picks = weightedSampleUnique(
    pool,
    count,
    (song) => {
      let score = baseTasteScore(song, now, profile, discoveryLevel, randomnessLevel);
      if (extraPlayBoost > 0) {
        score += Math.min(3.2, (song.playCount ?? 0) * extraPlayBoost);
      }
      if (extraFavoriteBoost > 0 && song.favorite) {
        score += extraFavoriteBoost;
      }
      if (extraExplorationBoost > 0) {
        score += getExplorationBoost(song, now) * extraExplorationBoost;
      }
      if (preferAdded) {
        score *= applyAddedWeight(song, now, addedDays) * (1 + randomnessLevel * 0.6);
      }
      const recencyWindow =
        recencyMode === 'avoid' ? recencyDays * (1 + randomnessLevel * 1.5) : recencyDays;
      score *= applyRecencyWeight(song, now, recencyWindow, recencyMode);
      score *= applyRotationWeight(song, rotation);
      score *= applyAlbumRotationWeight(song, albumRotation);
      return Math.max(0.05, score);
    },
    rng,
  );

  return shuffleWithSpacing(picks, seed, `${salt}:order`);
};

const noteRotation = (rotation: Map<string, number> | undefined, songs: Song[]): void => {
  if (!rotation) {
    return;
  }
  for (const song of songs) {
    rotation.set(song.id, (rotation.get(song.id) ?? 0) + 1);
  }
};

const injectExploration = (base: Song[], extras: Song[], interval = 5, limit = 12): Song[] => {
  if (!extras.length) return base;
  const result: Song[] = [];
  let extraIndex = 0;
  for (let i = 0; i < base.length; i += 1) {
    if (i > 0 && i % interval === 0 && extraIndex < extras.length && extraIndex < limit) {
      result.push(extras[extraIndex]);
      extraIndex += 1;
    }
    result.push(base[i]);
  }
  while (extraIndex < extras.length && extraIndex < limit) {
    result.push(extras[extraIndex]);
    extraIndex += 1;
  }
  return result;
};

const buildExplorationPool = (songs: Song[], now: number): Song[] => {
  const candidates = songs.filter((song) => (song.playCount ?? 0) <= 2);
  const scored = candidates.sort((a, b) => {
    const boostDelta = getExplorationBoost(b, now) - getExplorationBoost(a, now);
    if (boostDelta !== 0) {
      return boostDelta;
    }
    return (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0);
  });
  const byArtist = spreadByKey(scored, (song) => getPrimaryArtistName(song.artist).toLowerCase() || song.artist.toLowerCase());
  const byAlbum = spreadByKey(byArtist, albumKeyFor);
  return byAlbum.slice(0, 80);
};

const injectExplorationFromPool = (
  base: Song[],
  pool: Song[],
  interval: number,
  limit: number,
  predicate?: (song: Song) => boolean,
): Song[] => {
  if (!pool.length) {
    return base;
  }
  const baseIds = new Set(base.map((song) => song.id));
  const extras = pool.filter((song) => !baseIds.has(song.id) && (!predicate || predicate(song)));
  return injectExploration(base, extras, interval, limit);
};

const pickDailyMix = (
  songs: Song[],
  seed: number,
  profile: ListeningProfile | undefined,
  discoveryLevel: number,
  randomnessLevel: number,
  rotation?: Map<string, number>,
): Song[] => {
  const now = Math.floor(Date.now() / 1000);
  const picks = curateFromPool({
    seed,
    salt: 'daily-mix',
    count: 60,
    pool: songs,
    now,
    profile,
    discoveryLevel,
    randomnessLevel,
    recencyMode: 'avoid',
    recencyDays: 3,
    extraFavoriteBoost: 0.6,
    extraPlayBoost: 0.08,
    extraExplorationBoost: 0.9,
    rotation,
  });
  const ordered = interleaveByGenre(
    spreadByKey(picks, (song) => getPrimaryArtistName(song.artist).toLowerCase() || song.artist.toLowerCase()),
  );
  noteRotation(rotation, ordered);
  return ordered;
};

const pickOnRepeat = (
  songs: Song[],
  seed: number,
  profile: ListeningProfile | undefined,
  randomnessLevel: number,
  rotation?: Map<string, number>,
): Song[] => {
  const now = Math.floor(Date.now() / 1000);
  const recentThreshold = now - 14 * DAY_SEC;
  const recentPool = songs.filter((song) => (song.lastPlayed ?? 0) >= recentThreshold && song.playCount > 0);
  const pool = recentPool.length >= 20 ? recentPool : songs.filter((song) => song.playCount > 0);
  const picks = curateFromPool({
    seed,
    salt: 'on-repeat',
    count: 80,
    pool,
    now,
    profile,
    discoveryLevel: 0.2,
    randomnessLevel,
    recencyMode: 'prefer',
    recencyDays: 7,
    extraPlayBoost: 0.14,
    extraFavoriteBoost: 0.3,
    rotation,
  });
  noteRotation(rotation, picks);
  return picks;
};

const buildGenreMixes = (
  songs: Song[],
  seed: number,
  profile: ListeningProfile | undefined,
  discoveryLevel = 0.35,
  randomnessLevel = 0.3,
  albumRotation?: Map<string, number>,
  maxPerAlbum = 3,
  rotation?: Map<string, number>,
): Playlist[] => {
  const exploreConfig = scaleExplorationConfig(6, 10, discoveryLevel);
  const byGenre = new Map<string, Song[]>();

  for (const song of songs) {
    const bucket = normalizeGenreBucket(song.genre);
    if (!bucket) {
      continue;
    }

    const list = byGenre.get(bucket) ?? [];
    list.push(song);
    byGenre.set(bucket, list);
  }

  const rankedGenres = [...byGenre.entries()]
    .map(([genre, genreSongs]) => {
      const now = Math.floor(Date.now() / 1000);
      return {
        genre,
        genreSongs: [...genreSongs].sort((a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
        totalPlays: genreSongs.reduce((total, song) => total + song.playCount, 0),
        exploration: genreSongs
          .filter((song) => (song.playCount ?? 0) <= 2)
          .sort((a, b) => getExplorationBoost(b, now) - getExplorationBoost(a, now))
          .slice(0, 20),
      };
    })
    .filter((entry) => entry.genreSongs.length >= 1)
    .sort((a, b) => b.totalPlays - a.totalPlays || b.genreSongs.length - a.genreSongs.length)
    .slice(0, 6);

  return rankedGenres.map((entry) => {
    const now = Math.floor(Date.now() / 1000);
    const curated = curateFromPool({
      seed,
      salt: `genre:${entry.genre}`,
      count: 80,
      pool: entry.genreSongs,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 4,
      extraExplorationBoost: 0.5,
      rotation,
    });
    const injected = injectExplorationFromPool(curated, entry.exploration, exploreConfig.interval, exploreConfig.limit);
    const capped = capByAlbum(injected, maxPerAlbum);
    noteRotation(rotation, capped);
    noteAlbumRotation(albumRotation, capped);
    return mapPlaylist(
      `smart_genre_mix_${slugify(entry.genre)}`,
      `${entry.genre} Mix`,
      `Mix based on your ${entry.genre} tracks.`,
      capped.slice(0, 80),
      'smart',
    );
  });
};

const buildMoodMixes = (
  songs: Song[],
  seed: number,
  profile: ListeningProfile | undefined,
  discoveryLevel = 0.35,
  randomnessLevel = 0.3,
  albumRotation?: Map<string, number>,
  maxPerAlbum = 3,
  rotation?: Map<string, number>,
): Playlist[] => {
  const exploreConfig = scaleExplorationConfig(7, 8, discoveryLevel);
  const moods = [
    {
      id: 'happy',
      name: 'Happy Mix',
      description: 'Upbeat songs to lift the mood.',
      genreHints: ['pop', 'dance', 'disco', 'funk', 'edm', 'electronic'],
      titleHints: ['happy', 'joy', 'smile', 'sun', 'bright', 'good'],
    },
    {
      id: 'sad',
      name: 'Sad Mix',
      description: 'Slower, mellow tracks for quieter moments.',
      genreHints: ['acoustic', 'ballad', 'ambient', 'lofi', 'lo-fi', 'piano'],
      titleHints: ['sad', 'cry', 'alone', 'lonely', 'tears', 'heart'],
    },
    {
      id: 'party',
      name: 'Party Mix',
      description: 'High-energy tracks for late-night sessions.',
      genreHints: ['dance', 'edm', 'club', 'house', 'hip hop', 'hip-hop', 'rap', 'reggaeton'],
      titleHints: ['party', 'club', 'dance', 'night', 'mix'],
    },
    {
      id: 'main_character',
      name: 'Main Character Vibes',
      description: 'Big energy and cinematic feel-good tracks.',
      genreHints: ['pop', 'indie', 'electronic', 'rock'],
      titleHints: ['vibes', 'glow', 'shine', 'star', 'dream', 'hero'],
    },
    {
      id: 'chill',
      name: 'Chill Mix',
      description: 'Laid-back tracks for winding down.',
      genreHints: ['chill', 'ambient', 'lofi', 'lo-fi', 'acoustic', 'indie'],
      titleHints: ['chill', 'slow', 'late', 'night', 'blue'],
    },
    {
      id: 'focus',
      name: 'Focus Mix',
      description: 'Steady, low-distraction tracks for deep work.',
      genreHints: ['instrumental', 'ambient', 'piano', 'classical', 'lofi', 'lo-fi'],
      titleHints: ['focus', 'study', 'work', 'concentration', 'calm'],
    },
    {
      id: 'workout',
      name: 'Workout Mix',
      description: 'High-intensity tracks to keep you moving.',
      genreHints: ['edm', 'electronic', 'rock', 'hip hop', 'hip-hop', 'metal'],
      titleHints: ['run', 'burn', 'power', 'move', 'energy'],
    },
    {
      id: 'late_night',
      name: 'Late Night Mix',
      description: 'Low-light listening for winding down.',
      genreHints: ['ambient', 'lofi', 'lo-fi', 'chill', 'soul', 'r&b'],
      titleHints: ['night', 'midnight', 'moon', 'late', 'after dark', 'dream'],
    },
    {
      id: 'road_trip',
      name: 'Road Trip Mix',
      description: 'Open-road anthems and sing-alongs.',
      genreHints: ['rock', 'pop', 'country', 'indie'],
      titleHints: ['road', 'drive', 'highway', 'trip', 'ride'],
    },
    {
      id: 'morning_boost',
      name: 'Morning Boost',
      description: 'Bright, upbeat tracks to start the day.',
      genreHints: ['pop', 'dance', 'funk', 'disco', 'electronic'],
      titleHints: ['morning', 'sun', 'rise', 'wake', 'bright', 'good'],
    },
    {
      id: 'acoustic',
      name: 'Acoustic Mix',
      description: 'Unplugged and mellow acoustic tracks.',
      genreHints: ['acoustic', 'folk', 'singer-songwriter', 'indie'],
      titleHints: ['acoustic', 'unplugged', 'stripped'],
    },
    {
      id: 'instrumental',
      name: 'Instrumental Focus',
      description: 'Instrumental picks for focus and flow.',
      genreHints: ['instrumental', 'classical', 'piano', 'ambient', 'lofi', 'lo-fi'],
      titleHints: ['instrumental', 'piano', 'study', 'focus'],
    },
  ];

  const scoredMixes = moods.map((mood) => {
    const now = Math.floor(Date.now() / 1000);
    const scored = weightedSampleUnique(
      songs,
      80,
      (song) => {
        const rawGenre = song.genre?.toLowerCase() ?? '';
        const bucket = normalizeGenreBucket(song.genre ?? '');
        const bucketKey = bucket ? bucket.toLowerCase().replace(/-/g, ' ') : '';
        const title = song.title?.toLowerCase() ?? '';
        let score = baseTasteScore(song, now, profile, discoveryLevel, randomnessLevel);

        if (mood.genreHints.some((hint) => rawGenre.includes(hint) || (bucketKey && bucketKey.includes(hint)))) {
          score += 3.8;
        }
        if (mood.titleHints.some((hint) => title.includes(hint))) {
          score += 0.9;
        }
        score += getExplorationBoost(song, now) * 0.5;
        score *= applyRecencyWeight(song, now, 3 * (1 + randomnessLevel), 'avoid');
        score *= applyRotationWeight(song, rotation);
        score *= applyAlbumRotationWeight(song, albumRotation);

        return Math.max(0.05, score);
      },
      rngFor(seed, `mood:${mood.id}`),
    );

    const exploration = songs
      .filter((song) => (song.playCount ?? 0) <= 2)
      .sort((a, b) => getExplorationBoost(b, now) - getExplorationBoost(a, now))
      .slice(0, 16);

    const mixed = injectExploration(scored, exploration, exploreConfig.interval, exploreConfig.limit);
    const capped = capByAlbum(mixed, maxPerAlbum);
    noteRotation(rotation, capped);
    noteAlbumRotation(albumRotation, capped);
    return { mood, songs: capped };
  });

  return scoredMixes
    .filter((entry) => entry.songs.length > 0)
    .map((entry) =>
      mapPlaylist(
        `smart_${entry.mood.id}_mix`,
        entry.mood.name,
        entry.mood.description,
        entry.songs,
        'smart',
      ),
    );
};

const buildExploreMix = (
  songs: Song[],
  explorationPool: Song[],
  seed: number,
  discoveryLevel: number,
  randomnessLevel: number,
  rotation?: Map<string, number>,
): Song[] => {
  const now = Math.floor(Date.now() / 1000);
  const filler = songs.filter((song) => (song.playCount ?? 0) <= 4);
  const merged = [...explorationPool, ...filler];
  const seen = new Set<string>();
  const deduped = merged.filter((song) => {
    if (seen.has(song.id)) {
      return false;
    }
    seen.add(song.id);
    return true;
  });
  const picks = curateFromPool({
    seed,
    salt: 'explore',
    count: 80,
    pool: deduped,
    now,
    profile: undefined,
    discoveryLevel,
    randomnessLevel,
    recencyMode: 'avoid',
    recencyDays: 4,
    extraExplorationBoost: 1.6,
    rotation,
  });
  const config = scaleExplorationConfig(6, 12, discoveryLevel);
  const injected = injectExplorationFromPool(picks, explorationPool, config.interval, config.limit);
  noteRotation(rotation, injected);
  return injected.slice(0, 80);
};

const mapPlaylist = (
  id: string,
  name: string,
  description: string,
  songs: Song[],
  type: Playlist['type'] = 'smart',
): Playlist => ({
  id,
  name,
  type,
  description,
  songIds: songs.map((song) => song.id),
  updatedAt: Math.floor(Date.now() / 1000),
});

const albumKeyFromSong = (song: Song): string | null => {
  const artist = getPrimaryArtistName(song.artist).toLowerCase();
  const album = song.album?.trim().toLowerCase();
  if (!album) {
    return null;
  }
  return `${artist}::${album}`;
};

const artistKeyFromSong = (song: Song): string => {
  return getPrimaryArtistName(song.artist).trim().toLowerCase() || song.artist.trim().toLowerCase();
};

const applyAlbumRotationWeight = (song: Song, albumRotation?: Map<string, number>): number => {
  if (!albumRotation) {
    return 1;
  }
  const key = albumKeyFromSong(song);
  if (!key) {
    return 1;
  }
  const used = albumRotation.get(key) ?? 0;
  if (!used) {
    return 1;
  }
  return 1 / (1 + used * 0.85);
};

const noteAlbumRotation = (albumRotation: Map<string, number> | undefined, songs: Song[]): void => {
  if (!albumRotation) {
    return;
  }
  for (const song of songs) {
    const key = albumKeyFromSong(song);
    if (!key) {
      continue;
    }
    albumRotation.set(key, (albumRotation.get(key) ?? 0) + 1);
  }
};

const capByAlbum = (songs: Song[], maxPerAlbum: number): Song[] => {
  if (maxPerAlbum <= 0 || songs.length <= 2) {
    return songs;
  }
  const counts = new Map<string, number>();
  const kept: Song[] = [];
  for (const song of songs) {
    const key = albumKeyFromSong(song) ?? `__unknown__:${song.id}`;
    const used = counts.get(key) ?? 0;
    if (used >= maxPerAlbum) {
      continue;
    }
    counts.set(key, used + 1);
    kept.push(song);
  }
  const minKeep = Math.min(20, Math.ceil(songs.length * 0.6));
  return kept.length < minKeep ? songs : kept;
};

const diversifyFirstTracks = (
  playlists: Playlist[],
  songsById: Map<string, Song>,
  seed: number,
): Playlist[] => {
  const usedAlbums = new Set<string>();
  const usedArtists = new Set<string>();
  const usedSongs = new Set<string>();
  const usedArtworks = new Set<string>();

  return playlists.map((playlist) => {
    if (playlist.type === 'custom' || playlist.songIds.length <= 1 || playlist.id === 'smart_album_spotlight') {
      return playlist;
    }

    const candidateLimit = Math.min(25, playlist.songIds.length);
    const extraLimit = Math.min(8, Math.max(0, playlist.songIds.length - candidateLimit));
    const rng = rngFor(seed, `front:${playlist.id}`);
    const candidates = playlist.songIds.slice(0, candidateLimit);

    if (extraLimit > 0) {
      const tail = playlist.songIds.slice(candidateLimit);
      for (let i = 0; i < extraLimit && tail.length > 0; i += 1) {
        const pick = Math.floor(rng() * tail.length);
        candidates.push(tail.splice(pick, 1)[0]);
      }
    }

    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const id of candidates) {
      const song = songsById.get(id);
      if (!song) {
        continue;
      }
      const albumKey = albumKeyFromSong(song);
      const artistKey = artistKeyFromSong(song);
      const art = song.albumArt ?? '';

      let score = 0;
      if (albumKey && !usedAlbums.has(albumKey)) {
        score += 3.2;
      } else {
        score -= 2.2;
      }
      if (artistKey && !usedArtists.has(artistKey)) {
        score += 1.4;
      } else {
        score -= 0.8;
      }
      if (art && !usedArtworks.has(art)) {
        score += 1.2;
      }
      if (!usedSongs.has(song.id)) {
        score += 0.6;
      }
      score += rng() * 0.2;

      if (score > bestScore) {
        bestScore = score;
        bestId = song.id;
      }
    }

    if (!bestId || playlist.songIds[0] === bestId) {
      const first = songsById.get(playlist.songIds[0]);
      if (first) {
        const albumKey = albumKeyFromSong(first);
        const artistKey = artistKeyFromSong(first);
        if (albumKey) usedAlbums.add(albumKey);
        if (artistKey) usedArtists.add(artistKey);
        if (first.albumArt) usedArtworks.add(first.albumArt);
        usedSongs.add(first.id);
      }
      return playlist;
    }

    const reordered = [
      bestId,
      ...playlist.songIds.filter((songId) => songId !== bestId),
    ];
    const picked = songsById.get(bestId);
    if (picked) {
      const albumKey = albumKeyFromSong(picked);
      const artistKey = artistKeyFromSong(picked);
      if (albumKey) usedAlbums.add(albumKey);
      if (artistKey) usedArtists.add(artistKey);
      if (picked.albumArt) usedArtworks.add(picked.albumArt);
      usedSongs.add(picked.id);
    }
    return { ...playlist, songIds: reordered };
  });
};

const ensureUniqueFirstAlbums = (playlists: Playlist[], songsById: Map<string, Song>): Playlist[] => {
  const usedAlbums = new Set<string>();

  return playlists.map((playlist) => {
    if (playlist.type === 'custom' || playlist.songIds.length <= 1 || playlist.id === 'smart_album_spotlight') {
      return playlist;
    }

    const first = songsById.get(playlist.songIds[0]);
    const firstAlbum = first ? albumKeyFromSong(first) : null;
    if (firstAlbum && !usedAlbums.has(firstAlbum)) {
      usedAlbums.add(firstAlbum);
      return playlist;
    }

    let pickIndex = -1;
    let pickAlbum: string | null = null;
    for (let i = 1; i < playlist.songIds.length; i += 1) {
      const song = songsById.get(playlist.songIds[i]);
      if (!song) {
        continue;
      }
      if (song.track === 1) {
        continue;
      }
      const albumKey = albumKeyFromSong(song);
      if (!albumKey) {
        continue;
      }
      if (!usedAlbums.has(albumKey)) {
        pickIndex = i;
        pickAlbum = albumKey;
        break;
      }
    }
    if (pickIndex === -1) {
      for (let i = 1; i < playlist.songIds.length; i += 1) {
        const song = songsById.get(playlist.songIds[i]);
        if (!song) {
          continue;
        }
        const albumKey = albumKeyFromSong(song);
        if (!albumKey) {
          continue;
        }
        if (!usedAlbums.has(albumKey)) {
          pickIndex = i;
          pickAlbum = albumKey;
          break;
        }
      }
    }

    if (pickIndex <= 0 || pickAlbum === null) {
      if (firstAlbum) {
        usedAlbums.add(firstAlbum);
      }
      return playlist;
    }

    const reordered = [
      playlist.songIds[pickIndex],
      ...playlist.songIds.slice(0, pickIndex),
      ...playlist.songIds.slice(pickIndex + 1),
    ];
    usedAlbums.add(pickAlbum);
    return { ...playlist, songIds: reordered };
  });
};

const applyArtworkFromFirstSong = (playlists: Playlist[], songsById: Map<string, Song>): Playlist[] =>
  playlists.map((playlist) => {
    if (playlist.type === 'custom' || playlist.songIds.length === 0) {
      return playlist;
    }
    const first = songsById.get(playlist.songIds[0]);
    if (!first?.albumArt) {
      return playlist;
    }
    return { ...playlist, artwork: first.albumArt };
  });

const buildAlbumArtFrequencyLocal = (songs: Song[]): Map<string, number> => {
  const freq = new Map<string, number>();
  for (const song of songs) {
    const art = song.albumArt;
    if (!art) {
      continue;
    }
    freq.set(art, (freq.get(art) ?? 0) + 1);
  }
  return freq;
};

const assignUniqueSmartArtworkSync = (playlists: Playlist[], songsById: Map<string, Song>): Playlist[] => {
  const freq = buildAlbumArtFrequencyLocal([...songsById.values()]);
  const used = new Set<string>();

  return playlists.map((playlist) => {
    if (playlist.type === 'custom' || playlist.songIds.length === 0) {
      return playlist;
    }
    const songs = playlist.songIds
      .map((id) => songsById.get(id))
      .filter((song): song is Song => Boolean(song));
    if (!songs.length) {
      return playlist;
    }

    const candidates = buildArtworkSet(songs, freq, 4);
    let artwork = playlist.artwork;
    if (!artwork || used.has(artwork)) {
      const pick = candidates.find((art) => !used.has(art));
      if (pick) {
        artwork = pick;
      }
    }
    if (artwork) {
      used.add(artwork);
      return { ...playlist, artwork };
    }
    return playlist;
  });
};

const assignUniqueSmartArtworkAsync = async (
  playlists: Playlist[],
  songsById: Map<string, Song>,
): Promise<Playlist[]> => {
  const freq = await buildAlbumArtFrequency([...songsById.values()]);
  const used = new Set<string>();

  return playlists.map((playlist) => {
    if (playlist.type === 'custom' || playlist.songIds.length === 0) {
      return playlist;
    }
    const songs = playlist.songIds
      .map((id) => songsById.get(id))
      .filter((song): song is Song => Boolean(song));
    if (!songs.length) {
      return playlist;
    }

    const candidates = buildArtworkSet(songs, freq, 4);
    let artwork = playlist.artwork;
    if (!artwork || used.has(artwork)) {
      const pick = candidates.find((art) => !used.has(art));
      if (pick) {
        artwork = pick;
      }
    }
    if (artwork) {
      used.add(artwork);
      return { ...playlist, artwork };
    }
    return playlist;
  });
};

const applyOverrides = (
  playlists: Playlist[],
  overrides: Record<string, string[]>,
  songs: Song[],
): Playlist[] => {
  if (!Object.keys(overrides).length) {
    return playlists;
  }
  const songSet = new Set(songs.map((song) => song.id));
  return playlists.map((playlist) => {
    const extras = overrides[playlist.id] ?? [];
    if (!extras.length) {
      return playlist;
    }
    const merged = [...playlist.songIds];
    for (const id of extras) {
      if (songSet.has(id) && !merged.includes(id)) {
        merged.push(id);
      }
    }
    return {
      ...playlist,
      songIds: merged,
    };
  });
};

export const postProcessGeneratedPlaylists = async (
  playlists: Playlist[],
  songs: Song[],
  overrides: Record<string, string[]>,
  seed: number,
): Promise<Playlist[]> => {
  const songsById = new Map(songs.map((song) => [song.id, song]));
  const ordered = ensureUniqueFirstAlbums(playlists, songsById);
  const diversified = diversifyFirstTracks(ordered, songsById, seed);
  const withArtwork = applyArtworkFromFirstSong(diversified, songsById);
  const withOverrides = applyOverrides(withArtwork, overrides, songs);
  return assignUniqueSmartArtworkAsync(withOverrides, songsById);
};

export const generateSmartPlaylistsLite = (
  songs: Song[],
  overrides: Record<string, string[]> = {},
  seedOverride?: number,
  dailyMixOverride?: Song[],
  dailySeedOverride?: number,
  profile?: ListeningProfile,
  discoveryIntensity?: number,
  randomnessIntensity?: number,
  carryMixes: Playlist[] = [],
): Playlist[] => {
  const now = Math.floor(Date.now() / 1000);
  const seed = seedOverride ?? weeklySeed();
  const dailySeedValue = dailySeedOverride ?? dailySeed();
  const discoveryLevel = resolveDiscoveryLevel(discoveryIntensity);
  const randomnessLevel = resolveRandomnessLevel(randomnessIntensity);
  const rotation = new Map<string, number>();
  const albumRotation = new Map<string, number>();
  const songsById = new Map(songs.map((song) => [song.id, song]));
  const explorationPool = buildExplorationPool(songs, now);
  const recentlyAddedPool = [...songs].sort((a, b) => b.addedAt - a.addedAt).slice(0, Math.min(240, songs.length));
  const mostPlayedPool = [...songs].sort(byPlayCount).slice(0, Math.min(300, songs.length));
  const rediscoverCutoff = now - 45 * DAY_SEC;
  const rediscoverPool = songs
    .filter((song) => !song.lastPlayed || song.lastPlayed < rediscoverCutoff)
    .sort((a, b) => (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0))
    .slice(0, Math.min(240, songs.length));
  const favoritesPool = songs.filter((song) => song.favorite);
  const recentlyPlayed = [...songs]
    .filter((song) => song.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    .slice(0, 120);
  const dailyMix = dailyMixOverride ?? pickDailyMix(songs, dailySeedValue, profile, discoveryLevel, randomnessLevel, rotation);
  if (dailyMixOverride) {
    noteRotation(rotation, dailyMixOverride);
  }
  const maxPerAlbum = Math.max(2, Math.round(4 - randomnessLevel * 2));
  const dailyCapped = capByAlbum(dailyMix, maxPerAlbum);
  noteRotation(rotation, dailyCapped);
  noteAlbumRotation(albumRotation, dailyCapped);
  const onRepeat = pickOnRepeat(songs, seed, profile, randomnessLevel, rotation);
  const onRepeatCapped = capByAlbum(onRepeat, Math.max(2, Math.round(4 - randomnessLevel)));
  noteRotation(rotation, onRepeatCapped);
  noteAlbumRotation(albumRotation, onRepeatCapped);
  const quickHitsPool = songs.filter((song) => song.duration > 0 && song.duration <= 180);
  const longSessionsPool = songs.filter((song) => song.duration >= 360);
  const deepCutsPool = songs.filter((song) => song.playCount <= 1 && song.addedAt < now - 21 * DAY_SEC);
  const lovedAndPlayedPool = songs.filter((song) => song.favorite && song.playCount > 0);
  const exploreMix = buildExploreMix(songs, explorationPool, seed, discoveryLevel, randomnessLevel, rotation);
  const exploreCapped = capByAlbum(exploreMix, maxPerAlbum);
  noteRotation(rotation, exploreCapped);
  noteAlbumRotation(albumRotation, exploreCapped);
  const recentlyAddedConfig = scaleExplorationConfig(8, 6, discoveryLevel);
  const mostPlayedConfig = scaleExplorationConfig(10, 4, discoveryLevel);
  const favoritesConfig = scaleExplorationConfig(10, 4, discoveryLevel);
  const quickHitsConfig = scaleExplorationConfig(7, 6, discoveryLevel);
  const longSessionsConfig = scaleExplorationConfig(8, 5, discoveryLevel);

  const recentlyAdded = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'recently-added',
      count: 80,
      pool: recentlyAddedPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'neutral',
      preferAdded: true,
      addedDays: 30,
      extraExplorationBoost: 0.4,
      rotation,
    }),
    explorationPool,
    recentlyAddedConfig.interval,
    recentlyAddedConfig.limit,
  );
  const recentlyAddedCapped = capByAlbum(recentlyAdded, maxPerAlbum);
  noteRotation(rotation, recentlyAddedCapped);
  noteAlbumRotation(albumRotation, recentlyAddedCapped);
  const mostPlayed = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'most-played',
      count: 80,
      pool: mostPlayedPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 5,
      extraPlayBoost: 0.18,
      rotation,
    }),
    explorationPool,
    mostPlayedConfig.interval,
    mostPlayedConfig.limit,
  );
  const mostPlayedCapped = capByAlbum(mostPlayed, maxPerAlbum);
  noteRotation(rotation, mostPlayedCapped);
  noteAlbumRotation(albumRotation, mostPlayedCapped);
  const favorites = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'favorites',
      count: 80,
      pool: favoritesPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 4,
      extraFavoriteBoost: 1,
      rotation,
    }),
    explorationPool,
    favoritesConfig.interval,
    favoritesConfig.limit,
  );
  const favoritesCapped = capByAlbum(favorites, maxPerAlbum);
  noteRotation(rotation, favoritesCapped);
  noteAlbumRotation(albumRotation, favoritesCapped);
  const rediscover = curateFromPool({
    seed,
    salt: 'rediscover',
    count: 80,
    pool: rediscoverPool,
    now,
    profile,
    discoveryLevel,
    randomnessLevel,
    albumRotation,
    recencyMode: 'avoid',
    recencyDays: 30,
    extraExplorationBoost: 0.9,
    rotation,
  });
  const rediscoverCapped = capByAlbum(rediscover, maxPerAlbum);
  noteRotation(rotation, rediscoverCapped);
  noteAlbumRotation(albumRotation, rediscoverCapped);
  const quickHits = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'quick-hits',
      count: 80,
      pool: quickHitsPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 4,
      extraPlayBoost: 0.12,
      rotation,
    }),
    explorationPool,
    quickHitsConfig.interval,
    quickHitsConfig.limit,
    (song) => song.duration > 0 && song.duration <= 180,
  );
  const quickHitsCapped = capByAlbum(quickHits, maxPerAlbum);
  noteRotation(rotation, quickHitsCapped);
  noteAlbumRotation(albumRotation, quickHitsCapped);
  const longSessions = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'long-sessions',
      count: 80,
      pool: longSessionsPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 5,
      extraPlayBoost: 0.1,
      rotation,
    }),
    explorationPool,
    longSessionsConfig.interval,
    longSessionsConfig.limit,
    (song) => song.duration >= 360,
  );
  const longSessionsCapped = capByAlbum(longSessions, maxPerAlbum);
  noteRotation(rotation, longSessionsCapped);
  noteAlbumRotation(albumRotation, longSessionsCapped);
  const deepCuts = curateFromPool({
    seed,
    salt: 'deep-cuts',
    count: 80,
    pool: deepCutsPool,
    now,
    profile,
    discoveryLevel,
    randomnessLevel,
    albumRotation,
    recencyMode: 'avoid',
    recencyDays: 45,
    extraExplorationBoost: 1.1,
    rotation,
  });
  const deepCutsCapped = capByAlbum(deepCuts, maxPerAlbum);
  noteRotation(rotation, deepCutsCapped);
  noteAlbumRotation(albumRotation, deepCutsCapped);
  const lovedAndPlayed = curateFromPool({
    seed,
    salt: 'loved-played',
    count: 80,
    pool: lovedAndPlayedPool,
    now,
    profile,
    discoveryLevel,
    randomnessLevel,
    albumRotation,
    recencyMode: 'avoid',
    recencyDays: 4,
    extraPlayBoost: 0.16,
    extraFavoriteBoost: 0.6,
    rotation,
  });
  const lovedAndPlayedCapped = capByAlbum(lovedAndPlayed, maxPerAlbum);
  noteRotation(rotation, lovedAndPlayedCapped);
  noteAlbumRotation(albumRotation, lovedAndPlayedCapped);

  const playlists: Playlist[] = [
    mapPlaylist('smart_daily_mix', 'Daily Mix', 'Fresh daily mix with genre balance.', dailyCapped),
    mapPlaylist('smart_on_repeat', 'On Repeat', 'Songs you have been playing most this week.', shuffleWithSpacing(onRepeatCapped, seed)),
    mapPlaylist('smart_recently_played', 'Recently Played', 'Tracks you listened to most recently.', recentlyPlayed),
    mapPlaylist(
      'smart_recently_added',
      'Recently Added',
      'Latest tracks added to your library.',
      recentlyAddedCapped,
    ),
    mapPlaylist(
      'smart_most_played',
      'Most Played',
      'Your most replayed songs.',
      mostPlayedCapped,
    ),
    mapPlaylist('smart_rediscover', 'Rediscover', 'Songs you have not played in a while.', rediscoverCapped),
    mapPlaylist(
      'smart_favorites',
      'Favorites',
      'Your favorited songs.',
      favoritesCapped,
    ),
  ];

  if (lovedAndPlayed.length) {
    playlists.push(
      mapPlaylist('smart_loved_played', 'Loved & Played', 'Favorites you keep coming back to.', lovedAndPlayedCapped),
    );
  }
  if (quickHits.length) {
    playlists.push(
      mapPlaylist(
        'smart_quick_hits',
        'Quick Hits',
        'Short, punchy tracks under 3 minutes.',
        quickHitsCapped,
      ),
    );
  }
  if (longSessions.length) {
    playlists.push(
      mapPlaylist(
        'smart_long_sessions',
        'Long Sessions',
        'Longer tracks for deep listening.',
        longSessionsCapped,
      ),
    );
  }
  if (deepCuts.length) {
    playlists.push(
      mapPlaylist('smart_deep_cuts', 'Deep Cuts', 'Less-played gems from your library.', deepCutsCapped),
    );
  }
  if (exploreMix.length) {
    playlists.push(
      mapPlaylist(
        'smart_explore',
        'Explore',
        'New edges from your library, tuned for discovery.',
        exploreCapped,
      ),
    );
  }

  const merged = [...playlists, ...carryMixes];
  const ordered = ensureUniqueFirstAlbums(merged, songsById);
  const diversified = diversifyFirstTracks(ordered, songsById, seed);
  const withArtwork = applyArtworkFromFirstSong(diversified, songsById);
  const withOverrides = applyOverrides(withArtwork, overrides, songs);
  return assignUniqueSmartArtworkSync(withOverrides, songsById);
};

export const generateSmartPlaylists = (
  songs: Song[],
  overrides: Record<string, string[]> = {},
  seedOverride?: number,
  albumTracklistCache?: AlbumTracklistCache,
  dailyMixOverride?: Song[],
  dailySeedOverride?: number,
  profile?: ListeningProfile,
  discoveryIntensity?: number,
  randomnessIntensity?: number,
): Playlist[] => {
  const now = Math.floor(Date.now() / 1000);
  const seed = seedOverride ?? weeklySeed();
  const dailySeedValue = dailySeedOverride ?? dailySeed();
  const discoveryLevel = resolveDiscoveryLevel(discoveryIntensity);
  const randomnessLevel = resolveRandomnessLevel(randomnessIntensity);
  const rotation = new Map<string, number>();
  const albumRotation = new Map<string, number>();
  const songsById = new Map(songs.map((song) => [song.id, song]));
  const explorationPool = buildExplorationPool(songs, now);
  const recentlyAddedPool = [...songs].sort((a, b) => b.addedAt - a.addedAt).slice(0, Math.min(240, songs.length));
  const mostPlayedPool = [...songs].sort(byPlayCount).slice(0, Math.min(300, songs.length));
  const rediscoverCutoff = now - 45 * DAY_SEC;
  const rediscoverPool = songs
    .filter((song) => !song.lastPlayed || song.lastPlayed < rediscoverCutoff)
    .sort((a, b) => (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0))
    .slice(0, Math.min(240, songs.length));
  const favoritesPool = songs.filter((song) => song.favorite);
  const recentlyPlayed = [...songs]
    .filter((song) => song.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    .slice(0, 120);
  const dailyMix = dailyMixOverride ?? pickDailyMix(songs, dailySeedValue, profile, discoveryLevel, randomnessLevel, rotation);
  if (dailyMixOverride) {
    noteRotation(rotation, dailyMixOverride);
  }
  const maxPerAlbum = Math.max(2, Math.round(4 - randomnessLevel * 2));
  const dailyCapped = capByAlbum(dailyMix, maxPerAlbum);
  noteRotation(rotation, dailyCapped);
  noteAlbumRotation(albumRotation, dailyCapped);
  const onRepeat = pickOnRepeat(songs, seed, profile, randomnessLevel, rotation);
  const onRepeatCapped = capByAlbum(onRepeat, Math.max(2, Math.round(4 - randomnessLevel)));
  noteRotation(rotation, onRepeatCapped);
  noteAlbumRotation(albumRotation, onRepeatCapped);
  const genreMixes = buildGenreMixes(songs, seed, profile, discoveryLevel, randomnessLevel, albumRotation, maxPerAlbum, rotation);
  const moodMixes = buildMoodMixes(songs, seed, profile, discoveryLevel, randomnessLevel, albumRotation, maxPerAlbum, rotation);
  const exploreMix = buildExploreMix(songs, explorationPool, seed, discoveryLevel, randomnessLevel, rotation);
  const exploreCapped = capByAlbum(exploreMix, maxPerAlbum);
  noteRotation(rotation, exploreCapped);
  noteAlbumRotation(albumRotation, exploreCapped);
  const quickHitsPool = songs.filter((song) => song.duration > 0 && song.duration <= 180);
  const longSessionsPool = songs.filter((song) => song.duration >= 360);
  const deepCutsPool = songs.filter((song) => song.playCount <= 1 && song.addedAt < now - 21 * DAY_SEC);
  const lovedAndPlayedPool = songs.filter((song) => song.favorite && song.playCount > 0);
  const albumSpotlight = pickAlbumSpotlight(songs, seed, albumTracklistCache);
  const recentlyAddedConfig = scaleExplorationConfig(8, 6, discoveryLevel);
  const mostPlayedConfig = scaleExplorationConfig(10, 4, discoveryLevel);
  const favoritesConfig = scaleExplorationConfig(10, 4, discoveryLevel);
  const quickHitsConfig = scaleExplorationConfig(7, 6, discoveryLevel);
  const longSessionsConfig = scaleExplorationConfig(8, 5, discoveryLevel);

  const recentlyAdded = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'recently-added',
      count: 80,
      pool: recentlyAddedPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'neutral',
      preferAdded: true,
      addedDays: 30,
      extraExplorationBoost: 0.4,
      rotation,
    }),
    explorationPool,
    recentlyAddedConfig.interval,
    recentlyAddedConfig.limit,
  );
  const recentlyAddedCapped = capByAlbum(recentlyAdded, maxPerAlbum);
  noteRotation(rotation, recentlyAddedCapped);
  noteAlbumRotation(albumRotation, recentlyAddedCapped);
  const mostPlayed = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'most-played',
      count: 80,
      pool: mostPlayedPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 5,
      extraPlayBoost: 0.18,
      rotation,
    }),
    explorationPool,
    mostPlayedConfig.interval,
    mostPlayedConfig.limit,
  );
  const mostPlayedCapped = capByAlbum(mostPlayed, maxPerAlbum);
  noteRotation(rotation, mostPlayedCapped);
  noteAlbumRotation(albumRotation, mostPlayedCapped);
  const favorites = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'favorites',
      count: 80,
      pool: favoritesPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 4,
      extraFavoriteBoost: 1,
      rotation,
    }),
    explorationPool,
    favoritesConfig.interval,
    favoritesConfig.limit,
  );
  const favoritesCapped = capByAlbum(favorites, maxPerAlbum);
  noteRotation(rotation, favoritesCapped);
  noteAlbumRotation(albumRotation, favoritesCapped);
  const rediscover = curateFromPool({
    seed,
    salt: 'rediscover',
    count: 80,
    pool: rediscoverPool,
    now,
    profile,
    discoveryLevel,
    randomnessLevel,
    albumRotation,
    recencyMode: 'avoid',
    recencyDays: 30,
    extraExplorationBoost: 0.9,
    rotation,
  });
  const rediscoverCapped = capByAlbum(rediscover, maxPerAlbum);
  noteRotation(rotation, rediscoverCapped);
  noteAlbumRotation(albumRotation, rediscoverCapped);
  const quickHits = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'quick-hits',
      count: 80,
      pool: quickHitsPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 4,
      extraPlayBoost: 0.12,
      rotation,
    }),
    explorationPool,
    quickHitsConfig.interval,
    quickHitsConfig.limit,
    (song) => song.duration > 0 && song.duration <= 180,
  );
  const quickHitsCapped = capByAlbum(quickHits, maxPerAlbum);
  noteRotation(rotation, quickHitsCapped);
  noteAlbumRotation(albumRotation, quickHitsCapped);
  const longSessions = injectExplorationFromPool(
    curateFromPool({
      seed,
      salt: 'long-sessions',
      count: 80,
      pool: longSessionsPool,
      now,
      profile,
      discoveryLevel,
      randomnessLevel,
      albumRotation,
      recencyMode: 'avoid',
      recencyDays: 5,
      extraPlayBoost: 0.1,
      rotation,
    }),
    explorationPool,
    longSessionsConfig.interval,
    longSessionsConfig.limit,
    (song) => song.duration >= 360,
  );
  const longSessionsCapped = capByAlbum(longSessions, maxPerAlbum);
  noteRotation(rotation, longSessionsCapped);
  noteAlbumRotation(albumRotation, longSessionsCapped);
  const deepCuts = curateFromPool({
    seed,
    salt: 'deep-cuts',
    count: 80,
    pool: deepCutsPool,
    now,
    profile,
    discoveryLevel,
    randomnessLevel,
    albumRotation,
    recencyMode: 'avoid',
    recencyDays: 45,
    extraExplorationBoost: 1.1,
    rotation,
  });
  const deepCutsCapped = capByAlbum(deepCuts, maxPerAlbum);
  noteRotation(rotation, deepCutsCapped);
  noteAlbumRotation(albumRotation, deepCutsCapped);
  const lovedAndPlayed = curateFromPool({
    seed,
    salt: 'loved-played',
    count: 80,
    pool: lovedAndPlayedPool,
    now,
    profile,
    discoveryLevel,
    randomnessLevel,
    albumRotation,
    recencyMode: 'avoid',
    recencyDays: 4,
    extraPlayBoost: 0.16,
    extraFavoriteBoost: 0.6,
    rotation,
  });
  const lovedAndPlayedCapped = capByAlbum(lovedAndPlayed, maxPerAlbum);
  noteRotation(rotation, lovedAndPlayedCapped);
  noteAlbumRotation(albumRotation, lovedAndPlayedCapped);

  const playlists: Playlist[] = [
    mapPlaylist('smart_daily_mix', 'Daily Mix', 'Fresh daily mix with genre balance.', dailyCapped),
    mapPlaylist('smart_on_repeat', 'On Repeat', 'Songs you have been playing most this week.', shuffleWithSpacing(onRepeatCapped, seed)),
    ...moodMixes.map((entry) => ({
      ...entry,
      songIds: shuffleWithSpacing(
        entry.songIds.map((id) => songsById.get(id)).filter((song): song is Song => Boolean(song)),
        seed,
        `mood:${entry.id}`,
      ).map((song) => song.id),
    })),
    ...genreMixes.map((entry) => ({
      ...entry,
      songIds: shuffleWithSpacing(
        entry.songIds.map((id) => songsById.get(id)).filter((song): song is Song => Boolean(song)),
        seed,
        `genre:${entry.id}`,
      ).map((song) => song.id),
    })),
    mapPlaylist('smart_recently_played', 'Recently Played', 'Tracks you listened to most recently.', recentlyPlayed),
    mapPlaylist(
      'smart_recently_added',
      'Recently Added',
      'Latest tracks added to your library.',
      recentlyAddedCapped,
    ),
    mapPlaylist(
      'smart_most_played',
      'Most Played',
      'Your most replayed songs.',
      mostPlayedCapped,
    ),
    mapPlaylist('smart_rediscover', 'Rediscover', 'Songs you have not played in a while.', rediscoverCapped),
    mapPlaylist(
      'smart_favorites',
      'Favorites',
      'Your favorited songs.',
      favoritesCapped,
    ),
  ];

  if (lovedAndPlayed.length) {
    playlists.push(
      mapPlaylist('smart_loved_played', 'Loved & Played', 'Favorites you keep coming back to.', lovedAndPlayedCapped),
    );
  }
  if (quickHits.length) {
    playlists.push(
      mapPlaylist(
        'smart_quick_hits',
        'Quick Hits',
        'Short, punchy tracks under 3 minutes.',
        quickHitsCapped,
      ),
    );
  }
  if (longSessions.length) {
    playlists.push(
      mapPlaylist(
        'smart_long_sessions',
        'Long Sessions',
        'Longer tracks for deep listening.',
        longSessionsCapped,
      ),
    );
  }
  if (deepCuts.length) {
    playlists.push(
      mapPlaylist('smart_deep_cuts', 'Deep Cuts', 'Less-played gems from your library.', deepCutsCapped),
    );
  }
  if (exploreMix.length) {
    playlists.push(
      mapPlaylist(
        'smart_explore',
        'Explore',
        'New edges from your library, tuned for discovery.',
        exploreCapped,
      ),
    );
  }
  if (albumSpotlight.length) {
    playlists.push(
      mapPlaylist(
        'smart_album_spotlight',
        'Album Spotlight',
        'A full album, front to back.',
        albumSpotlight,
        'smart',
      ),
    );
  }

  const ordered = ensureUniqueFirstAlbums(playlists, songsById);
  const diversified = diversifyFirstTracks(ordered, songsById, seed);
  const withArtwork = applyArtworkFromFirstSong(diversified, songsById);
  const withOverrides = applyOverrides(withArtwork, overrides, songs);
  return assignUniqueSmartArtworkSync(withOverrides, songsById);
};

const pickAlbumSpotlight = (songs: Song[], seed: number, albumTracklistCache?: AlbumTracklistCache): Song[] => {
  const include = hash(`album-spotlight:${seed}`) % 3 === 0;
  if (!include) {
    return [];
  }

  const albumMap = new Map<string, Song[]>();
  for (const song of songs) {
    if (!song.album?.trim()) {
      continue;
    }
    const primaryArtist = getPrimaryArtistName(song.artist);
    const key = `${primaryArtist.toLowerCase()}::${song.album.trim().toLowerCase()}`;
    const list = albumMap.get(key) ?? [];
    list.push(song);
    albumMap.set(key, list);
  }

  const albums = [...albumMap.values()]
    .map((albumSongs) => {
      const sorted = sortAlbumTracks(albumSongs);
      if (!albumTracklistCache) {
        return null;
      }
      const primaryArtist = getPrimaryArtistName(sorted[0]?.artist);
      const albumName = sorted[0]?.album ?? '';
      const key = getAlbumTracklistKey(primaryArtist, albumName);
      const tracklist = albumTracklistCache[key];
      if (!tracklist?.tracks?.length) {
        return null;
      }
      const byTrack = new Map<number, Song>();
      const byTitle = new Map<string, Song>();
      for (const song of sorted) {
        if (song.track && song.track > 0 && !byTrack.has(song.track)) {
          byTrack.set(song.track, song);
        }
        const normalized = normalizeTrackTitle(song.title);
        if (normalized && !byTitle.has(normalized)) {
          byTitle.set(normalized, song);
        }
      }
      const orderedMatches: Song[] = [];
      const matchedIds = new Set<string>();
      for (const track of tracklist.tracks) {
        const normalized = normalizeTrackTitle(track.title);
        const match = byTrack.get(track.position) ?? (normalized ? byTitle.get(normalized) : undefined);
        if (match && !matchedIds.has(match.id)) {
          matchedIds.add(match.id);
          orderedMatches.push(match);
        }
      }
      if (orderedMatches.length !== tracklist.tracks.length || orderedMatches.length < 6) {
        return null;
      }
      return orderedMatches;
    })
    .filter((albumSongs): albumSongs is Song[] => Boolean(albumSongs));

  if (!albums.length) {
    return [];
  }

  const index = hash(`album-spotlight-pick:${seed}`) % albums.length;
  return albums[index] ?? [];
};
