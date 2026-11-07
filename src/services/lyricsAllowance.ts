import { useEffect } from 'react';
import { create } from 'zustand';
import { readPreference, writePreference } from '@/services/preferences';
import { useProStore } from '@/store/proStore';

/**
 * Free installs show lyrics for FREE_LYRICS_PER_DAY different songs a day. Opening the same song
 * again that day does not count, and the count starts over at local midnight. Looking lyrics up
 * and caching them is never limited, only showing them.
 */
export const FREE_LYRICS_PER_DAY = 10;

export const LYRICS_SHOWN_KEY = 'lyrics.shown';

interface ShownToday {
  day: string;
  ids: string[];
}

export const localDay = (now = new Date()): string =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const anyString = (value: string): value is string => typeof value === 'string';

const readShown = (today: string): ShownToday => {
  try {
    const parsed = JSON.parse(readPreference(LYRICS_SHOWN_KEY, anyString, '{}')) as Partial<ShownToday>;
    if (parsed.day === today && Array.isArray(parsed.ids)) {
      return { day: today, ids: parsed.ids.filter((id): id is string => typeof id === 'string') };
    }
  } catch {
    // A damaged entry starts the day over.
  }
  return { day: today, ids: [] };
};

const useShownToday = create<ShownToday>(() => readShown(localDay()));

const current = (): ShownToday => {
  const today = localDay();
  const state = useShownToday.getState();
  if (state.day === today) return state;
  const fresh = readShown(today);
  useShownToday.setState(fresh, true);
  return fresh;
};

/** Whether `songId`'s lyrics may be shown today, before counting it. */
export const canShowLyrics = (songId: string, isPro: boolean, shown: ShownToday = current()): boolean =>
  isPro || shown.ids.includes(songId) || shown.ids.length < FREE_LYRICS_PER_DAY;

const recordShown = (songId: string): void => {
  const shown = current();
  if (shown.ids.includes(songId) || shown.ids.length >= FREE_LYRICS_PER_DAY) return;
  const next = { day: shown.day, ids: [...shown.ids, songId] };
  useShownToday.setState(next, true);
  writePreference(LYRICS_SHOWN_KEY, JSON.stringify(next));
};

/**
 * For the lyrics view: whether this song's lyrics may show, and how many more songs may today.
 * A song is counted once its lyrics are actually on screen (`hasLyrics`).
 */
export const useLyricsAllowance = (songId: string | null, hasLyrics: boolean): { allowed: boolean; left: number } => {
  const isPro = useProStore((state) => state.isPro);
  const shown = useShownToday();
  // Past midnight the stored day is stale and counts as an empty one; recordShown rolls it over.
  const todayKey = localDay();
  const today = shown.day === todayKey ? shown : { day: todayKey, ids: [] };
  const allowed = !songId || canShowLyrics(songId, isPro, today);

  useEffect(() => {
    if (songId && hasLyrics && allowed && !isPro) recordShown(songId);
  }, [songId, hasLyrics, allowed, isPro]);

  return { allowed, left: isPro ? Infinity : Math.max(0, FREE_LYRICS_PER_DAY - today.ids.length) };
};
