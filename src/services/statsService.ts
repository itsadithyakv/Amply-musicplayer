import { invoke } from '@tauri-apps/api/core';
import type { Song } from '@/types/music';
import { getPrimaryArtistName, splitArtistNames } from '@/utils/artists';
import { isTauri } from '@/services/storageService';

export interface StatsCards {
  totalListeningHours: number;
  topSongs: Song[];
  topArtists: { artist: string; count: number }[];
  topAlbums: { album: string; artist: string; count: number; albumKey: string }[];
}

const normalizeKeyPart = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

const buildAlbumKey = (artist: string, album: string): string =>
  `${normalizeKeyPart(artist)}::${normalizeKeyPart(album)}`;

const buildStatsLocal = (songs: Song[]): StatsCards => {
  const sortedByPlays = [...songs].sort((a, b) => b.playCount - a.playCount);
  const artistMap = new Map<string, number>();
  const albumMap = new Map<string, { album: string; artist: string; count: number }>();

  let listeningSeconds = 0;

  for (const song of songs) {
    listeningSeconds += song.duration * song.playCount;
    for (const artistName of splitArtistNames(song.artist)) {
      artistMap.set(artistName, (artistMap.get(artistName) ?? 0) + song.playCount);
    }
    const primaryArtist = getPrimaryArtistName(song.artist).trim();
    const key = buildAlbumKey(primaryArtist, song.album);
    const existing = albumMap.get(key);
    if (!existing) {
      albumMap.set(key, { album: song.album, artist: primaryArtist || song.artist, count: song.playCount });
    } else {
      existing.count += song.playCount;
    }
  }

  const topArtists = [...artistMap.entries()]
    .map(([artist, count]) => ({ artist, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const topAlbums = [...albumMap.entries()]
    .map(([albumKey, entry]) => ({ ...entry, albumKey }))
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
      topAlbums: { album: string; artist: string; count: number }[];
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

    const topAlbums = result.topAlbums.map((entry) => ({
      ...entry,
      albumKey: buildAlbumKey(entry.artist, entry.album),
    }));

    return {
      totalListeningHours: result.totalListeningHours,
      topSongs,
      topArtists: result.topArtists,
      topAlbums,
    };
  } catch {
    return buildStatsLocal(songs);
  }
};
