import { type CanonicalGenre, genreSlug } from './genres';
import { moodMixId } from './moods';
import type { LibraryStats, SongSignals } from './signals';
import type { MixDefinition, MoodDefinition } from './types';

/**
 * The mix table. `exploitShare` is the percentage drawn from the familiar pool; the remainder
 * comes from the unfamiliar pool (see engine.ts). Predicates live in `isEligible` below.
 */
export const CORE_MIXES: readonly MixDefinition[] = [
  {
    id: 'smart_daily_mix',
    kind: 'daily',
    name: 'Daily Mix',
    description: 'Fresh daily mix with genre balance.',
    type: 'daily',
    target: 60,
    minEligible: 0,
    exploitShare: 70,
    always: true,
    lite: true,
    seedScope: 'daily',
  },
  {
    id: 'smart_on_repeat',
    kind: 'on_repeat',
    name: 'On Repeat',
    description: 'Songs you have been playing most this week.',
    type: 'smart',
    target: 60,
    minEligible: 0,
    exploitShare: 95,
    family: 'recent',
    always: true,
    lite: true,
    seedScope: 'weekly',
  },
  {
    id: 'smart_recently_played',
    kind: 'recently_played',
    name: 'Recently Played',
    description: 'Tracks you listened to most recently.',
    type: 'smart',
    target: 100,
    minEligible: 0,
    exploitShare: 100,
    family: 'recent',
    always: true,
    lite: true,
    seedScope: 'weekly',
    ordered: true,
  },
  {
    id: 'smart_recently_added',
    kind: 'recently_added',
    name: 'Recently Added',
    description: 'Latest tracks added to your library.',
    type: 'smart',
    target: 80,
    minEligible: 0,
    exploitShare: 50,
    always: true,
    lite: false,
    seedScope: 'weekly',
  },
  {
    id: 'smart_most_played',
    kind: 'most_played',
    name: 'Most Played',
    description: 'Your most replayed songs.',
    type: 'smart',
    target: 80,
    minEligible: 0,
    exploitShare: 100,
    always: true,
    lite: false,
    seedScope: 'weekly',
  },
  {
    id: 'smart_rediscover',
    kind: 'rediscover',
    name: 'Rediscover',
    description: 'Songs you have not played in a while.',
    type: 'smart',
    target: 80,
    minEligible: 0,
    exploitShare: 100,
    family: 'discovery',
    always: true,
    lite: false,
    seedScope: 'weekly',
  },
  {
    id: 'smart_favorites',
    kind: 'favorites',
    name: 'Favorites',
    description: 'Your favorited songs.',
    type: 'smart',
    target: 80,
    minEligible: 0,
    exploitShare: 90,
    family: 'loved',
    always: true,
    lite: true,
    seedScope: 'weekly',
  },
  {
    id: 'smart_loved_played',
    kind: 'loved_played',
    name: 'Loved & Played',
    description: 'Favorites you keep coming back to.',
    type: 'smart',
    target: 80,
    minEligible: 5,
    exploitShare: 100,
    family: 'loved',
    always: false,
    lite: false,
    seedScope: 'weekly',
  },
  {
    id: 'smart_quick_hits',
    kind: 'quick_hits',
    name: 'Quick Hits',
    description: 'Short, punchy tracks under 3 minutes.',
    type: 'smart',
    target: 80,
    minEligible: 5,
    exploitShare: 70,
    always: false,
    lite: false,
    seedScope: 'weekly',
  },
  {
    id: 'smart_long_sessions',
    kind: 'long_sessions',
    name: 'Long Sessions',
    description: 'Longer tracks for deep listening.',
    type: 'smart',
    target: 60,
    minEligible: 5,
    exploitShare: 70,
    always: false,
    lite: false,
    seedScope: 'weekly',
  },
  {
    id: 'smart_deep_cuts',
    kind: 'deep_cuts',
    name: 'Deep Cuts',
    description: 'Less-played gems from your library.',
    type: 'smart',
    target: 80,
    minEligible: 5,
    exploitShare: 30,
    family: 'discovery',
    always: false,
    lite: false,
    seedScope: 'weekly',
  },
  {
    id: 'smart_explore',
    kind: 'explore',
    name: 'Explore',
    description: 'New edges from your library, tuned for discovery.',
    type: 'smart',
    target: 80,
    minEligible: 5,
    exploitShare: 15,
    family: 'discovery',
    always: false,
    lite: true,
    seedScope: 'weekly',
  },
];

