import type { Playlist } from '@/types/music';
import { djb2 } from '@/utils/hash';
import { rngFor, seededShuffle } from '@/utils/random';
import { canUse, createAssignmentState, noteUse, usagePenalty, type AssignmentState } from './assign';
import { capsForTarget, selectWithCaps, shuffleWithSpacing } from './diversity';
import { compareGenres, type CanonicalGenre } from './genres';
import { dayKeyFor, idsWithinDays, previousEntry, withTodayEntry } from './history';
import { MOODS } from './moods';
import { interleaveByShare, rouletteDraw, roundRobinByStratum } from './sampling';
import {
  CORE_MIXES,
  GENRE_MIX_MIN_ELIGIBLE,
  MOOD_MIX_MIN_ELIGIBLE,
  effectiveTarget,
  genreMixDefinition,
  isEligible,
  maxGenreMixesFor,
  maxMoodMixesFor,
  moodEligibleCount,
  moodMixDefinition,
  rankOf,
  type RankContext,
} from './score';
import { computeSignals, toSeconds, type LibraryStats, type SongSignals } from './signals';
import type { MixDefinition, MixDiagnostics, MixEngineInput, MixEngineOutput, MixHistory, MixKind } from './types';

const clamp01 = (value: number | undefined, fallback: number): number =>
  value === undefined || !Number.isFinite(value) ? fallback : Math.max(0, Math.min(1, value));

const DEFAULT_DISCOVERY = 0.35;
const DEFAULT_RANDOMNESS = 0.3;
const RECENCY_EXCLUDE_HOURS = 36;
const RECENCY_EXCLUDE_RELAXED_HOURS = 12;
const RECENTLY_ADDED_POOL = 240;
const REDISCOVER_MIN_BEFORE_FALLBACK = 10;
const DAILY_YESTERDAY_SHARE = 0.2;
const DAILY_RESERVE_FACTOR = 3;
const DAILY_RESERVE_POOL_CAP = 1000;
const EXPLORE_HISTORY_DAYS = 7;
const SHOWN_HISTORY_DAYS = 14;
const SHOWN_HISTORY_PENALTY = 0.7;
const OVERDRAW = 3;

/**
 * Priority in which mixes claim songs (cross-mix exclusivity). Within a family the more specific
 * mix goes first so the broader one is what gets thinned out. The Daily Mix is special: a weekly
 * seeded reservation is made for it up front (see `reserveForDaily`), and its final pick happens
 * last so that the daily seed can never perturb the weekly mixes.
 */
const ASSIGNMENT_ORDER: readonly MixKind[] = [
  'on_repeat',
  'explore',
  'most_played',
  'genre',
  'mood',
  'recently_played',
  'recently_added',
  'loved_played',
  'favorites',
  'rediscover',
  'quick_hits',
  'long_sessions',
  'deep_cuts',
  'daily',
];

/** Order in which playlists are returned (what the UI shows). */
const DISPLAY_ORDER: readonly MixKind[] = [
  'daily',
  'on_repeat',
  'recently_played',
  'recently_added',
  'most_played',
  'rediscover',
  'favorites',
  'loved_played',
  'quick_hits',
  'long_sessions',
  'deep_cuts',
  'explore',
  'genre',
  'mood',
];

const LITE_KINDS: ReadonlySet<MixKind> = new Set(['daily', 'on_repeat', 'recently_played', 'favorites', 'explore']);

interface ResolvedMix {
  def: MixDefinition;
  songs: SongSignals[];
  eligible: number;
  poolSize: number;
  reason?: string;
}

interface Prepared {
  ctx: RankContext;
  eligible: SongSignals[];
  poolSize: number;
  reason?: string;
}

interface EngineState {
  signals: SongSignals[];
  stats: LibraryStats;
  nowSec: number;
  todayKey: string;
  history: MixHistory;
  discovery: number;
  randomness: number;
  weeklyBase: number;
  dailyBase: number;
  assignment: AssignmentState;
  recentlyAddedCutoffDays: number;
  librarySize: number;
  dailyPrepared?: Prepared & { ranks: Map<string, number> };
}

