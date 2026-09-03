import { useEffect, useState } from 'react';
import type { Song } from '@/types/music';
import { buildAlbumArtFrequency } from '@/services/playlistArtworkService';

export const useAlbumArtFrequency = (songs: Song[]) => {
  const [frequency, setFrequency] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    let alive = true;
    void buildAlbumArtFrequency(songs).then((next) => {
      if (alive) {
        setFrequency(next);
      }
    });
    return () => {
      alive = false;
    };
  }, [songs]);

  return frequency;
};
