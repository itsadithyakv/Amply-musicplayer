import type { Song } from '@/types/music';
import { splitArtistNames } from '@/utils/artists';
import { isUnknownGenre } from '@/services/songMetadataService';
import { normalizeTrackTitle, type AlbumTracklist } from '@/services/albumTracklistService';
import { oneOf } from '@/services/preferences';

export interface SongGroup {
  label: string;
  songs: Song[];
  artwork?: string;
  totalPlays: number;
}

export type GenreGroup = SongGroup;
export type ArtistGroup = SongGroup;

export type AlbumEntry = {
  album: string;
  artist: string;
  artwork?: string;
  songs: Song[];
  key: string;
  totalPlays: number;
};

export type TrackViewItem = { id?: string; title: string; position: number; available: boolean };
export type MissingTrack = { position: number; title: string };

export interface AlbumTrackMatches {
  total: number;
  available: number;
  missing: MissingTrack[];
  orderedSongs: Song[];
  viewItems: TrackViewItem[];
}

export type AlbumSort = 'title_asc' | 'title_desc' | 'artist_asc' | 'most_played' | 'most_songs';
export type GroupSort = 'name_asc' | 'name_desc' | 'most_played' | 'most_songs';
export type ArtistSort = GroupSort;
export type GenreSort = GroupSort;

export const isAlbumSort = oneOf<AlbumSort>(['title_asc', 'title_desc', 'artist_asc', 'most_played', 'most_songs']);
export const isArtistSort = oneOf<ArtistSort>(['name_asc', 'name_desc', 'most_played', 'most_songs']);
export const isGenreSort = oneOf<GenreSort>(['name_asc', 'name_desc', 'most_played', 'most_songs']);

export const albumSortOptions: Array<{ label: string; value: AlbumSort }> = [
  { label: 'Album (A-Z)', value: 'title_asc' },
  { label: 'Album (Z-A)', value: 'title_desc' },
  { label: 'Artist (A-Z)', value: 'artist_asc' },
  { label: 'Most Played', value: 'most_played' },
  { label: 'Most Songs', value: 'most_songs' },
];

export const artistSortOptions: Array<{ label: string; value: ArtistSort }> = [
  { label: 'Artist (A-Z)', value: 'name_asc' },
  { label: 'Artist (Z-A)', value: 'name_desc' },
  { label: 'Most Played', value: 'most_played' },
  { label: 'Most Songs', value: 'most_songs' },
];

export const genreSortOptions: Array<{ label: string; value: GenreSort }> = [
  { label: 'Genre (A-Z)', value: 'name_asc' },
  { label: 'Genre (Z-A)', value: 'name_desc' },
  { label: 'Most Played', value: 'most_played' },
  { label: 'Most Songs', value: 'most_songs' },
];

type ArtworkPicker = (songs: Song[]) => string | undefined;

const finalizeGroups = (groups: Map<string, SongGroup>, artworkFor: ArtworkPicker): SongGroup[] =>
  [...groups.values()]
    .map((group) => ({
      ...group,
      artwork: group.artwork ?? artworkFor(group.songs),
    }))
    .sort((a, b) => b.totalPlays - a.totalPlays || b.songs.length - a.songs.length || a.label.localeCompare(b.label));

export const buildGenreGroups = (songs: Song[], artworkFor: ArtworkPicker): GenreGroup[] => {
  const groups = new Map<string, GenreGroup>();

  for (const song of songs) {
    const label = isUnknownGenre(song.genre) ? 'Unknown Genre' : song.genre?.trim() || 'Unknown Genre';
    const key = label.toLowerCase();
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        label,
        songs: [song],
        artwork: undefined,
        totalPlays: song.playCount,
      });
      continue;
    }

    existing.songs.push(song);
    existing.totalPlays += song.playCount;
    if (!existing.artwork && song.albumArt) {
      existing.artwork = song.albumArt;
    }
  }

  return finalizeGroups(groups, artworkFor);
};

export const buildArtistGroups = (songs: Song[], artworkFor: ArtworkPicker): ArtistGroup[] => {
  const groups = new Map<string, ArtistGroup>();
  const seenByArtist = new Map<string, Set<string>>();

  for (const song of songs) {
    const artistNames = splitArtistNames(song.artist);

    for (const artistName of artistNames) {
      const key = artistName.toLowerCase();
      const seenSongIds = seenByArtist.get(key) ?? new Set<string>();
      if (seenSongIds.has(song.id)) {
        continue;
      }

      seenSongIds.add(song.id);
      seenByArtist.set(key, seenSongIds);

      const existing = groups.get(key);
      if (!existing) {
        groups.set(key, {
          label: artistName,
          songs: [song],
          artwork: undefined,
          totalPlays: song.playCount,
        });
        continue;
      }

      existing.songs.push(song);
      existing.totalPlays += song.playCount;
      if (!existing.artwork && song.albumArt) {
        existing.artwork = song.albumArt;
      }
    }
  }

  return finalizeGroups(groups, artworkFor);
};

