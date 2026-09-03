import type { Song } from '@/types/music';

export type PlaylistComposerFilter = 'all' | 'favorites' | 'recent' | 'most_played';

export type IndexedPlaylistSong = {
  song: Song;
  search: string;
};

export const indexPlaylistSongs = (songs: Song[]): IndexedPlaylistSong[] =>
  songs.map((song) => ({
    song,
    search: `${song.title}\u0000${song.artist}\u0000${song.album}`.toLocaleLowerCase(),
  }));

export const filterPlaylistSongs = (
  indexedSongs: IndexedPlaylistSong[],
  queryValue: string,
  filter: PlaylistComposerFilter,
): Song[] => {
  const query = queryValue.trim().toLocaleLowerCase();
  const filtered: Song[] = [];
  for (const entry of indexedSongs) {
    if (filter === 'favorites' && !entry.song.favorite) continue;
    if (query && !entry.search.includes(query)) continue;
    filtered.push(entry.song);
  }
  if (filter === 'recent') filtered.sort((a, b) => b.addedAt - a.addedAt);
  if (filter === 'most_played') filtered.sort((a, b) => b.playCount - a.playCount);
  return filtered;
};
