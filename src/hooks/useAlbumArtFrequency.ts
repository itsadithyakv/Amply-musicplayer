import { useEffect, useState } from 'react';
import type { Song } from '@/types/music';
import { buildAlbumArtFrequency } from '@/services/playlistArtworkService';
import { recordPerfEvent } from '@/services/perfDiagnostics';

export const useAlbumArtFrequency = (songs: Song[]) => {
  const [frequency, setFrequency] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    let alive = true;
    void buildAlbumArtFrequency(songs)
      .then((next) => {
        if (alive) {
          setFrequency(next);
        }
      })
      .catch((error) => {
        recordPerfEvent('album-art-frequency.error', { error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      alive = false;
    };
  }, [songs]);

  return frequency;
};