export const GENRE_MIX_TARGET = 80;
export const GENRE_MIX_MIN_ELIGIBLE = 12;
export const MAX_GENRE_MIXES = 8;
export const MOOD_MIX_TARGET = 60;
export const MOOD_MIX_MIN_ELIGIBLE = 15;
export const MIN_SCALED_TARGET = 15;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

/**
 * Small libraries cannot feed 30+ mixes under the "a song sits in at most two mixes" rule, so
 * every target except the Daily Mix shrinks linearly below 1000 songs (never under 60%), and
 * the number of genre / mood mixes grows with the library (one per 100 songs).
 */
export const librarySizeScale = (librarySize: number): number => clamp(librarySize / 1000, 0.6, 1);

export const scaledTarget = (base: number, librarySize: number): number =>
  Math.max(MIN_SCALED_TARGET, Math.round(base * librarySizeScale(librarySize)));

export const effectiveTarget = (def: MixDefinition, librarySize: number): number =>
  def.kind === 'daily' ? def.target : scaledTarget(def.target, librarySize);

export const maxGenreMixesFor = (librarySize: number): number => clamp(Math.floor(librarySize / 100), 2, MAX_GENRE_MIXES);
export const maxMoodMixesFor = (librarySize: number): number => clamp(Math.floor(librarySize / 100), 3, 12);

export const genreMixDefinition = (genre: CanonicalGenre, librarySize: number): MixDefinition => ({
  id: `smart_genre_mix_${genreSlug(genre)}`,
  kind: 'genre',
  name: `${genre} Mix`,
  description: `Mix based on your ${genre} tracks.`,
  type: 'smart',
  target: scaledTarget(GENRE_MIX_TARGET, librarySize),
  minEligible: GENRE_MIX_MIN_ELIGIBLE,
  exploitShare: 80,
  always: false,
  lite: false,
  seedScope: 'weekly',
  genre,
});

export const moodMixDefinition = (mood: MoodDefinition, librarySize: number): MixDefinition => ({
  id: moodMixId(mood.id),
  kind: 'mood',
  name: mood.name,
  description: mood.description,
  type: 'smart',
  target: scaledTarget(MOOD_MIX_TARGET, librarySize),
  minEligible: MOOD_MIX_MIN_ELIGIBLE,
  exploitShare: 75,
  always: false,
  lite: false,
  seedScope: 'weekly',
  mood,
});

/** Number of songs carrying at least one strong hint of the mood. */
export const moodEligibleCount = (mood: MoodDefinition, signals: readonly SongSignals[]): number => {
  let count = 0;
  for (const signal of signals) {
    for (const hint of mood.genreHints) {
      if (signal.genreHints.has(hint)) {
        count += 1;
        break;
      }
    }
  }
  return count;
};

/** Everything a predicate or rank function may look at besides the song itself. */
export interface RankContext {
  stats: LibraryStats;
  /** Songs played within this many hours are excluded from Daily / Explore. */
  recencyExcludeHours: number;
  /** Recently Added pool boundary: songs added within this many days. */
  recentlyAddedCutoffDays: number;
  /** Explore: ids surfaced by Explore in the last 7 days (hard exclusion). */
  exploreExcludedIds: ReadonlySet<string>;
  /** Genre/mood: ids shown by the same mix in the last 14 days (soft penalty). */
  historyPenaltyIds: ReadonlySet<string>;
  /** Rediscover fell back to "oldest never played" (cold start). */
  rediscoverFallback: boolean;
}

const hoursSincePlayed = (signal: SongSignals): number => signal.daysSincePlayed * 24;

