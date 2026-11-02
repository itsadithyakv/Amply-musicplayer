import type { Song } from '@/types/music';
import { splitArtistNames } from '@/utils/artists';
import { seededShuffle } from '@/utils/random';

/**
 * Rule-based playlists (Pro): a playlist that fills itself from the library, like "Rock, played
 * more than five times, added this year". The rules are stored on the playlist; its song list is
 * recomputed as the library and listening history change.
 */

export type RuleField = 'genre' | 'artist' | 'album' | 'title' | 'year' | 'plays' | 'duration' | 'added' | 'played' | 'favorite';
export type RuleOp = 'contains' | 'notContains' | 'is' | 'isNot' | 'atLeast' | 'atMost' | 'inLast' | 'notInLast' | 'isTrue' | 'isFalse';
export type RuleSort = 'mostPlayed' | 'recentlyAdded' | 'recentlyPlayed' | 'title' | 'artist' | 'random';

export interface PlaylistRule {
  field: RuleField;
  op: RuleOp;
  /** Text, a number, or days for the date fields; unused by the favourite ops. */
  value: string;
}

export interface PlaylistRules {
  match: 'all' | 'any';
  rules: PlaylistRule[];
  sort: RuleSort;
  /** At most this many songs; null for no limit. */
  limit: number | null;
}

type FieldKind = 'text' | 'number' | 'date' | 'flag';

const FIELD_KIND: Record<RuleField, FieldKind> = {
  genre: 'text',
  artist: 'text',
  album: 'text',
  title: 'text',
  year: 'number',
  plays: 'number',
  duration: 'number',
  added: 'date',
  played: 'date',
  favorite: 'flag',
};

const KIND_OPS: Record<FieldKind, RuleOp[]> = {
  text: ['contains', 'notContains', 'is', 'isNot'],
  number: ['atLeast', 'atMost', 'is'],
  date: ['inLast', 'notInLast'],
  flag: ['isTrue', 'isFalse'],
};

export const RULE_FIELDS = Object.keys(FIELD_KIND) as RuleField[];
export const RULE_SORTS: RuleSort[] = ['mostPlayed', 'recentlyAdded', 'recentlyPlayed', 'title', 'artist', 'random'];

export const opsFor = (field: RuleField): RuleOp[] => KIND_OPS[FIELD_KIND[field]];
export const fieldKind = (field: RuleField): FieldKind => FIELD_KIND[field];

/** A sensible starting rule for `field`, used when the field of a row changes. */
export const defaultRuleFor = (field: RuleField): PlaylistRule => {
  const op = opsFor(field)[0];
  const value = field === 'plays' ? '5' : field === 'year' ? String(new Date().getFullYear()) : field === 'duration' ? '3' : FIELD_KIND[field] === 'date' ? '30' : '';
  return { field, op, value };
};

export const DEFAULT_RULES: PlaylistRules = {
  match: 'all',
  rules: [defaultRuleFor('genre')],
  sort: 'mostPlayed',
  limit: 100,
};

const DAY_SEC = 86_400;
const toSec = (value: number | undefined): number | undefined => (value === undefined ? undefined : value > 1e12 ? value / 1000 : value);
const fold = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

const textValues = (song: Song, field: RuleField): string[] => {
  switch (field) {
    case 'artist':
      return [song.artist, ...splitArtistNames(song.artist), song.albumArtist ?? ''];
    case 'genre':
      return [song.genre, ...song.genre.split(/[;,/]/)];
    case 'album':
      return [song.album];
    default:
      return [song.title];
  }
};

const numberValue = (song: Song, field: RuleField): number | undefined => {
  if (field === 'year') return song.year;
  if (field === 'plays') return song.playCount ?? 0;
  // Minutes, as the editor asks for them.
  if (field === 'duration') return song.duration / 60;
  return undefined;
};

