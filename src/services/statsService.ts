import { invoke } from '@tauri-apps/api/core';
import type { Song } from '@/types/music';
import { splitArtistNames } from '@/utils/artists';
import { isTauri } from '@/services/storageService';

interface StatsCards {
  totalListeningHours: number;
  topSongs: Song[];
  topArtists: { artist: string; count: number }[];
  topAlbums: { album: string; count: number }[];
}

const buildStatsLocal = (songs: Song[]): StatsCards => {
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

export const buildStats = async (songs: Song[]): Promise<StatsCards> => {
  if (!isTauri()) {
    return buildStatsLocal(songs);
  }

  try {
    const result = await invoke<{
      totalListeningHours: number;
      topSongIds: string[];
      topArtists: { artist: string; count: number }[];
      topAlbums: { album: string; count: number }[];
    }>('build_stats_rust', {
      songs: songs.map((song) => ({
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        duration: song.duration,
        playCount: song.playCount,
      })),
    });

    const songMap = new Map(songs.map((song) => [song.id, song]));
    const topSongs = result.topSongIds
      .map((id) => songMap.get(id))
      .filter((entry): entry is Song => Boolean(entry));

    return {
      totalListeningHours: result.totalListeningHours,
      topSongs,
      topArtists: result.topArtists,
      topAlbums: result.topAlbums,
    };
  } catch {
    return buildStatsLocal(songs);
  }
};
