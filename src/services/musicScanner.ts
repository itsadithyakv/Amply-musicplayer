import { invoke } from '@tauri-apps/api/core';
import type { Song } from '@/types/music';
import { buildSongId } from '@/services/metadataParser';
import { isTauri, toPlayableSrc } from '@/services/storageService';
import { getDisplayTitleRepair } from '@/utils/artists';

interface ScannedSong {
  id: string;
  path: string;
  filename: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  duration: number;
  track: number;
  year?: number;
  albumArt?: string;
  addedAt: number;
  playCount: number;
  lastPlayed?: number;
  favorite: boolean;
}

const demoSongs: Song[] = [
  {
    id: 'demo_1',
    path: 'music/demo-1.mp3',
    source: 'music/demo-1.mp3',
    filename: 'Demo Artist - Midnight Drive.mp3',
    title: 'Midnight Drive',
    artist: 'Demo Artist',
    album: 'Amply Demos',
    genre: 'Synthwave',
    duration: 212,
    track: 1,
    addedAt: Math.floor(Date.now() / 1000) - 86_400,
    playCount: 0,
    favorite: true,
  },
  {
    id: 'demo_2',
    path: 'music/demo-2.mp3',
    source: 'music/demo-2.mp3',
    filename: 'City Lights - Reflections.mp3',
    title: 'Reflections',
    artist: 'City Lights',
    album: 'Night Sessions',
    genre: 'Electronic',
    duration: 185,
    track: 2,
    addedAt: Math.floor(Date.now() / 1000) - 172_800,
    playCount: 0,
    favorite: false,
  },
];

const normalizeSong = (song: ScannedSong): Song => {
  const id = song.id || buildSongId(song.path);
  const title = song.title || 'Unknown Title';
  const repairedTitle = getDisplayTitleRepair(song.artist, title);

  return {
    ...song,
    id,
    source: toPlayableSrc(song.path),
    title: repairedTitle ?? title,
    artist: song.artist || 'Unknown Artist',
    album: song.album || 'Unknown Album',
    genre: song.genre || 'Unknown Genre',
    filename: song.filename || song.path.split(/[\\/]/).pop() || song.path,
  };
};

export const scanMusicFolder = async (folder?: string): Promise<Song[]> => {
  if (!isTauri()) {
    return demoSongs;
  }

  // Errors propagate: libraryStore.scanLibrary owns the try/catch and surfaces them as `scanError`.
  const scanned = await invoke<ScannedSong[]>('scan_music', { folder: folder?.trim() || null });
  // Artwork fetching is deferred to the idle metadata pipeline to keep scans fast.
  return scanned.map(normalizeSong);
};
