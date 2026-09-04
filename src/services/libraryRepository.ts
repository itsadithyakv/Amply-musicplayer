import type { LibraryTab, Playlist, Song } from '@/types/music';
import { buildArtworkSet } from '@/services/playlistArtworkService';
import { recordPerfEvent, recordSelectorCacheHit, recordSelectorRebuild } from '@/services/perfDiagnostics';
import { splitArtistNames } from '@/utils/artists';
import type { LibraryVersions } from '@/store/libraryDataStore';

type LibrarySnapshot = {
  songs: Song[];
  playlists: Playlist[];
  songsById: Map<string, Song>;
  playlistById: Map<string, Playlist>;
  songIds: string[];
};

type VersionedInput = {
  versions?: LibraryVersions;
};

export type PlaylistDetailView = {
  playlist?: Playlist;
  playlistSongs: Song[];
  playlistIds: string[];
  artworkSet: string[];
};

export type PlaylistCardView = {
  playlist: Playlist;
  artworkSet: string[];
  firstSongId?: string;
};

export type HomeView = {
  songs: Song[];
  playlists: Playlist[];
  songsById: Map<string, Song>;
  allSongIds: string[];
  recentlyPlayed: Song[];
  recentlyPlayedIds: string[];
  rediscoverSongs: Song[];
  rediscoverSongIds: string[];
  userPlaylists: Playlist[];
  userPlaylistIds: string[];
  topArtists: Array<{ artistName: string; topSong: Song; topSongId: string; songIds: string[] }>;
};

export type LibraryTabView = {
  tab: LibraryTab;
  songs: Song[];
  songIds: string[];
  songsById: Map<string, Song>;
};

export type SearchView = {
  query: string;
  songs: Song[];
  songIds: string[];
  suggestions: string[];
};

let snapshotCache: { key: string | null; songs: Song[]; playlists: Playlist[]; snapshot: LibrarySnapshot } | null = null;
let playlistDetailCache: {
  key: string | null;
  songs: Song[];
  playlists: Playlist[];
  albumArtFrequency: Map<string, number>;
  playlistId?: string;
  view: PlaylistDetailView;
} | null = null;
let playlistCardsCache: {
  key: string | null;
  songs: Song[];
  playlists: Playlist[];
  albumArtFrequency: Map<string, number>;
  views: PlaylistCardView[];
} | null = null;
let homeViewCache: { key: string | null; songs: Song[]; playlists: Playlist[]; view: HomeView } | null = null;
let libraryTabViewCache: { key: string | null; songs: Song[]; tab: LibraryTab; view: LibraryTabView } | null = null;
let searchViewCache: { key: string | null; songs: Song[]; query: string; results: Song[]; view: SearchView } | null = null;

const versionKey = (versions?: LibraryVersions, suffix = ''): string | null => {
  if (!versions) {
    return null;
  }
  return [
    versions.libraryVersion,
    versions.activityVersion,
    versions.playlistVersion,
    versions.artworkVersion,
    suffix,
  ].join(':');
};

const recordCacheHit = (selector: string, data?: Record<string, unknown>): void => {
  recordSelectorCacheHit(selector);
  recordPerfEvent(`library.repository.${selector}.cache-hit`, data);
};

const recordRebuild = (selector: string, data?: Record<string, unknown>): void => {
  recordSelectorRebuild(selector);
  recordPerfEvent(`library.repository.${selector}.rebuild`, data);
};

const padArtworkSet = (artworkSet: string[]): string[] => {
  if (!artworkSet.length) {
    return artworkSet;
  }

  const next = [...artworkSet];
  while (next.length < 4) {
    next.push(next[next.length - 1]);
  }
  return next;
};

