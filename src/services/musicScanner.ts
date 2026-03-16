import { invoke } from '@tauri-apps/api/core';
import type { AppSettings, Song } from '@/types/music';
import { buildSongId } from '@/services/metadataParser';
import { isTauri, readStorageJson, toPlayableSrc } from '@/services/storageService';

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
  replayGain?: number;
}

const artworkCache = new Map<string, string | null>();

const normalizeArtworkUrl = (url: string): string => {
  return url.replace(/100x100bb/g, '600x600bb');
};

const fetchAlbumArt = async (artist: string, album: string): Promise<string | null> => {
  const key = `${artist.toLowerCase()}::${album.toLowerCase()}`;
  if (artworkCache.has(key)) {
    return artworkCache.get(key) ?? null;
  }

  try {
    const term = encodeURIComponent(`${artist} ${album}`.trim());
    const response = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`);
    if (!response.ok) {
      artworkCache.set(key, null);
      return null;
    }

    const payload = (await response.json()) as {
      results?: Array<{ artworkUrl100?: string }>;
    };

    const artwork = payload.results?.[0]?.artworkUrl100;
    const normalized = artwork ? normalizeArtworkUrl(artwork) : null;
    artworkCache.set(key, normalized);
    return normalized;
  } catch {
    artworkCache.set(key, null);
    return null;
  }
};

const enrichMissingArtwork = async (songs: Song[]): Promise<Song[]> => {
  const maxArtworkFetches = 120;
  let fetched = 0;

  const enriched: Song[] = [];
  for (const song of songs) {
    if (song.albumArt || fetched >= maxArtworkFetches) {
      enriched.push(song);
      continue;
    }

    const artwork = await fetchAlbumArt(song.artist, song.album);
    fetched += 1;
    enriched.push({
      ...song,
      albumArt: artwork ?? song.albumArt,
    });
  }

  return enriched;
};

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

  return {
    ...song,
    id,
    source: toPlayableSrc(song.path),
    title: song.title || 'Unknown Title',
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

  try {
    const scanned = await invoke<ScannedSong[]>('scan_music', { folder: folder?.trim() || null });
    const normalized = scanned.map(normalizeSong);
    const settings = await readStorageJson<Partial<AppSettings>>('settings.json', {});
    if (settings.gameMode) {
      return normalized;
    }
    return enrichMissingArtwork(normalized);
  } catch {
    return [];
  }
};
