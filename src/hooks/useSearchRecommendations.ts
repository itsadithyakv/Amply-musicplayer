import { useEffect, useMemo, useState } from 'react';
import { loadOnlineRecommendationSignals } from '@/services/onlineRecommendationService';
import type { OnlineRecommendationSignalsBySong } from '@/services/recommendationIndex';
import { getSearchRecommendations, type SearchRecommendations } from '@/services/searchRecommendations';
import { useLibraryStore } from '@/store/libraryStore';
import type { Song } from '@/types/music';

const EMPTY_SIGNALS: OnlineRecommendationSignalsBySong = {};

/**
 * Recommendations for the Search page: seeded by listening history when the query is empty,
 * by the current results otherwise. Online signals are read from the local cache and refreshed
 * whenever the enrichment worker reports new ones.
 */
export const useSearchRecommendations = (
  librarySongs: Song[],
  query: string,
  results: Song[],
): SearchRecommendations | null => {
  const onlineSignalsVersion = useLibraryStore((state) => state.onlineSignalsVersion);
  const [signals, setSignals] = useState<OnlineRecommendationSignalsBySong>(EMPTY_SIGNALS);

  useEffect(() => {
    let alive = true;
    loadOnlineRecommendationSignals()
      .then((loaded) => {
        if (alive) {
          setSignals(loaded);
        }
      })
      .catch(() => {
        /* cache unavailable: recommendations fall back to local affinity */
      });
    return () => {
      alive = false;
    };
  }, [onlineSignalsVersion]);

  return useMemo(
    () => getSearchRecommendations(librarySongs, query, results, signals),
    [librarySongs, query, results, signals],
  );
};
