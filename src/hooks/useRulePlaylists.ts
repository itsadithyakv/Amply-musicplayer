import { useEffect } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { useProStore } from '@/store/proStore';

/** Long enough that a burst of plays or a scan settles into one refresh. */
const REFRESH_DELAY_MS = 3000;

/**
 * Keeps rule-based playlists in step with the library and listening history. Pro only: without
 * it, the playlists keep the songs they last had.
 */
export const useRulePlaylists = () => {
  useEffect(() => {
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
      }
      timer = window.setTimeout(() => {
        timer = null;
        if (useProStore.getState().isPro && useLibraryStore.getState().initialized) {
          void useLibraryStore.getState().refreshRulePlaylists();
        }
      }, REFRESH_DELAY_MS);
    };
    const stopLibrary = useLibraryStore.subscribe((state, previous) => {
      if (
        state.initialized !== previous.initialized ||
        state.libraryVersion !== previous.libraryVersion ||
        state.activityVersion !== previous.activityVersion
      ) {
        schedule();
      }
    });
    const stopPro = useProStore.subscribe((state, previous) => {
      if (state.isPro && !previous.isPro) {
        schedule();
      }
    });
    schedule();
    return () => {
      stopLibrary();
      stopPro();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);
};
