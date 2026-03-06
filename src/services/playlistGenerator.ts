import type { Playlist, Song } from '@/types/music';

const byPlayCount = (a: Song, b: Song) => b.playCount - a.playCount;

const hash = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
};

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

const pickDailyMix = (songs: Song[]): Song[] => {
  const now = new Date();
  const seed = Number(`${now.getUTCFullYear()}${now.getUTCMonth() + 1}${now.getUTCDate()}`);

  const shuffled = [...songs].sort((a, b) => {
    const scoreA = hash(`${a.id}:${seed}`);
    const scoreB = hash(`${b.id}:${seed}`);
    return scoreA - scoreB;
  });

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
    const genre = song.genre?.trim() || 'Unknown Genre';
    if (genre.toLowerCase() === 'unknown genre') {
      continue;
    }

    const list = byGenre.get(genre) ?? [];
    list.push(song);
    byGenre.set(genre, list);
  }

  const rankedGenres = [...byGenre.entries()]
    .map(([genre, genreSongs]) => ({
      genre,
      genreSongs: [...genreSongs].sort((a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)),
      totalPlays: genreSongs.reduce((total, song) => total + song.playCount, 0),
    }))
    .filter((entry) => entry.genreSongs.length >= 1)
    .sort((a, b) => b.totalPlays - a.totalPlays || b.genreSongs.length - a.genreSongs.length)
    .slice(0, 8);

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

export const generateSmartPlaylists = (songs: Song[]): Playlist[] => {
  const now = Math.floor(Date.now() / 1000);
  const recentlyAdded = [...songs].sort((a, b) => b.addedAt - a.addedAt).slice(0, 100);
  const mostPlayed = [...songs].sort(byPlayCount).slice(0, 100);
  const rediscoverCutoff = now - 60 * 24 * 60 * 60;
  const rediscover = songs
    .filter((song) => !song.lastPlayed || song.lastPlayed < rediscoverCutoff)
    .sort((a, b) => (a.lastPlayed ?? 0) - (b.lastPlayed ?? 0))
    .slice(0, 100);
  const favorites = songs.filter((song) => song.favorite).sort(byPlayCount);
  const recentlyPlayed = [...songs].filter((song) => song.lastPlayed).sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)).slice(0, 100);
  const dailyMix = pickDailyMix(songs);
  const onRepeat = pickOnRepeat(songs);
  const genreMixes = buildGenreMixes(songs);

  return [
    mapPlaylist('smart_daily_mix', 'Daily Mix', 'Fresh daily mix with genre balance.', dailyMix),
    mapPlaylist('smart_on_repeat', 'On Repeat', 'Songs you have been playing most this week.', onRepeat),
    ...genreMixes,
    mapPlaylist('smart_recently_played', 'Recently Played', 'Tracks you listened to most recently.', recentlyPlayed),
    mapPlaylist('smart_recently_added', 'Recently Added', 'Latest tracks added to your library.', recentlyAdded),
    mapPlaylist('smart_most_played', 'Most Played', 'Your most replayed songs.', mostPlayed),
    mapPlaylist('smart_rediscover', 'Rediscover', 'Songs you have not played in a while.', rediscover),
    mapPlaylist('smart_favorites', 'Favorites', 'Your favorited songs.', favorites),
  ];
};
