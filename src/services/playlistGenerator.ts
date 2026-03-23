import type { Playlist, Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';
import {
  getAlbumTracklistKey,
  normalizeTrackTitle,
  type AlbumTracklistCache,
} from '@/services/albumTracklistService';

const byPlayCount = (a: Song, b: Song) => b.playCount - a.playCount;

const hash = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const getIsoWeek = (date: Date): { year: number; week: number } => {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
};

const weeklySeed = (): number => {
  const { year, week } = getIsoWeek(new Date());
  return Number(`${year}${String(week).padStart(2, '0')}`);
};

const dailySeed = (): number => {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return Number(`${year}${month}${day}`);
};

const weeklyShuffle = (songs: Song[], seed: number): Song[] => {
  return [...songs].sort((a, b) => {
    const scoreA = hash(`${a.id}:${seed}`);
    const scoreB = hash(`${b.id}:${seed}`);
    return scoreA - scoreB;
  });
};

const sortAlbumTracks = (songs: Song[]): Song[] => {
  return [...songs].sort((a, b) => {
    const titleCmp = a.title.localeCompare(b.title);
    if (titleCmp !== 0) {
      return titleCmp;
    }
    return a.filename.localeCompare(b.filename);
  });
};

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const normalizeGenreBucket = (genreRaw: string): string | null => {
  const genre = genreRaw.trim().toLowerCase();
  if (!genre || genre === 'unknown genre') {
    return null;
  }

  const rules: Array<{ label: string; keywords: string[] }> = [
    { label: 'Pop', keywords: ['pop', 'k-pop', 'kpop'] },
    { label: 'Rock', keywords: ['rock', 'alt', 'alternative', 'punk', 'grunge'] },
    { label: 'Hip-Hop', keywords: ['hip hop', 'hip-hop', 'rap', 'trap'] },
    { label: 'Electronic', keywords: ['electronic', 'edm', 'dance', 'house', 'techno', 'trance', 'dubstep'] },
    { label: 'R&B', keywords: ['r&b', 'soul', 'neo soul'] },
    { label: 'Indie', keywords: ['indie', 'lofi', 'lo-fi'] },
    { label: 'Jazz', keywords: ['jazz', 'swing', 'bebop'] },
    { label: 'Classical', keywords: ['classical', 'orchestral', 'symphony'] },
    { label: 'Country', keywords: ['country', 'americana'] },
    { label: 'Latin', keywords: ['latin', 'reggaeton', 'salsa', 'bachata'] },
    { label: 'World', keywords: ['world', 'bollywood', 'hindi', 'indian', 'afro', 'afrobeat'] },
  ];

  for (const rule of rules) {
    if (rule.keywords.some((keyword) => genre.includes(keyword))) {
      return rule.label;
    }
  }

  return null;
};

const interleaveByGenre = (songs: Song[]): Song[] => {
  const buckets = new Map<string, Song[]>();
  songs.forEach((song) => {
    const genre = song.genre || 'Unknown Genre';
    const list = buckets.get(genre) ?? [];
    list.push(song);
    buckets.set(genre, list);
  });

  const genres = [...buckets.keys()];
  const result: Song[] = [];

  while (genres.length) {
    for (let i = genres.length - 1; i >= 0; i -= 1) {
      const genre = genres[i];
      const bucket = buckets.get(genre);
      if (!bucket?.length) {
        genres.splice(i, 1);
        continue;
      }
      result.push(bucket.shift()!);
      if (!bucket.length) {
        genres.splice(i, 1);
      }
    }
  }

  return result;
};

const pickDailyMix = (songs: Song[], seed: number): Song[] => {
  const shuffled = weeklyShuffle(songs, seed);

  const recentThreshold = Math.floor(Date.now() / 1000) - 3 * 24 * 60 * 60;
  const nonRecent = shuffled.filter((song) => !song.lastPlayed || song.lastPlayed < recentThreshold);
  const favorites = nonRecent.filter((song) => song.favorite);
  const mixed = interleaveByGenre(nonRecent);

  return [...favorites.slice(0, 8), ...mixed].slice(0, 60);
};

const pickOnRepeat = (songs: Song[]): Song[] => {
  const now = Math.floor(Date.now() / 1000);
  const threshold = now - 5 * 24 * 60 * 60;

  return songs
    .filter((song) => (song.lastPlayed ?? 0) >= threshold && song.playCount > 0)
    .sort((a, b) => {
      if (b.playCount !== a.playCount) {
        return b.playCount - a.playCount;
      }
      return (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0);
    })
    .slice(0, 80);
};

const buildGenreMixes = (songs: Song[]): Playlist[] => {
  const byGenre = new Map<string, Song[]>();

  for (const song of songs) {
    const bucket = normalizeGenreBucket(song.genre);
    if (!bucket) {
      continue;
    }

    const list = byGenre.get(bucket) ?? [];
    list.push(song);
    byGenre.set(bucket, list);
  }

  const rankedGenres = [...byGenre.entries()]
    .map(([genre, genreSongs]) => ({
      genre,
      genreSongs: [...genreSongs].sort((a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
      totalPlays: genreSongs.reduce((total, song) => total + song.playCount, 0),
    }))
    .filter((entry) => entry.genreSongs.length >= 1)
    .sort((a, b) => b.totalPlays - a.totalPlays || b.genreSongs.length - a.genreSongs.length)
    .slice(0, 6);

  return rankedGenres.map((entry) =>
    mapPlaylist(
      `smart_genre_mix_${slugify(entry.genre)}`,
      `${entry.genre} Mix`,
      `Mix based on your ${entry.genre} tracks.`,
      entry.genreSongs.slice(0, 80),
      'smart',
    ),
  );
};

const buildMoodMixes = (songs: Song[]): Playlist[] => {
  const moods = [
    {
      id: 'happy',
      name: 'Happy Mix',
      description: 'Upbeat songs to lift the mood.',
      genreHints: ['pop', 'dance', 'disco', 'funk', 'edm', 'electronic'],
      titleHints: ['happy', 'joy', 'smile', 'sun', 'bright', 'good'],
    },
    {
      id: 'sad',
      name: 'Sad Mix',
      description: 'Slower, mellow tracks for quieter moments.',
      genreHints: ['acoustic', 'ballad', 'ambient', 'lofi', 'lo-fi', 'piano'],
      titleHints: ['sad', 'cry', 'alone', 'lonely', 'tears', 'heart'],
    },
    {
      id: 'party',
      name: 'Party Mix',
      description: 'High-energy tracks for late-night sessions.',
      genreHints: ['dance', 'edm', 'club', 'house', 'hip hop', 'hip-hop', 'rap', 'reggaeton'],
      titleHints: ['party', 'club', 'dance', 'night', 'mix'],
    },
    {
      id: 'main_character',
      name: 'Main Character Vibes',
      description: 'Big energy and cinematic feel-good tracks.',
      genreHints: ['pop', 'indie', 'electronic', 'rock'],
      titleHints: ['vibes', 'glow', 'shine', 'star', 'dream', 'hero'],
    },
    {
      id: 'chill',
      name: 'Chill Mix',
      description: 'Laid-back tracks for winding down.',
      genreHints: ['chill', 'ambient', 'lofi', 'lo-fi', 'acoustic', 'indie'],
      titleHints: ['chill', 'slow', 'late', 'night', 'blue'],
    },
    {
      id: 'focus',
      name: 'Focus Mix',
      description: 'Steady, low-distraction tracks for deep work.',
      genreHints: ['instrumental', 'ambient', 'piano', 'classical', 'lofi', 'lo-fi'],
      titleHints: ['focus', 'study', 'work', 'concentration', 'calm'],
    },
    {
      id: 'workout',
      name: 'Workout Mix',
      description: 'High-intensity tracks to keep you moving.',
      genreHints: ['edm', 'electronic', 'rock', 'hip hop', 'hip-hop', 'metal'],
      titleHints: ['run', 'burn', 'power', 'move', 'energy'],
    },
    {
      id: 'late_night',
      name: 'Late Night Mix',
      description: 'Low-light listening for winding down.',
      genreHints: ['ambient', 'lofi', 'lo-fi', 'chill', 'soul', 'r&b'],
      titleHints: ['night', 'midnight', 'moon', 'late', 'after dark', 'dream'],
    },
    {
      id: 'road_trip',
      name: 'Road Trip Mix',
      description: 'Open-road anthems and sing-alongs.',
      genreHints: ['rock', 'pop', 'country', 'indie'],
      titleHints: ['road', 'drive', 'highway', 'trip', 'ride'],
    },
    {
      id: 'morning_boost',
      name: 'Morning Boost',
      description: 'Bright, upbeat tracks to start the day.',
      genreHints: ['pop', 'dance', 'funk', 'disco', 'electronic'],
      titleHints: ['morning', 'sun', 'rise', 'wake', 'bright', 'good'],
    },
    {
      id: 'acoustic',
      name: 'Acoustic Mix',
      description: 'Unplugged and mellow acoustic tracks.',
      genreHints: ['acoustic', 'folk', 'singer-songwriter', 'indie'],
      titleHints: ['acoustic', 'unplugged', 'stripped'],
    },
    {
      id: 'instrumental',
      name: 'Instrumental Focus',
      description: 'Instrumental picks for focus and flow.',
      genreHints: ['instrumental', 'classical', 'piano', 'ambient', 'lofi', 'lo-fi'],
      titleHints: ['instrumental', 'piano', 'study', 'focus'],
    },
  ];

  const scoredMixes = moods.map((mood) => {
    const scored = songs
      .map((song) => {
        const genre = song.genre?.toLowerCase() ?? '';
        const title = song.title?.toLowerCase() ?? '';
        let score = 0;

        if (mood.genreHints.some((hint) => genre.includes(hint))) {
          score += 3;
        }

        if (mood.titleHints.some((hint) => title.includes(hint))) {
          score += 2;
        }

        if (song.favorite) {
          score += 1;
        }

        return { song, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || b.song.playCount - a.song.playCount)
      .map((entry) => entry.song)
      .slice(0, 80);

    return { mood, songs: scored };
  });

  return scoredMixes
    .filter((entry) => entry.songs.length > 0)
    .map((entry) =>
      mapPlaylist(
        `smart_${entry.mood.id}_mix`,
        entry.mood.name,
        entry.mood.description,
        entry.songs,
        'smart',
      ),
    );
};

const mapPlaylist = (
  id: string,
  name: string,
  description: string,
  songs: Song[],
  type: Playlist['type'] = 'smart',
): Playlist => ({
  id,
  name,
  type,
  description,
  songIds: songs.map((song) => song.id),
  updatedAt: Math.floor(Date.now() / 1000),
});

export const generateSmartPlaylists = (
  songs: Song[],
  overrides: Record<string, string[]> = {},
  seedOverride?: number,
  albumTracklistCache?: AlbumTracklistCache,
  dailyMixOverride?: Song[],
  dailySeedOverride?: number,
): Playlist[] => {
  const now = Math.floor(Date.now() / 1000);
  const seed = seedOverride ?? weeklySeed();
  const dailySeedValue = dailySeedOverride ?? dailySeed();
  const recentlyAdded = [...songs].sort((a, b) => b.addedAt - a.addedAt).slice(0, 100);
  const mostPlayed = [...songs].sort(byPlayCount).slice(0, 100);
  const rediscoverCutoff = now - 60 * 24 * 60 * 60;
  const rediscover = songs
    .filter((song) => !song.lastPlayed || song.lastPlayed < rediscoverCutoff)
    .sort((a, b) => (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0))
    .slice(0, 100);
  const favorites = songs.filter((song) => song.favorite).sort(byPlayCount);
  const recentlyPlayed = [...songs].filter((song) => song.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)).slice(0, 100);
  const dailyMix = dailyMixOverride ?? pickDailyMix(songs, dailySeedValue);
  const onRepeat = pickOnRepeat(songs);
  const genreMixes = buildGenreMixes(songs);
  const moodMixes = buildMoodMixes(songs);
  const quickHits = songs.filter((song) => song.duration > 0 && song.duration <= 180).sort(byPlayCount).slice(0, 100);
  const longSessions = songs.filter((song) => song.duration >= 360).sort(byPlayCount).slice(0, 100);
  const deepCuts = songs
    .filter((song) => song.playCount <= 1 && song.addedAt < now - 14 * 24 * 60 * 60)
    .sort((a, b) => (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0))
    .slice(0, 100);
  const lovedAndPlayed = songs.filter((song) => song.favorite && song.playCount > 0).sort(byPlayCount).slice(0, 100);
  const albumSpotlight = pickAlbumSpotlight(songs, seed, albumTracklistCache);

  const playlists: Playlist[] = [
    mapPlaylist('smart_daily_mix', 'Daily Mix', 'Fresh daily mix with genre balance.', dailyMix),
    mapPlaylist('smart_on_repeat', 'On Repeat', 'Songs you have been playing most this week.', weeklyShuffle(onRepeat, seed)),
    ...moodMixes.map((entry) => ({
      ...entry,
      songIds: weeklyShuffle(
        entry.songIds.map((id) => songs.find((song) => song.id === id)).filter(Boolean) as Song[],
        seed,
      ).map((song) => song.id),
    })),
    ...genreMixes.map((entry) => ({
      ...entry,
      songIds: weeklyShuffle(
        entry.songIds.map((id) => songs.find((song) => song.id === id)).filter(Boolean) as Song[],
        seed,
      ).map((song) => song.id),
    })),
    mapPlaylist('smart_recently_played', 'Recently Played', 'Tracks you listened to most recently.', weeklyShuffle(recentlyPlayed, seed)),
    mapPlaylist('smart_recently_added', 'Recently Added', 'Latest tracks added to your library.', weeklyShuffle(recentlyAdded, seed)),
    mapPlaylist('smart_most_played', 'Most Played', 'Your most replayed songs.', weeklyShuffle(mostPlayed, seed)),
    mapPlaylist('smart_rediscover', 'Rediscover', 'Songs you have not played in a while.', weeklyShuffle(rediscover, seed)),
    mapPlaylist('smart_favorites', 'Favorites', 'Your favorited songs.', weeklyShuffle(favorites, seed)),
  ];

  if (lovedAndPlayed.length) {
    playlists.push(
      mapPlaylist('smart_loved_played', 'Loved & Played', 'Favorites you keep coming back to.', weeklyShuffle(lovedAndPlayed, seed)),
    );
  }
  if (quickHits.length) {
    playlists.push(
      mapPlaylist('smart_quick_hits', 'Quick Hits', 'Short, punchy tracks under 3 minutes.', weeklyShuffle(quickHits, seed)),
    );
  }
  if (longSessions.length) {
    playlists.push(
      mapPlaylist('smart_long_sessions', 'Long Sessions', 'Longer tracks for deep listening.', weeklyShuffle(longSessions, seed)),
    );
  }
  if (deepCuts.length) {
    playlists.push(
      mapPlaylist('smart_deep_cuts', 'Deep Cuts', 'Less-played gems from your library.', weeklyShuffle(deepCuts, seed)),
    );
  }
  if (albumSpotlight.length) {
    playlists.push(
      mapPlaylist(
        'smart_album_spotlight',
        'Album Spotlight',
        'A full album, front to back.',
        albumSpotlight,
        'smart',
      ),
    );
  }

  if (!Object.keys(overrides).length) {
    return playlists;
  }

  const songSet = new Set(songs.map((song) => song.id));

  return playlists.map((playlist) => {
    const extras = overrides[playlist.id] ?? [];
    if (!extras.length) {
      return playlist;
    }
    const merged = [...playlist.songIds];
    for (const id of extras) {
      if (songSet.has(id) && !merged.includes(id)) {
        merged.push(id);
      }
    }
    return {
      ...playlist,
      songIds: merged,
    };
  });
};

const pickAlbumSpotlight = (songs: Song[], seed: number, albumTracklistCache?: AlbumTracklistCache): Song[] => {
  const include = hash(`album-spotlight:${seed}`) % 3 === 0;
  if (!include) {
    return [];
  }

  const albumMap = new Map<string, Song[]>();
  for (const song of songs) {
    if (!song.album?.trim()) {
      continue;
    }
    const primaryArtist = getPrimaryArtistName(song.artist);
    const key = `${primaryArtist.toLowerCase()}::${song.album.trim().toLowerCase()}`;
    const list = albumMap.get(key) ?? [];
    list.push(song);
    albumMap.set(key, list);
  }

  const albums = [...albumMap.values()]
    .map((albumSongs) => {
      const sorted = sortAlbumTracks(albumSongs);
      if (!albumTracklistCache) {
        return null;
      }
      const primaryArtist = getPrimaryArtistName(sorted[0]?.artist);
      const albumName = sorted[0]?.album ?? '';
      const key = getAlbumTracklistKey(primaryArtist, albumName);
      const tracklist = albumTracklistCache[key];
      if (!tracklist?.tracks?.length) {
        return null;
      }
      const byTrack = new Map<number, Song>();
      const byTitle = new Map<string, Song>();
      for (const song of sorted) {
        if (song.track && song.track > 0 && !byTrack.has(song.track)) {
          byTrack.set(song.track, song);
        }
        const normalized = normalizeTrackTitle(song.title);
        if (normalized && !byTitle.has(normalized)) {
          byTitle.set(normalized, song);
        }
      }
      let available = 0;
      for (const track of tracklist.tracks) {
        const normalized = normalizeTrackTitle(track.title);
        const match = byTrack.get(track.position) ?? (normalized ? byTitle.get(normalized) : undefined);
        if (match) {
          available += 1;
        }
      }
      if (available < 6) {
        return null;
      }
      return sorted;
    })
    .filter((albumSongs): albumSongs is Song[] => Boolean(albumSongs));

  if (!albums.length) {
    return [];
  }

  const index = hash(`album-spotlight-pick:${seed}`) % albums.length;
  return albums[index] ?? [];
};
