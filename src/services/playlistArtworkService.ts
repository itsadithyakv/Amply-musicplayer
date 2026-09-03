import { invoke } from '@tauri-apps/api/core';
import type { Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';
import { isTauri } from '@/services/storageService';

const hash = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const buildAlbumArtFrequencyLocal = (songs: Song[]): Map<string, number> => {
  const freq = new Map<string, number>();
  for (const song of songs) {
    const art = song.albumArt;
    if (!art) {
      continue;
    }
    freq.set(art, (freq.get(art) ?? 0) + 1);
  }
  return freq;
};

export const buildAlbumArtFrequency = async (songs: Song[]): Promise<Map<string, number>> => {
  if (!isTauri()) {
    return buildAlbumArtFrequencyLocal(songs);
  }

  try {
    const result = await invoke<Array<{ art: string; count: number }>>('build_album_art_frequency_rust', {
      songs: songs.map((song) => ({
        id: song.id,
        artist: song.artist,
        album: song.album ?? null,
        albumArt: song.albumArt ?? null,
        track: song.track ?? null,
        favorite: Boolean(song.favorite),
      })),
    });
    const freq = new Map<string, number>();
    for (const entry of result) {
      if (!entry.art) {
        continue;
      }
      freq.set(entry.art, entry.count);
    }
    return freq;
  } catch {
    return buildAlbumArtFrequencyLocal(songs);
  }
};

const albumKeyFor = (song: Song): string => {
  const artist = getPrimaryArtistName(song.artist).toLowerCase();
  const album = song.album?.trim().toLowerCase() ?? '';
  return `${artist}::${album}`;
};

export const buildArtworkSet = (
  songs: Song[],
  freq: Map<string, number>,
  desired = 4,
  preferredArt?: string,
): string[] => {
  const candidates = songs
    .filter((song) => Boolean(song.albumArt))
    .map((song) => {
      const art = song.albumArt!;
      const frequency = freq.get(art) ?? 0;
      const trackPenalty = song.track === 1 ? -18 : 0;
      const albumBonus = song.album ? 2 : 0;
      const favoriteBonus = song.favorite ? 3 : 0;
      const diversityBoost = (hash(`${song.id}:${art}`) % 7) - 3;
      return {
        art,
        albumKey: albumKeyFor(song),
        score: 100 - frequency * 2 + trackPenalty + albumBonus + favoriteBonus + diversityBoost,
      };
    })
    .sort((a, b) => b.score - a.score);

  const seenArt = new Set<string>();
  const seenAlbum = new Set<string>();
  const picked: string[] = [];

  if (preferredArt) {
    picked.push(preferredArt);
    seenArt.add(preferredArt);
    const preferredEntry = candidates.find((entry) => entry.art === preferredArt);
    if (preferredEntry) {
      seenAlbum.add(preferredEntry.albumKey);
    }
  }

  for (const entry of candidates) {
    if (seenArt.has(entry.art)) {
      continue;
    }
    if (seenAlbum.has(entry.albumKey) && candidates.length > desired * 2) {
      continue;
    }
    seenArt.add(entry.art);
    seenAlbum.add(entry.albumKey);
    picked.push(entry.art);
    if (picked.length >= desired) {
      break;
    }
  }

  if (picked.length < desired && candidates.length) {
    for (const entry of candidates) {
      if (seenArt.has(entry.art)) {
        continue;
      }
      seenArt.add(entry.art);
      picked.push(entry.art);
      if (picked.length >= desired) {
        break;
      }
    }
  }

  return picked;
};

export const pickPlaylistArtwork = (songs: Song[], freq: Map<string, number>): string | undefined => {
  const set = buildArtworkSet(songs, freq, 1);
  return set[0];
};
