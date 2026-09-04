import { DAY_SEC } from './signals';
import type { MixHistory, MixHistoryEntry } from './types';

export const HISTORY_LIMIT = 14;

const pad = (value: number): string => String(value).padStart(2, '0');

/** Local calendar day ("2026-09-04") for a unix-second instant and a `getTimezoneOffset()` value. */
export const dayKeyFor = (nowSec: number, tzOffsetMinutes: number): string => {
  const local = new Date((nowSec - tzOffsetMinutes * 60) * 1000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
};

/** Days since the epoch for a day key; NaN for malformed keys. */
export const dayNumber = (dayKey: string): number => {
  const [year, month, day] = dayKey.split('-').map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return Number.NaN;
  }
  return Math.floor(Date.UTC(year, month - 1, day) / (DAY_SEC * 1000));
};

const entriesFor = (history: MixHistory | undefined, mixId: string): MixHistoryEntry[] =>
  history?.[mixId]?.filter((entry) => entry && typeof entry.dayKey === 'string' && Array.isArray(entry.songIds)) ?? [];

/** The most recent entry strictly before `todayKey` (what the user saw "yesterday"). */
export const previousEntry = (
  history: MixHistory | undefined,
  mixId: string,
  todayKey: string,
): MixHistoryEntry | undefined => {
  const today = dayNumber(todayKey);
  let best: MixHistoryEntry | undefined;
  let bestDay = Number.NEGATIVE_INFINITY;
  for (const entry of entriesFor(history, mixId)) {
    const day = dayNumber(entry.dayKey);
    if (!Number.isFinite(day) || day >= today) {
      continue;
    }
    if (day > bestDay) {
      bestDay = day;
      best = entry;
    }
  }
  return best;
};

/** Song ids a mix surfaced within the last `days` days (today excluded). */
export const idsWithinDays = (
  history: MixHistory | undefined,
  mixId: string,
  todayKey: string,
  days: number,
): Set<string> => {
  const today = dayNumber(todayKey);
  const ids = new Set<string>();
  for (const entry of entriesFor(history, mixId)) {
    const day = dayNumber(entry.dayKey);
    if (!Number.isFinite(day) || day >= today || today - day > days) {
      continue;
    }
    for (const id of entry.songIds) ids.add(id);
  }
  return ids;
};

/** Prepend today's entry (replacing an existing one for today) and trim to `HISTORY_LIMIT`. */
export const withTodayEntry = (
  history: MixHistory,
  mixId: string,
  todayKey: string,
  songIds: readonly string[],
): MixHistory => {
  const rest = entriesFor(history, mixId).filter((entry) => entry.dayKey !== todayKey);
  rest.sort((a, b) => dayNumber(b.dayKey) - dayNumber(a.dayKey));
  return {
    ...history,
    [mixId]: [{ dayKey: todayKey, songIds: [...songIds] }, ...rest].slice(0, HISTORY_LIMIT),
  };
};