const getLibrarySnapshot = (
  songs: Song[],
  playlists: Playlist[],
  versions?: LibraryVersions,
): LibrarySnapshot => {
  const key = versionKey(versions, `snapshot:${songs.length}:${playlists.length}`);
  if (
    snapshotCache &&
    ((key !== null && snapshotCache.key === key) ||
      (key === null && snapshotCache.songs === songs && snapshotCache.playlists === playlists))
  ) {
    recordCacheHit('snapshot', { songs: songs.length, playlists: playlists.length });
    return snapshotCache.snapshot;
  }

  recordRebuild('snapshot', { songs: songs.length, playlists: playlists.length });
  snapshotCache = {
    key,
    songs,
    playlists,
    snapshot: {
      songs,
      playlists,
      songsById: new Map(songs.map((song) => [song.id, song])),
      playlistById: new Map(playlists.map((playlist) => [playlist.id, playlist])),
      songIds: songs.map((song) => song.id),
    },
  };
  return snapshotCache.snapshot;
};

export const getPlaylistDetailView = ({
  songs,
  playlists,
  playlistId,
  albumArtFrequency,
  versions,
}: {
  songs: Song[];
  playlists: Playlist[];
  playlistId?: string;
  albumArtFrequency: Map<string, number>;
} & VersionedInput): PlaylistDetailView => {
  const key = versionKey(versions, `playlist-detail:${playlistId ?? ''}:${songs.length}:${playlists.length}`);
  if (
    playlistDetailCache &&
    playlistDetailCache.albumArtFrequency === albumArtFrequency &&
    playlistDetailCache.playlistId === playlistId &&
    ((key !== null && playlistDetailCache.key === key) ||
      (key === null && playlistDetailCache.songs === songs && playlistDetailCache.playlists === playlists))
  ) {
    recordCacheHit('playlist-detail', { playlistId: playlistId ?? '' });
    return playlistDetailCache.view;
  }

  recordRebuild('playlist-detail', { playlistId: playlistId ?? '' });
  const snapshot = getLibrarySnapshot(songs, playlists, versions);
  const playlist = playlistId ? snapshot.playlistById.get(playlistId) : undefined;
  const playlistSongs = playlist
    ? playlist.songIds.map((id) => snapshot.songsById.get(id)).filter((song): song is Song => song !== undefined)
    : [];
  const artworkSet = padArtworkSet(buildArtworkSet(playlistSongs, albumArtFrequency, 4, playlist?.artwork));
  const view = {
    playlist,
    playlistSongs,
    playlistIds: playlistSongs.map((song) => song.id),
    artworkSet,
  };

  playlistDetailCache = {
    key,
    songs,
    playlists,
    albumArtFrequency,
    playlistId,
    view,
  };
  return view;
};

export const getPlaylistCardViews = ({
  songs,
  playlists,
  albumArtFrequency,
  versions,
}: {
  songs: Song[];
  playlists: Playlist[];
  albumArtFrequency: Map<string, number>;
} & VersionedInput): PlaylistCardView[] => {
  const key = versionKey(versions, `playlist-cards:${songs.length}:${playlists.length}`);
  if (
    playlistCardsCache &&
    playlistCardsCache.albumArtFrequency === albumArtFrequency &&
    ((key !== null && playlistCardsCache.key === key) ||
      (key === null && playlistCardsCache.songs === songs && playlistCardsCache.playlists === playlists))
  ) {
    recordCacheHit('playlist-cards', { playlists: playlists.length });
    return playlistCardsCache.views;
  }

  recordRebuild('playlist-cards', { playlists: playlists.length });
  const snapshot = getLibrarySnapshot(songs, playlists, versions);
  const views = playlists.map((playlist) => {
    const playlistSongs = playlist.songIds
      .map((songId) => snapshot.songsById.get(songId))
      .filter((entry): entry is Song => entry !== undefined);
    return {
      playlist,
      artworkSet: padArtworkSet(buildArtworkSet(playlistSongs, albumArtFrequency, 4, playlist.artwork)),
      firstSongId: playlistSongs[0]?.id,
    };
  });

  playlistCardsCache = {
    key,
    songs,
    playlists,
    albumArtFrequency,
    views,
  };
  return views;
};

