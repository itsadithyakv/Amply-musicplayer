import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

export const useArtworkReady = (): boolean => {
  const libraryInitialized = useLibraryStore((state) => state.initialized);
  const playerInitialized = usePlayerStore((state) => state.initialized);

  const [readyOnce, setReadyOnce] = useState(false);
  const readyNow = libraryInitialized && playerInitialized;

  useEffect(() => {
    if (readyNow && !readyOnce) {
      setReadyOnce(true);
    }
  }, [readyNow, readyOnce]);

  return readyOnce || readyNow;
};