export const isEligible = (def: MixDefinition, signal: SongSignals, ctx: RankContext): boolean => {
  switch (def.kind) {
    case 'daily':
      return hoursSincePlayed(signal) > ctx.recencyExcludeHours;
    case 'on_repeat':
      return signal.playCount > 0 && signal.recentPlays21d >= 3;
    case 'recently_played':
      return signal.playCount > 0 && Number.isFinite(signal.daysSincePlayed);
    case 'recently_added':
      return signal.daysSinceAdded <= ctx.recentlyAddedCutoffDays;
    case 'most_played':
      return signal.playCount > 0 && signal.decayedPlays >= ctx.stats.mostPlayedThreshold;
    case 'rediscover':
      return ctx.rediscoverFallback
        ? signal.playCount === 0
        : signal.playCount > 0 && signal.daysSincePlayed > 45;
    case 'favorites':
      return signal.favorite;
    case 'loved_played':
      return signal.favorite && signal.playCount > 0;
    case 'quick_hits':
      return signal.duration > 0 && signal.duration <= 180;
    case 'long_sessions':
      return signal.duration >= 360;
    case 'deep_cuts':
      return signal.playCount <= 1 && signal.daysSinceAdded > 21;
    case 'explore':
      return (
        (signal.playCount === 0 || signal.daysSincePlayed > 30) &&
        hoursSincePlayed(signal) > ctx.recencyExcludeHours &&
        !ctx.exploreExcludedIds.has(signal.id)
      );
    case 'genre':
      return signal.genre !== null && signal.genre === def.genre;
    case 'mood': {
      const mood = def.mood;
      if (!mood) return false;
      for (const hint of mood.genreHints) {
        if (signal.genreHints.has(hint)) return true;
      }
      return false;
    }
    default:
      return false;
  }
};

const norm = (value: number, max: number): number => (max > 0 ? Math.min(1, value / max) : 0);

/** 1 for never played, 0.5 for played just now, recovering with `halfLifeDays`. */
const recencyFactor = (signal: SongSignals, halfLifeDays: number): number =>
  Number.isFinite(signal.daysSincePlayed) ? 1 - 0.5 * Math.exp(-signal.daysSincePlayed / halfLifeDays) : 1;

/** 0..~1 affinity of the listener for a song, with exponential decay baked into `decayedPlays`. */
export const tasteScore = (signal: SongSignals, stats: LibraryStats): number => {
  const { taste } = stats;
  const artist = norm(taste.artistShare.get(signal.artistKey) ?? 0, taste.maxArtistShare);
  const genre = signal.genre ? norm(taste.genreShare.get(signal.genre) ?? 0, taste.maxGenreShare) : 0;
  const plays = Math.log1p(signal.decayedPlays) / Math.log1p(Math.max(1, stats.maxDecayedPlays));
  const completion = signal.completion ?? 0.6;
  const trend = Math.min(1, signal.trendCount / 10);
  const manual = Math.min(1, signal.manualAdds / 5);
  const score =
    0.1 +
    0.3 * artist +
    0.15 * genre +
    0.2 * plays +
    0.1 * completion +
    0.08 * signal.hourAffinity +
    0.12 * (signal.favorite ? 1 : 0) +
    0.08 * trend +
    0.05 * manual -
    0.35 * signal.skipRate;
  return Math.max(0.01, score);
};

