import { create } from 'zustand';
import { readStorageJson, writeStorageJson } from '@/services/storageService';
import { useProStore } from '@/store/proStore';
import type { Song } from '@/types/music';

/**
 * The free library: the first FREE_SONG_LIMIT songs added stay playable; the rest are listed with
 * a lock until Amply Pro. Installs that already had a library before the limit existed keep all of
 * it (the "grant"), decided once on the first launch with this code and stored with the licence.
 */
export const FREE_SONG_LIMIT = 200;

const GRANT_PATH = 'entitlement/library_grant.json';

interface StoredGrant {
  unlimited: boolean;
  decidedAt: number;
}

/** null until the grant is read, which happens before the library is loaded. */
export const useLibraryGrant = create<{ unlimited: boolean | null }>(() => ({ unlimited: null }));

/** Reads the grant, or decides it now: an install that already had songs keeps its whole library. */
export const decideLibraryGrant = async (hadLibrary: boolean): Promise<void> => {
  const stored = await readStorageJson<StoredGrant | null>(GRANT_PATH, null);
  if (stored && typeof stored.unlimited === 'boolean') {
    useLibraryGrant.setState({ unlimited: stored.unlimited });
    return;
  }
  useLibraryGrant.setState({ unlimited: hadLibrary });
  await writeStorageJson<StoredGrant>(GRANT_PATH, { unlimited: hadLibrary, decidedAt: Math.floor(Date.now() / 1000) });
};

/** Whether every song plays: Pro, or a library from before the limit. Undecided counts as yes. */
export const isLibraryUnlimited = (): boolean => useProStore.getState().isPro || useLibraryGrant.getState().unlimited !== false;

const freeIdsCache = new WeakMap<readonly Song[], ReadonlySet<string>>();

/**
 * The songs a free library plays: the earliest added, ties broken by path, so the set does not
 * move when songs are added later or the library is rescanned.
 */
export const freeSongIds = (songs: readonly Song[], limit = FREE_SONG_LIMIT): ReadonlySet<string> => {
  if (limit === FREE_SONG_LIMIT) {
    const cached = freeIdsCache.get(songs);
    if (cached) return cached;
  }
  const ids =
    songs.length <= limit
      ? new Set(songs.map((song) => song.id))
      : new Set(
          [...songs]
            .sort((a, b) => a.addedAt - b.addedAt || a.path.localeCompare(b.path))
            .slice(0, limit)
            .map((song) => song.id),
        );
  if (limit === FREE_SONG_LIMIT) freeIdsCache.set(songs, ids);
  return ids;
};

const NO_LOCKS: ReadonlySet<string> = new Set();

/** Songs listed but not playable on this plan. */
export const lockedSongIds = (songs: readonly Song[], unlimited: boolean): ReadonlySet<string> => {
  if (unlimited || songs.length <= FREE_SONG_LIMIT) return NO_LOCKS;
  const free = freeSongIds(songs);
  return new Set(songs.filter((song) => !free.has(song.id)).map((song) => song.id));
};

/** The songs mixes and queues may use on this plan; `library` is the whole library the free set comes from. */
export const playableSongs = <T extends Song>(songs: readonly T[], library: readonly Song[] = songs): T[] => {
  if (isLibraryUnlimited() || library.length <= FREE_SONG_LIMIT) return songs as T[];
  const free = freeSongIds(library);
  return songs.filter((song) => free.has(song.id));
};
