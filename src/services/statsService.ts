import type { Song } from '@/types/music';
import { splitArtistNames } from '@/utils/artists';

export interface StatsCards {
  totalListeningHours: number;
  topSongs: Song[];
  topArtists: { artist: string; count: number }[];
  topAlbums: { album: string; count: number }[];
}

export const buildStats = (songs: Song[]): StatsCards => {
  const sortedByPlays = [...songs].sort((a, b) => b.playCount - a.playCount);
  const artistMap = new Map<string, number>();
  const albumMap = new Map<string, number>();

  let listeningSeconds = 0;

  for (const song of songs) {
    listeningSeconds += song.duration * song.playCount;
    for (const artistName of splitArtistNames(song.artist)) {
      artistMap.set(artistName, (artistMap.get(artistName) ?? 0) + song.playCount);
    }
    albumMap.set(song.album, (albumMap.get(song.album) ?? 0) + song.playCount);
  }

  const topArtists = [...artistMap.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topAlbums = [...albumMap.entries()]
    .map(([album, count]) => ({ album, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    totalListeningHours: Math.round((listeningSeconds / 3600) * 10) / 10,
    topSongs: sortedByPlays.slice(0, 10),
    topArtists,
    topAlbums,
  };
};