const moodRank = (mood: MoodDefinition, signal: SongSignals, taste: number): number => {
  let strong = 0;
  for (const hint of mood.genreHints) {
    if (signal.genreHints.has(hint)) strong += 1;
  }
  let title = 0;
  for (const hint of mood.titleHints) {
    if (signal.titleHints.has(hint)) title += 1;
  }
  let score = 0.4 + 0.5 * Math.min(2, strong) + 0.15 * Math.min(2, title);
  const { prefs } = mood;
  if (prefs.maxDuration !== undefined && signal.duration > 0) {
    score += signal.duration <= prefs.maxDuration ? 0.25 : signal.duration > prefs.maxDuration * 1.3 ? -0.25 : -0.1;
  }
  if (prefs.minDuration !== undefined && signal.duration > 0) {
    score += signal.duration >= prefs.minDuration ? 0.25 : signal.duration < prefs.minDuration * 0.7 ? -0.25 : -0.1;
  }
  if (prefs.daypart !== undefined) {
    score += 0.3 * signal.daypartShare[prefs.daypart];
  }
  if (prefs.favoriteBoost && signal.favorite) {
    score += prefs.favoriteBoost;
  }
  if (prefs.olderYearsBoost && signal.year > 0) {
    score += signal.year < 2005 ? 0.2 : -0.05;
  }
  return Math.max(0.05, score) * (0.5 + 0.5 * taste) * recencyFactor(signal, 4);
};

/** Mix-specific rank key (higher is better). Penalties from assignment/history are applied by the caller. */
export const rankOf = (def: MixDefinition, signal: SongSignals, ctx: RankContext): number => {
  const { stats } = ctx;
  const taste = tasteScore(signal, stats);
  const artistNorm = norm(stats.taste.artistShare.get(signal.artistKey) ?? 0, stats.taste.maxArtistShare);
  const genreNorm = signal.genre ? norm(stats.taste.genreShare.get(signal.genre) ?? 0, stats.taste.maxGenreShare) : 0;
  const playsNorm = Math.log1p(signal.decayedPlays) / Math.log1p(Math.max(1, stats.maxDecayedPlays));
  switch (def.kind) {
    case 'daily':
      return taste * recencyFactor(signal, 3) + (signal.isNew ? 0.08 : 0);
    case 'on_repeat':
      return signal.recentPlays21d + 0.3 * signal.decayedPlays + 0.2 * taste - 0.5 * signal.skipRate;
    case 'recently_played':
      return Number.isFinite(signal.daysSincePlayed) ? -signal.daysSincePlayed : Number.NEGATIVE_INFINITY;
    case 'recently_added':
      return Math.exp(-signal.daysSinceAdded / 30) * (0.5 + 0.5 * taste);
    case 'most_played':
      return (playsNorm * (1 - 0.3 * signal.skipRate) + 0.2 * taste) * recencyFactor(signal, 2);
    case 'rediscover': {
      if (ctx.rediscoverFallback) {
        return norm(signal.daysSinceAdded, stats.maxDaysSinceAdded) + 0.2 * taste;
      }
      const rested = 1 - Math.exp(-signal.daysSincePlayed / 180);
      const loved = Math.log1p(signal.playCount) / Math.log1p(Math.max(1, stats.maxPlayCount));
      return rested * (0.4 + 0.6 * loved) + 0.2 * taste;
    }
    case 'favorites':
      return taste * recencyFactor(signal, 3);
    case 'loved_played':
      return (0.5 * playsNorm + 0.5 * taste) * recencyFactor(signal, 3);
    case 'quick_hits':
    case 'long_sessions':
      return taste * recencyFactor(signal, 3);
    case 'deep_cuts':
      return (0.5 * artistNorm + 0.3 * genreNorm + 0.2 * (signal.playCount === 0 ? 1 : 0.5)) * recencyFactor(signal, 30);
    case 'explore': {
      const novelty = signal.playCount === 0 ? 1 : 0.6;
      const unfamiliarArtist = 1 - artistNorm;
      const fewTracks = 1 / Math.sqrt(Math.max(1, stats.artistTrackCount.get(signal.artistKey) ?? 1));
      if (stats.coldStart) {
        return 0.6 * fewTracks + 0.2 * novelty + 0.2 * (signal.isNew ? 1 : 0.5);
      }
      return 0.35 * novelty + 0.25 * unfamiliarArtist + 0.2 * fewTracks + 0.2 * genreNorm - 0.3 * signal.skipRate;
    }
    case 'genre':
      return taste * recencyFactor(signal, 4);
    case 'mood':
      return def.mood ? moodRank(def.mood, signal, taste) : 0;
    default:
      return taste;
  }
};
