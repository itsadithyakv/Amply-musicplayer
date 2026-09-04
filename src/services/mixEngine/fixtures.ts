import type { Song } from '@/types/music';
import { mulberry32 } from '@/utils/random';
import type { ListeningEvent, MixEngineInput } from './types';

export const DAY = 86_400;
/** 2026-09-04 12:00 UTC, unix seconds. */
export const NOW = Math.floor(Date.UTC(2026, 8, 4, 12, 0, 0) / 1000);
export const TZ = -330; // IST, as returned by getTimezoneOffset()

export const RAW_GENRES = [
  'Pop',
  'Alt-Country',
  'Warehouse Techno',
  'Melodic Death Metal',
  'Unknown Genre',
  'Indie Rock',
  'Hip-Hop',
  'Jazz',
  'Ambient',
  'Classical',
  'Folk',
  'R&B',
] as const;

const TITLE_WORDS = [
  'Sun',
  'Night',
  'Road',
  'Heart',
  'Glow',
  'River',
  'Focus',
  'Party',
  'Alone',
  'Morning',
  'Run',
  'Dream',
  'Stone',
  'Window',
  'Echo',
  'Harbour',
];

export interface LibraryOptions {
  songs?: number;
  artists?: number;
  albumsPerArtist?: number;
  coldStart?: boolean;
  /** Empty genre tags everywhere. */
  untagged?: boolean;
  seed?: number;
  withEvents?: boolean;
}

export interface SyntheticLibrary {
  songs: Song[];
  events: ListeningEvent[];
}

/**
 * Deterministic ~600 song library: 40 artists x 3 albums, 12 raw genre strings, years 1970-2024
 * and a mixed play history (never played, heavy rotation, long-forgotten, favourites, new adds).
 */
export const buildLibrary = (options: LibraryOptions = {}): SyntheticLibrary => {
  const total = options.songs ?? 600;
  const artistCount = options.artists ?? 40;
  const albumsPerArtist = options.albumsPerArtist ?? 3;
  const rng = mulberry32(options.seed ?? 7);
  const songs: Song[] = [];
  const events: ListeningEvent[] = [];

  for (let i = 0; i < total; i += 1) {
    const artistIndex = i % artistCount;
    const albumIndex = Math.floor(i / artistCount) % albumsPerArtist;
    const genre = options.untagged ? '' : RAW_GENRES[artistIndex % RAW_GENRES.length];
    const year = 1970 + Math.floor(rng() * 55);
    const duration = 90 + Math.floor(rng() * 510);
    const daysSinceAdded = Math.floor(rng() * 400);
    const roll = rng();

    let playCount = 0;
    let lastPlayed: number | undefined;
    if (!options.coldStart) {
      if (roll < 0.4) {
        playCount = 0;
      } else if (roll < 0.55) {
        // Heavy rotation: many recent plays.
        playCount = 20 + Math.floor(rng() * 40);
        lastPlayed = NOW - Math.floor(rng() * 5 * DAY);
      } else if (roll < 0.75) {
        // Casual recent listening.
        playCount = 1 + Math.floor(rng() * 4);
        lastPlayed = NOW - Math.floor(rng() * 30 * DAY);
      } else {
        // Long forgotten.
        playCount = 1 + Math.floor(rng() * 12);
        lastPlayed = NOW - (50 + Math.floor(rng() * 300)) * DAY;
      }
      if (lastPlayed !== undefined && daysSinceAdded * DAY < NOW - lastPlayed) {
        lastPlayed = NOW - Math.floor(daysSinceAdded * DAY * rng());
      }
    }
    const favorite = !options.coldStart && rng() < 0.15;
    const title = `${TITLE_WORDS[Math.floor(rng() * TITLE_WORDS.length)]} ${i}`;
    const id = `song-${i}`;
    songs.push({
      id,
      path: `D:/music/artist-${artistIndex}/album-${albumIndex}/${i}.mp3`,
      source: 'local',
      filename: `${i}.mp3`,
      title,
      artist: `Artist ${artistIndex}`,
      album: `Album ${artistIndex}-${albumIndex}`,
      genre,
      duration,
      track: (i % 12) + 1,
      year,
      albumArt: `amplyart://album-${artistIndex}-${albumIndex}.jpg`,
      addedAt: NOW - daysSinceAdded * DAY,
      playCount,
      lastPlayed,
      favorite,
      skipCount: playCount > 0 && rng() < 0.2 ? Math.floor(rng() * 3) : 0,
      totalPlaySeconds: playCount > 0 ? Math.floor(playCount * duration * (0.5 + rng())) : 0,
    });

    if (options.withEvents && playCount > 0 && lastPlayed !== undefined) {
      const eventCount = Math.min(playCount, 8);
      for (let e = 0; e < eventCount; e += 1) {
        const at = lastPlayed - Math.floor(rng() * 20 * DAY * (e === 0 ? 0 : 1));
        events.push({ songId: id, at: at * 1000, listenedRatio: 0.6 + rng() * 0.4, skipped: rng() < 0.1 });
      }
    }
  }
  return { songs, events };
};

/** A library where one album by one artist is 60% of every song. */
export const buildDominatedLibrary = (): Song[] => {
  const base = buildLibrary({ songs: 200, artists: 20, albumsPerArtist: 2, seed: 11 }).songs;
  return base.map((song, index) => {
    if (index % 5 === 0 || index % 5 === 1) {
      return song;
    }
    return {
      ...song,
      artist: 'Mega Artist',
      album: 'The One Album',
      albumArt: 'amplyart://mega.jpg',
      path: `D:/music/mega/${index}.mp3`,
      genre: 'Pop',
    };
  });
};

export const baseInput = (songs: Song[], overrides: Partial<MixEngineInput> = {}): MixEngineInput => ({
  songs,
  now: NOW,
  tzOffsetMinutes: TZ,
  weeklySeed: 202636,
  dailySeed: 20260904,
  ...overrides,
});