const matchesRule = (song: Song, rule: PlaylistRule, nowSec: number): boolean => {
  const kind = FIELD_KIND[rule.field];
  if (kind === 'flag') {
    return rule.op === 'isTrue' ? Boolean(song.favorite) : !song.favorite;
  }
  if (kind === 'text') {
    const wanted = fold(rule.value);
    if (!wanted) {
      return true; // an empty text rule is unfinished, not a filter
    }
    const values = textValues(song, rule.field).map(fold).filter(Boolean);
    switch (rule.op) {
      case 'contains':
        return values.some((value) => value.includes(wanted));
      case 'notContains':
        return !values.some((value) => value.includes(wanted));
      case 'is':
        return values.some((value) => value === wanted);
      default:
        return !values.some((value) => value === wanted);
    }
  }
  const number = Number(rule.value);
  if (!Number.isFinite(number)) {
    return true;
  }
  if (kind === 'date') {
    const at = toSec(rule.field === 'added' ? song.addedAt : song.lastPlayed);
    const within = at !== undefined && at > 0 && nowSec - at <= number * DAY_SEC;
    return rule.op === 'inLast' ? within : !within;
  }
  const value = numberValue(song, rule.field);
  if (value === undefined) {
    return false;
  }
  if (rule.op === 'atLeast') return value >= number;
  if (rule.op === 'atMost') return value <= number;
  return rule.field === 'duration' ? Math.round(value) === Math.round(number) : value === number;
};

const compareBy = (sort: Exclude<RuleSort, 'random'>) => (a: Song, b: Song): number => {
  switch (sort) {
    case 'mostPlayed':
      return (b.playCount ?? 0) - (a.playCount ?? 0) || (toSec(b.lastPlayed) ?? 0) - (toSec(a.lastPlayed) ?? 0);
    case 'recentlyAdded':
      return (toSec(b.addedAt) ?? 0) - (toSec(a.addedAt) ?? 0);
    case 'recentlyPlayed':
      return (toSec(b.lastPlayed) ?? 0) - (toSec(a.lastPlayed) ?? 0);
    case 'artist':
      return a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album) || (a.track ?? 0) - (b.track ?? 0);
    default:
      return a.title.localeCompare(b.title);
  }
};

/**
 * The song ids `rules` selects from `songs`, sorted and limited. Random order is seeded by the day
 * and the playlist, so it stays put through the day instead of reshuffling on every play.
 */
export const evaluateRules = (songs: Iterable<Song>, rules: PlaylistRules, playlistId: string, now: number = Date.now()): string[] => {
  const nowSec = now / 1000;
  const active = rules.rules;
  const matched: Song[] = [];
  for (const song of songs) {
    const ok = active.length === 0
      ? true
      : rules.match === 'all'
        ? active.every((rule) => matchesRule(song, rule, nowSec))
        : active.some((rule) => matchesRule(song, rule, nowSec));
    if (ok) {
      matched.push(song);
    }
  }
  const day = Math.floor(now / (DAY_SEC * 1000));
  const ordered = rules.sort === 'random' ? seededShuffle(matched, day, `rules:${playlistId}`) : matched.sort(compareBy(rules.sort));
  const ids = ordered.map((song) => song.id);
  return rules.limit && rules.limit > 0 ? ids.slice(0, rules.limit) : ids;
};

/** Rules read back from storage or a backup, or null when they are not rules this version can run. */
export const parseRules = (raw: unknown): PlaylistRules | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const value = raw as Partial<PlaylistRules>;
  if (!Array.isArray(value.rules)) {
    return null;
  }
  const rules = value.rules.filter(
    (rule): rule is PlaylistRule =>
      Boolean(rule) &&
      typeof rule.field === 'string' &&
      rule.field in FIELD_KIND &&
      opsFor(rule.field as RuleField).includes(rule.op as RuleOp) &&
      typeof rule.value === 'string',
  );
  const limit = typeof value.limit === 'number' && Number.isFinite(value.limit) && value.limit > 0 ? Math.floor(value.limit) : null;
  return {
    match: value.match === 'any' ? 'any' : 'all',
    rules,
    sort: RULE_SORTS.includes(value.sort as RuleSort) ? (value.sort as RuleSort) : 'mostPlayed',
    limit,
  };
};
