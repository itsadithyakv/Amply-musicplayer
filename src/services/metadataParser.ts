import type { Song } from '@/types/music';

const supportedExtensions = new Set(['mp3', 'mp4', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'opus', 'aif', 'aiff', 'wma', 'webm']);

export const isSupportedAudio = (path: string): boolean => {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return supportedExtensions.has(ext);
};

export const parseFileNameMetadata = (filename: string): Pick<Song, 'title' | 'artist'> => {
  const trimmed = filename.replace(/\.[^/.]+$/, '').trim();
  const [first, second] = trimmed.split(' - ').map((chunk) => chunk.trim());

  if (!second) {
    return {
      title: trimmed || 'Unknown Title',
      artist: 'Unknown Artist',
    };
  }

  return {
    artist: first || 'Unknown Artist',
    title: second || 'Unknown Title',
  };
};

export const buildSongId = (path: string): string => {
  return path.toLowerCase().replace(/[^a-z0-9]/g, '_');
};
