import { useEffect, useMemo } from 'react';
import { lockedSongIds, useLibraryGrant } from '@/services/libraryAccess';
import { useLibraryStore } from '@/store/libraryStore';
import { useProStore } from '@/store/proStore';

/** Whether every song plays: Pro, or a library from before the free limit. */
export const useLibraryUnlimited = (): boolean => {
  const isPro = useProStore((state) => state.isPro);
  const grant = useLibraryGrant((state) => state.unlimited);
  return isPro || grant !== false;
};

/** Songs listed but not playable on the free plan. */
export const useLockedSongIds = (): ReadonlySet<string> => {
  const songs = useLibraryStore((state) => state.songs);
  const unlimited = useLibraryUnlimited();
  return useMemo(() => lockedSongIds(songs, unlimited), [songs, unlimited]);
};

/**
 * Mixes on a capped library use only the songs it can play; when the cap lifts (Amply Pro), rebuild
 * them from the whole library.
 */
export const useRegenerateMixesOnUnlock = () => {
  useEffect(() => {
    const unlimitedNow = () => useProStore.getState().isPro || useLibraryGrant.getState().unlimited !== false;
    let was = unlimitedNow();
    const check = () => {
      const now = unlimitedNow();
      const library = useLibraryStore.getState();
      if (now && !was && library.initialized && library.songs.length) {
        void library.regenerateSmartPlaylists();
      }
      was = now;
    };
    const stopPro = useProStore.subscribe(check);
    const stopGrant = useLibraryGrant.subscribe(check);
    return () => {
      stopPro();
      stopGrant();
    };
  }, []);
};