const compareByRank = (ranks: Map<string, number>) => (a: SongSignals, b: SongSignals): number => {
  const delta = (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0);
  return delta !== 0 ? delta : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const buildGenreMixes = (signals: readonly SongSignals[], coldStart: boolean, librarySize: number): MixDefinition[] => {
  const counts = new Map<string, { count: number; plays: number }>();
  for (const signal of signals) {
    if (!signal.genre) continue;
    const entry = counts.get(signal.genre) ?? { count: 0, plays: 0 };
    entry.count += 1;
    entry.plays += signal.decayedPlays;
    counts.set(signal.genre, entry);
  }
  return [...counts.entries()]
    .filter(([, entry]) => entry.count >= GENRE_MIX_MIN_ELIGIBLE)
    .sort((a, b) => {
      if (!coldStart && b[1].plays !== a[1].plays) return b[1].plays - a[1].plays;
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return compareGenres(a[0], b[0]);
    })
    .slice(0, maxGenreMixesFor(librarySize))
    .map(([genre]) => genreMixDefinition(genre as CanonicalGenre, librarySize));
};

/** Moods with enough strongly hinted songs, most eligible first, capped by library size. */
const buildMoodMixes = (signals: readonly SongSignals[], librarySize: number): MixDefinition[] =>
  MOODS.map((mood, index) => ({ mood, index, count: moodEligibleCount(mood, signals) }))
    .filter((entry) => entry.count >= MOOD_MIX_MIN_ELIGIBLE)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, maxMoodMixesFor(librarySize))
    .sort((a, b) => a.index - b.index)
    .map((entry) => moodMixDefinition(entry.mood, librarySize));

const recentlyAddedCutoff = (signals: readonly SongSignals[]): number => {
  if (signals.length <= RECENTLY_ADDED_POOL) {
    return Number.POSITIVE_INFINITY;
  }
  const ages = signals.map((signal) => signal.daysSinceAdded).sort((a, b) => a - b);
  return ages[RECENTLY_ADDED_POOL - 1];
};

/** Exploit share (0..1) after the discovery intensity shift of up to +-15 points. */
const exploitShareFor = (state: EngineState, def: MixDefinition): number => {
  const shift =
    state.discovery >= DEFAULT_DISCOVERY
      ? ((state.discovery - DEFAULT_DISCOVERY) / (1 - DEFAULT_DISCOVERY)) * 15
      : ((state.discovery - DEFAULT_DISCOVERY) / DEFAULT_DISCOVERY) * 15;
  return Math.max(0, Math.min(1, (def.exploitShare - shift) / 100));
};

const targetOf = (state: EngineState, def: MixDefinition): number => effectiveTarget(def, state.librarySize);

/** Apply the hard predicates (with the recency relaxation and Rediscover fallback rules). */
const prepare = (state: EngineState, def: MixDefinition): Prepared => {
  const { signals, stats, history, todayKey } = state;
  const poolSize = def.kind === 'recently_added' ? Math.min(RECENTLY_ADDED_POOL, signals.length) : signals.length;
  const ctx: RankContext = {
    stats,
    recencyExcludeHours: RECENCY_EXCLUDE_HOURS,
    recentlyAddedCutoffDays: state.recentlyAddedCutoffDays,
    exploreExcludedIds: def.kind === 'explore' ? idsWithinDays(history, def.id, todayKey, EXPLORE_HISTORY_DAYS) : new Set(),
    historyPenaltyIds:
      def.kind === 'genre' || def.kind === 'mood' ? idsWithinDays(history, def.id, todayKey, SHOWN_HISTORY_DAYS) : new Set(),
    rediscoverFallback: false,
  };
  let reason: string | undefined;
  let eligible = signals.filter((signal) => isEligible(def, signal, ctx));
  if ((def.kind === 'daily' || def.kind === 'explore') && eligible.length < targetOf(state, def)) {
    ctx.recencyExcludeHours = RECENCY_EXCLUDE_RELAXED_HOURS;
    eligible = signals.filter((signal) => isEligible(def, signal, ctx));
    reason = 'relaxed-recency-12h';
  }
  if (def.kind === 'rediscover' && eligible.length < REDISCOVER_MIN_BEFORE_FALLBACK) {
    ctx.rediscoverFallback = true;
    eligible = signals.filter((signal) => isEligible(def, signal, ctx));
    reason = 'cold-start-fallback';
  }
  return { ctx, eligible, poolSize, reason };
};

