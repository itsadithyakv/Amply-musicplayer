import { useMemo } from 'react';
import type { Song } from '@/types/music';
import { buildAlbumArtFrequency } from '@/services/playlistArtworkService';

/**
 * Counts how many songs share each artwork URL. Synchronous and memoised on the songs array
 * identity, so callers must pass a stable reference (a snapshot getter or a module-level empty
 * array) rather than a fresh literal per render.
 */
export const useAlbumArtFrequency = (songs: Song[]): Map<string, number> =>
  useMemo(() => buildAlbumArtFrequency(songs), [songs]);
