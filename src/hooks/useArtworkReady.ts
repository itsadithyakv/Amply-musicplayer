import { useEffect, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

export const useArtworkReady = (): boolean => {
  const libraryInitialized = useLibraryStore((state) => state.initialized);
  const libraryScanning = useLibraryStore((state) => state.isScanning);
  const playerInitialized = usePlayerStore((state) => state.initialized);

  const [readyOnce, setReadyOnce] = useState(false);
  const readyNow = libraryInitialized && playerInitialized && !libraryScanning;

  useEffect(() => {
    if (readyNow && !readyOnce) {
      setReadyOnce(true);
    }
  }, [readyNow, readyOnce]);

  return readyOnce || readyNow;
};