/** Sorts artist/genre groups (already filtered) by the shared group sort. */
export const sortGroups = <T extends SongGroup>(groups: T[], sortBy: GroupSort): T[] => {
  const sorted = [...groups];
  switch (sortBy) {
    case 'name_desc':
      return sorted.sort((a, b) => b.label.localeCompare(a.label));
    case 'most_played':
      return sorted.sort((a, b) => b.totalPlays - a.totalPlays || b.songs.length - a.songs.length);
    case 'most_songs':
      return sorted.sort((a, b) => b.songs.length - a.songs.length || b.totalPlays - a.totalPlays);
    case 'name_asc':
    default:
      return sorted.sort((a, b) => a.label.localeCompare(b.label));
  }
};

export const sortAlbums = (albums: AlbumEntry[], sortBy: AlbumSort): AlbumEntry[] => {
  const sorted = [...albums];
  switch (sortBy) {
    case 'title_desc':
      return sorted.sort((a, b) => b.album.localeCompare(a.album) || a.artist.localeCompare(b.artist));
    case 'artist_asc':
      return sorted.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
    case 'most_played':
      return sorted.sort((a, b) => b.totalPlays - a.totalPlays || a.album.localeCompare(b.album));
    case 'most_songs':
      return sorted.sort((a, b) => b.songs.length - a.songs.length || a.album.localeCompare(b.album));
    case 'title_asc':
    default:
      return sorted.sort((a, b) => a.album.localeCompare(b.album) || a.artist.localeCompare(b.artist));
  }
};

const sortAlbumTracksForPlayback = (songs: Song[]): Song[] => {
  return [...songs].sort((a, b) => {
    const trackA = a.track ?? 0;
    const trackB = b.track ?? 0;
    const hasA = trackA > 0;
    const hasB = trackB > 0;
    if (hasA && hasB && trackA !== trackB) {
      return trackA - trackB;
    }
    if (hasA !== hasB) {
      return hasA ? -1 : 1;
    }
    const titleCmp = a.title.localeCompare(b.title);
    if (titleCmp !== 0) {
      return titleCmp;
    }
    return a.filename.localeCompare(b.filename);
  });
};

export const buildAlbumTrackMatches = (albumSongs: Song[], tracklist: AlbumTracklist | null): AlbumTrackMatches => {
  if (!tracklist?.tracks?.length) {
    const orderedSongs = [...albumSongs].sort((a, b) => {
      const titleCmp = a.title.localeCompare(b.title);
      if (titleCmp !== 0) {
        return titleCmp;
      }
      return a.filename.localeCompare(b.filename);
    });
    return {
      total: albumSongs.length,
      available: albumSongs.length,
      missing: [],
      orderedSongs,
      viewItems: orderedSongs.map((song, index) => ({
        id: song.id,
        title: song.title,
        position: index + 1,
        available: true,
      })),
    };
  }

  const byTrack = new Map<number, Song>();
  const byTitle = new Map<string, Song>();
  for (const song of albumSongs) {
    if (song.track && song.track > 0 && !byTrack.has(song.track)) {
      byTrack.set(song.track, song);
    }
    const normalized = normalizeTrackTitle(song.title);
    if (normalized && !byTitle.has(normalized)) {
      byTitle.set(normalized, song);
    }
  }

  const used = new Set<string>();
  const orderedSongs: Song[] = [];
  const missing: MissingTrack[] = [];

  const viewItems: TrackViewItem[] = [];
  for (const track of tracklist.tracks) {
    const normalized = normalizeTrackTitle(track.title);
    const match = byTrack.get(track.position) ?? (normalized ? byTitle.get(normalized) : undefined);
    if (match && !used.has(match.id)) {
      used.add(match.id);
      orderedSongs.push(match);
      viewItems.push({
        id: match.id,
        title: track.title,
        position: track.position,
        available: true,
      });
    } else {
      missing.push({ position: track.position, title: track.title });
      viewItems.push({
        title: track.title,
        position: track.position,
        available: false,
      });
    }
  }

  const fallback = sortAlbumTracksForPlayback(albumSongs);
  for (const song of fallback) {
    if (!used.has(song.id)) {
      used.add(song.id);
      orderedSongs.push(song);
      viewItems.push({
        id: song.id,
        title: song.title,
        position: viewItems.length + 1,
        available: true,
      });
    }
  }

  return {
    total: tracklist.tracks.length,
    available: tracklist.tracks.length - missing.length,
    missing,
    orderedSongs,
    viewItems,
  };
};