const rankEligible = (
  state: EngineState,
  def: MixDefinition,
  prepared: Prepared,
  withUsagePenalty: boolean,
): Map<string, number> => {
  const ranks = new Map<string, number>();
  for (const signal of prepared.eligible) {
    let rank = rankOf(def, signal, prepared.ctx);
    if (withUsagePenalty) {
      rank *= usagePenalty(state.assignment, signal.id);
    }
    if (prepared.ctx.historyPenaltyIds.has(signal.id)) {
      rank *= SHOWN_HISTORY_PENALTY;
    }
    ranks.set(signal.id, rank);
  }
  return ranks;
};

interface DrawOptions {
  seed: number;
  salt: string;
  pool: readonly SongSignals[];
  ranks: Map<string, number>;
  exploitShare: number;
  totalDraw: number;
  poolCap: number;
  /** Append the undrawn remainder in rank order so constraints can back-fill. */
  backfill: boolean;
}

/**
 * Explore/exploit split from separate pools (familiar vs unfamiliar), seeded roulette without
 * replacement in each, interleaved by share. `randomness` sets the temperature and rank jitter.
 */
const drawCandidates = (state: EngineState, options: DrawOptions): SongSignals[] => {
  const { seed, salt, ranks, exploitShare, totalDraw, poolCap } = options;
  const byRank = compareByRank(ranks);
  const exploitSorted = options.pool.filter((signal) => signal.familiar).sort(byRank);
  const exploreSorted = options.pool.filter((signal) => !signal.familiar).sort(byRank);
  const exploit = exploitSorted.slice(0, poolCap);
  const explore = exploreSorted.slice(0, poolCap);
  const sharpness = 0.5 + 4 * (1 - state.randomness);
  const jitterRng = rngFor(seed, `${salt}:jitter`);
  const jitterAmount = state.randomness * 0.3;
  const jittered = new Map<string, number>();
  const scoreOf = (signal: SongSignals): number => {
    let value = jittered.get(signal.id);
    if (value === undefined) {
      value = (ranks.get(signal.id) ?? 0) * (1 + (jitterRng() - 0.5) * jitterAmount);
      jittered.set(signal.id, value);
    }
    return value;
  };
  const wantExploit = Math.round(totalDraw * exploitShare);
  const exploitDraw = rouletteDraw(
    exploit,
    scoreOf,
    Math.max(wantExploit, totalDraw - explore.length),
    rngFor(seed, `${salt}:exploit`),
    sharpness,
  );
  const exploreDraw = rouletteDraw(
    explore,
    scoreOf,
    Math.max(totalDraw - wantExploit, totalDraw - exploit.length),
    rngFor(seed, `${salt}:explore`),
    sharpness,
  );
  let candidates = interleaveByShare(exploitDraw, exploreDraw, exploitShare);
  if (options.backfill && candidates.length < options.pool.length) {
    const drawn = new Set(candidates.map((signal) => signal.id));
    const rest = interleaveByShare(
      exploitSorted.filter((signal) => !drawn.has(signal.id)),
      exploreSorted.filter((signal) => !drawn.has(signal.id)),
      exploitShare,
    );
    candidates = candidates.concat(rest);
  }
  return candidates;
};

/**
 * Stage one for the Daily Mix: pick a weekly-seeded reservation of 3x its target from the
 * eligible pool (no usage penalties, no daily seed). Other mixes may use each reserved song once.
 */