export const getHomeView = ({
  songs,
  playlists,
  versions,
}: {
  songs: Song[];
  playlists: Playlist[];
} & VersionedInput): HomeView => {
  const key = versionKey(versions, `home:${songs.length}:${playlists.length}`);
  if (
    homeViewCache &&
    ((key !== null && homeViewCache.key === key) ||
      (key === null && homeViewCache.songs === songs && homeViewCache.playlists === playlists))
  ) {
    recordCacheHit('home', { songs: songs.length, playlists: playlists.length });
    return homeViewCache.view;
  }

  recordRebuild('home', { songs: songs.length, playlists: playlists.length });
  const snapshot = getLibrarySnapshot(songs, playlists, versions);
  const recentlyPlayed = [...songs]
    .filter((song) => Boolean(song.lastPlayed))
    .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0))
    .slice(0, 16);
  const rediscoverSongs = [...songs]
    .filter((song) => !song.lastPlayed || Date.now() / 1000 - (song.lastPlayed ?? 0) > 60 * 60 * 24 * 30)
    .sort((a, b) => b.addedAt - a.addedAt)
    .slice(0, 16);
  const artistBuckets = new Map<string, { count: number; topSong: Song; songIds: string[] }>();
  for (const song of songs) {
    for (const artistName of splitArtistNames(song.artist)) {
      const key = artistName.trim();
      if (!key) {
        continue;
      }
      const current = artistBuckets.get(key);
      if (!current) {
        artistBuckets.set(key, { count: song.playCount ?? 0, topSong: song, songIds: [song.id] });
        continue;
      }
      current.count += song.playCount ?? 0;
      current.songIds.push(song.id);
      if ((song.playCount ?? 0) > (current.topSong.playCount ?? 0)) {
        current.topSong = song;
      }
    }
  }
  const topArtists = [...artistBuckets.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, 16)
    .map(([artistName, value]) => ({
      artistName,
      topSong: value.topSong,
      topSongId: value.topSong.id,
      songIds: value.songIds,
    }));
  const view = {
    songs,
    playlists,
    songsById: snapshot.songsById,
    allSongIds: snapshot.songIds,
    recentlyPlayed,
    recentlyPlayedIds: recentlyPlayed.map((song) => song.id),
    rediscoverSongs,
    rediscoverSongIds: rediscoverSongs.map((song) => song.id),
    userPlaylists: playlists.filter((playlist) => playlist.type === 'custom'),
    userPlaylistIds: playlists.filter((playlist) => playlist.type === 'custom').map((playlist) => playlist.id),
    topArtists,
  };
  homeViewCache = { key, songs, playlists, view };
  return view;
};

export const getLibraryTabView = ({
  songs,
  tab,
  versions,
}: {
  songs: Song[];
  tab: LibraryTab;
} & VersionedInput): LibraryTabView => {
  const key = versionKey(versions, `library-tab:${tab}:${songs.length}`);
  if (
    libraryTabViewCache &&
    libraryTabViewCache.tab === tab &&
    ((key !== null && libraryTabViewCache.key === key) ||
      (key === null && libraryTabViewCache.songs === songs))
  ) {
    recordCacheHit('library-tab', { tab });
    return libraryTabViewCache.view;
  }

  recordRebuild('library-tab', { tab, songs: songs.length });
  const snapshot = getLibrarySnapshot(songs, [], versions);
  const view = {
    tab,
    songs,
    songIds: snapshot.songIds,
    songsById: snapshot.songsById,
  };
  libraryTabViewCache = { key, songs, tab, view };
  return view;
};

export const getSearchView = ({
  songs,
  query,
  results,
  versions,
}: {
  songs: Song[];
  query: string;
  results: Song[];
} & VersionedInput): SearchView => {
  const key = versionKey(versions, `search:${query}:${songs.length}:${results.length}`);
  if (
    searchViewCache &&
    searchViewCache.query === query &&
    searchViewCache.results === results &&
    ((key !== null && searchViewCache.key === key) ||
      (key === null && searchViewCache.songs === songs))
  ) {
    recordCacheHit('search', { query });
    return searchViewCache.view;
  }

  recordRebuild('search', { query, results: results.length });
  const pool = new Set<string>();
  for (const song of results) {
    pool.add(song.title);
    for (const artistName of splitArtistNames(song.artist)) {
      pool.add(artistName);
    }
    pool.add(song.album);
    if (pool.size >= 8) {
      break;
    }
  }
  const view = {
    query,
    songs: results,
    songIds: results.map((song) => song.id),
    suggestions: [...pool],
  };
  searchViewCache = { key, songs, query, results, view };
  return view;
};
