import { invoke } from '@tauri-apps/api/core';
import type { ListeningProfile, Playlist, Song } from '@/types/music';
import { isTauri } from '@/services/storageService';

type RustPlaylist = {
  id: string;
  name: string;
  description: string;
  type: Playlist['type'];
  songIds: string[];
  artwork?: string | null;
  updatedAt: number;
};

const toRustSong = (song: Song) => ({
  id: song.id,
  title: song.title,
  artist: song.artist,
  album: song.album,
  genre: song.genre,
  duration: song.duration,
  track: song.track ?? 0,
  addedAt: song.addedAt,
  playCount: song.playCount ?? 0,
  lastPlayed: song.lastPlayed ?? null,
  favorite: song.favorite ?? false,
  albumArt: song.albumArt ?? null,
  skipCount: song.skipCount ?? 0,
  totalPlaySeconds: song.totalPlaySeconds ?? 0,
  manualQueueAdds: song.manualQueueAdds ?? 0,
  loudnessLufs: song.loudnessLufs ?? null,
});

export const generateSmartPlaylistsRust = async (
  songs: Song[],
  options: {
    seed?: number;
    dailySeed?: number;
    profile?: ListeningProfile;
    discoveryIntensity?: number;
    randomnessIntensity?: number;
    lite?: boolean;
  } = {},
): Promise<RustPlaylist[] | null> => {
  if (!isTauri()) {
    return null;
  }
  try {
    const payload = await invoke<RustPlaylist[]>('generate_smart_playlists_rust', {
      songs: songs.map(toRustSong),
      seed: options.seed ?? null,
      dailySeed: options.dailySeed ?? null,
      profile: options.profile ?? null,
      discoveryIntensity: options.discoveryIntensity ?? null,
      randomnessIntensity: options.randomnessIntensity ?? null,
      lite: options.lite ?? false,
    });
    return payload;
  } catch {
    return null;
  }
};