const reserveForDaily = (state: EngineState, def: MixDefinition): void => {
  const prepared = prepare(state, def);
  const ranks = rankEligible(state, def, prepared, false);
  const reserve = drawCandidates(state, {
    seed: state.weeklyBase,
    salt: `${def.id}:reserve`,
    pool: prepared.eligible,
    ranks,
    exploitShare: exploitShareFor(state, def),
    totalDraw: targetOf(state, def) * DAILY_RESERVE_FACTOR,
    poolCap: DAILY_RESERVE_POOL_CAP,
    backfill: false,
  });
  for (const signal of reserve) state.assignment.reserved.add(signal.id);
  state.dailyPrepared = { ...prepared, ranks };
};

const resolveDaily = (state: EngineState, def: MixDefinition): ResolvedMix => {
  const prepared = state.dailyPrepared ?? { ...prepare(state, def), ranks: new Map<string, number>() };
  const { assignment, history, todayKey, stats } = state;
  const reserved = assignment.reserved;
  const seed = state.dailyBase;
  const exploitShare = exploitShareFor(state, def);
  const reservedPool = prepared.eligible.filter((signal) => reserved.has(signal.id));
  let candidates = drawCandidates(state, {
    seed,
    salt: def.id,
    pool: reservedPool,
    ranks: prepared.ranks,
    exploitShare,
    totalDraw: reservedPool.length,
    poolCap: reservedPool.length,
    backfill: false,
  });
  let reason = prepared.reason;
  if (stats.coldStart) {
    candidates = roundRobinByStratum(
      candidates,
      (signal) => `${signal.genre ?? '~'}|${signal.decade}`,
      (keys) => seededShuffle(keys, seed, `${def.id}:strata`),
    );
    reason = reason ?? 'cold-start-stratified';
  }
  // Backfill beyond the reservation in rank order (these may already be used twice).
  const rest = prepared.eligible.filter((signal) => !reserved.has(signal.id)).sort(compareByRank(prepared.ranks));
  candidates = candidates.concat(rest);

  const yesterday = new Set(previousEntry(history, def.id, todayKey)?.songIds ?? []);
  const dailyTarget = targetOf(state, def);
  const maxFromYesterday = Math.floor(DAILY_YESTERDAY_SHARE * dailyTarget);
  let fromYesterday = 0;
  const selected = selectWithCaps(
    candidates,
    dailyTarget,
    capsForTarget(dailyTarget),
    (signal) => {
      if (!canUse(assignment, signal.id, def.family, true)) return false;
      if (yesterday.has(signal.id)) {
        if (fromYesterday >= maxFromYesterday) return false;
        fromYesterday += 1;
      }
      return true;
    },
    (signal) => noteUse(assignment, signal.id, def.family),
  );
  const songs = shuffleWithSpacing(selected, seed, `${def.id}:order`);
  if (!songs.length) reason = reason ?? (prepared.eligible.length ? 'no-candidates-after-constraints' : 'empty-pool');
  return { def, songs, eligible: prepared.eligible.length, poolSize: prepared.poolSize, reason };
};

const resolveMix = (state: EngineState, def: MixDefinition): ResolvedMix => {
  if (def.kind === 'daily') {
    return resolveDaily(state, def);
  }
  const { assignment } = state;
  const prepared = prepare(state, def);
  const { eligible, poolSize } = prepared;
  let reason = prepared.reason;
  if (!def.always && eligible.length < def.minEligible) {
    return { def, songs: [], eligible: eligible.length, poolSize, reason: 'not-enough-eligible' };
  }
  if (!eligible.length) {
    return { def, songs: [], eligible: 0, poolSize, reason: reason ?? 'empty-pool' };
  }
  const seed = state.weeklyBase;
  const target = targetOf(state, def);
  const ranks = rankEligible(state, def, prepared, def.kind !== 'recently_played');
  const candidates = def.ordered
    ? eligible.sort(compareByRank(ranks))
    : drawCandidates(state, {
        seed,
        salt: def.id,
        pool: eligible,
        ranks,
        exploitShare: exploitShareFor(state, def),
        totalDraw: target * OVERDRAW,
        poolCap: Math.max(240, target * 4),
        backfill: true,
      });
  const selected = selectWithCaps(
    candidates,
    target,
    capsForTarget(target),
    (signal) => canUse(assignment, signal.id, def.family),
    (signal) => noteUse(assignment, signal.id, def.family),
  );
  const songs = def.ordered ? selected : shuffleWithSpacing(selected, seed, `${def.id}:order`);
  if (!songs.length) reason = reason ?? 'no-candidates-after-constraints';
  return { def, songs, eligible: eligible.length, poolSize, reason };
};

const toPlaylist = (resolved: ResolvedMix, nowSec: number): Playlist => {
  const artwork = resolved.songs.find((signal) => signal.song.albumArt)?.song.albumArt;
  return {
    id: resolved.def.id,
    name: resolved.def.name,
    type: resolved.def.type,
    description: resolved.def.description,
    songIds: resolved.songs.map((signal) => signal.id),
    ...(artwork ? { artwork } : {}),
    updatedAt: nowSec,
  };
};

export const runEngine = (input: MixEngineInput, lite: boolean): MixEngineOutput => {
  const nowSec = toSeconds(input.now) ?? Math.floor(Date.now() / 1000);
  const tz = Number.isFinite(input.tzOffsetMinutes) ? input.tzOffsetMinutes : 0;
  const { signals, stats } = computeSignals({
    songs: input.songs,
    nowSec,
    tzOffsetMinutes: tz,
    events: input.events,
    listeningProfile: input.listeningProfile,
    tasteProfile: input.tasteProfile,
  });
  const nonce = input.regenNonce ?? 0;
  const librarySize = Math.max(signals.length, input.librarySizeHint ?? 0);
  const state: EngineState = {
    signals,
    stats,
    nowSec,
    todayKey: dayKeyFor(nowSec, tz),
    history: input.history ?? {},
    discovery: clamp01(input.discoveryIntensity, DEFAULT_DISCOVERY),
    randomness: clamp01(input.randomnessIntensity, DEFAULT_RANDOMNESS),
    weeklyBase: djb2(`weekly|${input.weeklySeed}|${nonce}`),
    dailyBase: djb2(`daily|${input.dailySeed}|${nonce}`),
    assignment: createAssignmentState(),
    recentlyAddedCutoffDays: recentlyAddedCutoff(signals),
    librarySize,
  };

  const definitions: MixDefinition[] = lite
    ? CORE_MIXES.filter((def) => LITE_KINDS.has(def.kind))
    : [...CORE_MIXES, ...buildGenreMixes(signals, stats.coldStart, librarySize), ...buildMoodMixes(signals, librarySize)];

  const daily = definitions.find((def) => def.kind === 'daily');
  if (daily) {
    reserveForDaily(state, daily);
  }
  const resolved = new Map<string, ResolvedMix>();
  for (const kind of ASSIGNMENT_ORDER) {
    for (const def of definitions) {
      if (def.kind === kind) {
        resolved.set(def.id, resolveMix(state, def));
      }
    }
  }

  const playlists: Playlist[] = [];
  const diagnostics: MixDiagnostics[] = [];
  let history = state.history;
  for (const kind of DISPLAY_ORDER) {
    for (const def of definitions) {
      if (def.kind !== kind) continue;
      const mix = resolved.get(def.id);
      if (!mix) continue;
      diagnostics.push({
        mixId: def.id,
        poolSize: mix.poolSize,
        eligible: mix.eligible,
        produced: mix.songs.length,
        ...(mix.reason ? { reason: mix.reason } : {}),
      });
      if (!def.always && !mix.songs.length) {
        continue;
      }
      playlists.push(toPlaylist(mix, nowSec));
      if (mix.songs.length) {
        history = withTodayEntry(history, def.id, state.todayKey, mix.songs.map((signal) => signal.id));
      }
    }
  }
  return { playlists, history, diagnostics };
};
