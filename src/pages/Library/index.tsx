import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import { useNavigate } from 'react-router-dom';
import SongList from '@/components/SongList/SongList';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { LibraryTab, Song } from '@/types/music';
import { getPrimaryArtistName, splitArtistNames } from '@/utils/artists';
import { pickMusicFolders } from '@/services/storageService';
import {
  getAlbumTracklistKey,
  loadAlbumTracklist,
  loadAlbumTracklistCache,
  normalizeTrackTitle,
  type AlbumTracklist,
} from '@/services/albumTracklistService';
import { releaseMetadata, tryAcquireMetadata } from '@/services/metadataAttemptService';
import addIcon from '@/assets/icons/add.svg';
import { isUnknownGenre } from '@/services/songMetadataService';

const tabs: Array<{ label: string; value: LibraryTab }> = [
  { label: 'Songs', value: 'songs' },
  { label: 'Albums', value: 'albums' },
  { label: 'Artists', value: 'artists' },
  { label: 'Genres', value: 'genres' },
];

interface LibraryPageProps {
  initialTab?: LibraryTab;
}

interface GenreGroup {
  label: string;
  songs: Song[];
  artwork?: string;
}

interface ArtistGroup {
  label: string;
  songs: Song[];
  artwork?: string;
  totalPlays: number;
}

type CardGridData<T> = {
  items: T[];
  columns: number;
  renderItem: (item: T) => JSX.Element;
  getKey: (item: T, index: number) => string;
};

const CARD_MIN_WIDTH = 190;
const CARD_GAP = 20;
const CARD_HEIGHT = 250;

const LibraryCardShell = ({ children }: { children: React.ReactNode }) => (
  <div className="card-sheen group overflow-hidden rounded-card border border-amply-border/60 bg-amply-surface/60 p-1 shadow-card transition-transform duration-200 ease-smooth hover:-translate-y-1 hover:shadow-lift">
    {children}
  </div>
);

const CardGridRow = <T,>({ index, style, data }: ListChildComponentProps<CardGridData<T>>) => {
  const { items, columns, renderItem, getKey } = data;
  const start = index * columns;
  const slice = items.slice(start, start + columns);

  return (
    <div style={{ ...style, paddingBottom: CARD_GAP }}>
      <div className="grid gap-5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {slice.map((item, offset) => (
          <div key={getKey(item, start + offset)}>{renderItem(item)}</div>
        ))}
      </div>
    </div>
  );
};

const buildGenreGroups = (songs: Song[]): GenreGroup[] => {
  const groups = new Map<string, GenreGroup>();

  for (const song of songs) {
    const label = isUnknownGenre(song.genre) ? 'Unknown Genre' : song.genre?.trim() || 'Unknown Genre';
    const key = label.toLowerCase();
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        label,
        songs: [song],
        artwork: song.albumArt,
      });
      continue;
    }

    existing.songs.push(song);
    if (!existing.artwork && song.albumArt) {
      existing.artwork = song.albumArt;
    }
  }

  return [...groups.values()].sort((a, b) => b.songs.length - a.songs.length || a.label.localeCompare(b.label));
};

const buildArtistGroups = (songs: Song[]): ArtistGroup[] => {
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
          artwork: song.albumArt,
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

  return [...groups.values()].sort((a, b) => b.totalPlays - a.totalPlays || b.songs.length - a.songs.length || a.label.localeCompare(b.label));
};

type AlbumSort = 'title_asc' | 'title_desc' | 'artist_asc' | 'most_played' | 'most_songs';
type ArtistSort = 'name_asc' | 'name_desc' | 'most_played' | 'most_songs';
type GenreSort = 'name_asc' | 'name_desc' | 'most_played' | 'most_songs';

type AlbumEntry = {
  album: string;
  artist: string;
  artwork?: string;
  songs: Song[];
  key: string;
};

const sortAlbums = (albums: AlbumEntry[], sortBy: AlbumSort): AlbumEntry[] => {
  const sorted = [...albums];
  switch (sortBy) {
    case 'title_desc':
      return sorted.sort((a, b) => b.album.localeCompare(a.album) || a.artist.localeCompare(b.artist));
    case 'artist_asc':
      return sorted.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
    case 'most_played':
      return sorted.sort(
        (a, b) =>
          b.songs.reduce((sum, song) => sum + song.playCount, 0) -
            a.songs.reduce((sum, song) => sum + song.playCount, 0) || a.album.localeCompare(b.album),
      );
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

const buildAlbumTrackMatches = (albumSongs: Song[], tracklist: AlbumTracklist | null) => {
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
      missing: [] as Array<{ position: number; title: string }>,
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
  const missing: Array<{ position: number; title: string }> = [];

  const viewItems: Array<{ id?: string; title: string; position: number; available: boolean }> = [];
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

const albumSortOptions: Array<{ label: string; value: AlbumSort }> = [
  { label: 'Album (A-Z)', value: 'title_asc' },
  { label: 'Album (Z-A)', value: 'title_desc' },
  { label: 'Artist (A-Z)', value: 'artist_asc' },
  { label: 'Most Played', value: 'most_played' },
  { label: 'Most Songs', value: 'most_songs' },
];

const artistSortOptions: Array<{ label: string; value: ArtistSort }> = [
  { label: 'Artist (A-Z)', value: 'name_asc' },
  { label: 'Artist (Z-A)', value: 'name_desc' },
  { label: 'Most Played', value: 'most_played' },
  { label: 'Most Songs', value: 'most_songs' },
];

const genreSortOptions: Array<{ label: string; value: GenreSort }> = [
  { label: 'Genre (A-Z)', value: 'name_asc' },
  { label: 'Genre (Z-A)', value: 'name_desc' },
  { label: 'Most Played', value: 'most_played' },
  { label: 'Most Songs', value: 'most_songs' },
];

const LibraryPage = ({ initialTab = 'songs' }: LibraryPageProps) => {
  const songs = useLibraryStore((state) => state.songs);
  const isScanning = useLibraryStore((state) => state.isScanning);
  const scanError = useLibraryStore((state) => state.scanError);
  const libraryPaths = useLibraryStore((state) => state.libraryPaths);
  const addLibraryPath = useLibraryStore((state) => state.addLibraryPath);
  const setLibraryPaths = useLibraryStore((state) => state.setLibraryPaths);
  const scanLibrary = useLibraryStore((state) => state.scanLibrary);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setAlbumQueueView = usePlayerStore((state) => state.setAlbumQueueView);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const settings = usePlayerStore((state) => state.settings);
  const albumTrackFetch = useLibraryStore((state) => state.albumTrackFetch);

  const [activeTab, setActiveTab] = useState<LibraryTab>(() => {
    if (typeof window === 'undefined') {
      return initialTab;
    }
    const stored = window.localStorage.getItem('amply-library-tab') as LibraryTab | null;
    return stored ?? initialTab;
  });
  const navigate = useNavigate();
  const [albumSort, setAlbumSort] = useState<AlbumSort>(() => {
    if (typeof window === 'undefined') {
      return 'title_asc';
    }
    const stored = window.localStorage.getItem('amply-library-sort:albums') as AlbumSort | null;
    return stored ?? 'title_asc';
  });
  const [albumQuery, setAlbumQuery] = useState('');
  const [artistSort, setArtistSort] = useState<ArtistSort>(() => {
    if (typeof window === 'undefined') {
      return 'name_asc';
    }
    const stored = window.localStorage.getItem('amply-library-sort:artists') as ArtistSort | null;
    return stored ?? 'name_asc';
  });
  const [artistQuery, setArtistQuery] = useState('');
  const [genreSort, setGenreSort] = useState<GenreSort>(() => {
    if (typeof window === 'undefined') {
      return 'name_asc';
    }
    const stored = window.localStorage.getItem('amply-library-sort:genres') as GenreSort | null;
    return stored ?? 'name_asc';
  });
  const [genreQuery, setGenreQuery] = useState('');
  const [localPath, setLocalPath] = useState('');
  const [albumTracklists, setAlbumTracklists] = useState<Record<string, AlbumTracklist>>({});
  const [activeAlbum, setActiveAlbum] = useState<{
    album: string;
    artist: string;
    songs: Song[];
    tracklist: AlbumTracklist | null;
    total: number;
    available: number;
    missing: Array<{ position: number; title: string }>;
    orderedSongs: Song[];
    viewItems: Array<{ id?: string; title: string; position: number; available: boolean }>;
    artwork?: string;
    isLoading: boolean;
  } | null>(null);
  const activeAlbumSignatureRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const cache = await loadAlbumTracklistCache();
      if (alive) {
        setAlbumTracklists(cache);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [songs.length, albumTrackFetch.done]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('amply-library-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('amply-library-sort:albums', albumSort);
  }, [albumSort]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('amply-library-sort:artists', artistSort);
  }, [artistSort]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem('amply-library-sort:genres', genreSort);
  }, [genreSort]);

  useEffect(() => {
    if (!activeAlbum) {
      activeAlbumSignatureRef.current = null;
      return;
    }
    const albumName = activeAlbum.album.trim().toLowerCase();
    const primaryArtist = getPrimaryArtistName(activeAlbum.artist).trim().toLowerCase();
    const matchingSongs = songs.filter((song) => {
      if (!song.album?.trim()) {
        return false;
      }
      const songAlbum = song.album.trim().toLowerCase();
      if (songAlbum !== albumName) {
        return false;
      }
      const songArtist = getPrimaryArtistName(song.artist).trim().toLowerCase();
      return songArtist === primaryArtist;
    });
    const signature = `${primaryArtist}::${albumName}::${matchingSongs.map((song) => song.id).join('|')}`;
    if (signature === activeAlbumSignatureRef.current) {
      return;
    }
    activeAlbumSignatureRef.current = signature;
    const tracklistKey = getAlbumTracklistKey(primaryArtist, activeAlbum.album);
    const tracklist = albumTracklists[tracklistKey] ?? activeAlbum.tracklist ?? null;
    const matches = buildAlbumTrackMatches(matchingSongs, tracklist);
    setActiveAlbum((prev) =>
      prev
        ? {
            ...prev,
            songs: matchingSongs,
            tracklist,
            total: matches.total,
            available: matches.available,
            missing: matches.missing,
            orderedSongs: matches.orderedSongs,
            viewItems: matches.viewItems,
          }
        : prev,
    );
  }, [songs, albumTracklists, activeAlbum]);

  const albums = useMemo<AlbumEntry[]>(() => {
    const map = new Map<string, AlbumEntry>();
    for (const song of songs) {
      const albumName = song.album?.trim() ?? '';
      const normalizedAlbum = albumName.toLowerCase();
      const isUnknownAlbum = !albumName || normalizedAlbum === 'unknown album' || normalizedAlbum === 'unknown';
      if (isUnknownAlbum) {
        continue;
      }
      const primaryArtist = getPrimaryArtistName(song.artist);
      const albumKey = getAlbumTracklistKey(primaryArtist, albumName);
      const existing = map.get(albumKey);
      if (!existing) {
        map.set(albumKey, {
          album: albumName,
          artist: song.artist,
          artwork: song.albumArt,
          songs: [song],
          key: albumKey,
        });
        continue;
      }
      existing.songs.push(song);
      if (!existing.artwork && song.albumArt) {
        existing.artwork = song.albumArt;
      }
    }
    return [...map.values()];
  }, [songs]);

  const filteredAlbums = useMemo(() => {
    const query = albumQuery.trim().toLowerCase();
    if (!query) {
      return sortAlbums(albums, albumSort);
    }

    const matches = albums.filter((album) => {
      const albumName = album.album?.toLowerCase() ?? '';
      const artist = album.artist?.toLowerCase() ?? '';
      return albumName.includes(query) || artist.includes(query);
    });

    return sortAlbums(matches, albumSort);
  }, [albums, albumQuery, albumSort]);

  const albumSummaries = useMemo(() => {
    const map = new Map<
      string,
      {
        available: number;
        total: number;
        tracklist: AlbumTracklist | null;
        orderedSongs: Song[];
        viewItems: Array<{ id?: string; title: string; position: number; available: boolean }>;
        missing: Array<{ position: number; title: string }>;
      }
    >();
    for (const entry of albums) {
      const tracklist = albumTracklists[entry.key] ?? null;
      const summary = buildAlbumTrackMatches(entry.songs, tracklist);
      map.set(entry.key, { ...summary, tracklist });
    }
    return map;
  }, [albums, albumTracklists]);
  const artists = useMemo(() => buildArtistGroups(songs), [songs]);
  const genres = useMemo(() => buildGenreGroups(songs), [songs]);

  const filteredArtists = useMemo(() => {
    const query = artistQuery.trim().toLowerCase();
    const matches = query
      ? artists.filter((artist) => artist.label.toLowerCase().includes(query))
      : artists;

    const sorted = [...matches];
    switch (artistSort) {
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
  }, [artists, artistQuery, artistSort]);

  const filteredGenres = useMemo(() => {
    const query = genreQuery.trim().toLowerCase();
    const matches = query
      ? genres.filter((genre) => genre.label.toLowerCase().includes(query))
      : genres;

    const sorted = [...matches];
    switch (genreSort) {
      case 'name_desc':
        return sorted.sort((a, b) => b.label.localeCompare(a.label));
      case 'most_played':
        return sorted.sort((a, b) => b.songs.reduce((sum, song) => sum + song.playCount, 0) - a.songs.reduce((sum, song) => sum + song.playCount, 0));
      case 'most_songs':
        return sorted.sort((a, b) => b.songs.length - a.songs.length);
      case 'name_asc':
      default:
        return sorted.sort((a, b) => a.label.localeCompare(b.label));
    }
  }, [genres, genreQuery, genreSort]);

  return (
    <div className="space-y-5 pb-8">
      <header className="space-y-1">
        <h1 className="text-[30px] font-bold tracking-tight text-amply-textPrimary">Library</h1>
        <p className="text-[13px] text-amply-textSecondary">{songs.length.toLocaleString()} songs indexed</p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amply-border/60 bg-amply-surface p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`rounded-lg px-4 py-2 text-[13px] transition-colors ${
                activeTab === tab.value
                  ? 'bg-amply-hover text-amply-textPrimary'
                  : 'text-amply-textSecondary hover:bg-amply-hover'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'songs' ? (
          <div className="flex items-center gap-2">
            <input
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              placeholder="Add folder path..."
              className="hidden min-w-[220px] flex-1 rounded-lg border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent md:block"
            />
            <button
              type="button"
              onClick={async () => {
                if (localPath.trim()) {
                  await addLibraryPath(localPath.trim());
                  setLocalPath('');
                  return;
                }
                const picked = await pickMusicFolders();
                if (picked.length) {
                  const merged = Array.from(new Set([...libraryPaths, ...picked]));
                  await setLibraryPaths(merged);
                }
              }}
              className="inline-flex items-center justify-center rounded-lg border border-amply-border/60 bg-amply-bgSecondary p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover hover:text-amply-textPrimary"
              title="Add music folder"
            >
              <img src={addIcon} alt="" className="h-4 w-4 brightness-0 invert" />
            </button>
            <button
              type="button"
              onClick={() => {
                void scanLibrary();
              }}
              className="rounded-lg border border-amply-border/60 px-3 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
            >
              {isScanning ? 'Scanning...' : 'Rescan'}
            </button>
          </div>
        ) : null}
      </div>

      {isScanning ? <p className="text-[13px] text-amply-textSecondary">Scanning library...</p> : null}
      {scanError ? <p className="text-[13px] text-red-400">{scanError}</p> : null}

      {activeTab === 'songs' ? <SongList songs={songs} persistKey="library-songs" /> : null}

      {activeTab === 'albums' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={albumQuery}
              onChange={(event) => setAlbumQuery(event.target.value)}
              placeholder="Search albums or artists..."
              className="min-w-[240px] flex-1 rounded-lg border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[13px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
            />
            <label className="flex items-center gap-2 text-[12px] text-amply-textSecondary">
              Sort
              <select
                value={albumSort}
                onChange={(event) => setAlbumSort(event.target.value as AlbumSort)}
                className="rounded-md border border-amply-border/60 bg-amply-bgSecondary px-2 py-1 text-[12px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
              >
                {albumSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="h-[70vh]">
            <AutoSizer>
              {({ height, width }) => {
                const columns = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
                const rowCount = Math.ceil(filteredAlbums.length / columns);
                const data: CardGridData<AlbumEntry> = {
                  items: filteredAlbums,
                  columns,
                  getKey: (entry) => entry.key,
                  renderItem: (entry) => {
                    const summary = albumSummaries.get(entry.key);
                    const totalLocal = entry.songs.length;
                    const meta = summary?.tracklist
                      ? `${summary.available}/${summary.total} tracks`
                      : `${totalLocal} tracks`;
                    return (
                      <LibraryCardShell>
                        <AlbumCard
                          key={`album-${entry.key}`}
                          title={entry.album}
                          subtitle={entry.artist}
                          artwork={entry.artwork}
                          meta={meta}
                          onClick={() => {
                            const cached = albumSummaries.get(entry.key);
                            const tracklist = cached?.tracklist ?? null;
                            const { total, available, missing, orderedSongs, viewItems } =
                              cached ?? buildAlbumTrackMatches(entry.songs, tracklist);
                            setActiveAlbum({
                              album: entry.album,
                              artist: getPrimaryArtistName(entry.artist),
                              songs: entry.songs,
                              tracklist,
                              total,
                              available,
                              missing,
                              orderedSongs,
                              viewItems,
                              artwork: entry.artwork,
                              isLoading: Boolean(!tracklist && !settings.metadataFetchPaused),
                            });
                            if (!tracklist && !settings.metadataFetchPaused && tryAcquireMetadata('album_tracklist', entry.key)) {
                              void (async () => {
                                try {
                                  const result = await loadAlbumTracklist(getPrimaryArtistName(entry.artist), entry.album);
                                  const cache = await loadAlbumTracklistCache();
                                  setAlbumTracklists(cache);
                                  if (!result) {
                                    setActiveAlbum((prev) => (prev ? { ...prev, isLoading: false } : prev));
                                    return;
                                  }
                                  const matches = buildAlbumTrackMatches(entry.songs, result);
                                  setActiveAlbum((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          tracklist: result,
                                          total: matches.total,
                                          available: matches.available,
                                          missing: matches.missing,
                                          orderedSongs: matches.orderedSongs,
                                          viewItems: matches.viewItems,
                                          isLoading: false,
                                        }
                                      : prev,
                                  );
                                } finally {
                                  releaseMetadata('album_tracklist', entry.key);
                                }
                              })();
                            }
                          }}
                          onInfo={() => {
                            const cached = albumSummaries.get(entry.key);
                            const tracklist = cached?.tracklist ?? null;
                            const { total, available, missing, orderedSongs, viewItems } =
                              cached ?? buildAlbumTrackMatches(entry.songs, tracklist);
                            setActiveAlbum({
                              album: entry.album,
                              artist: getPrimaryArtistName(entry.artist),
                              songs: entry.songs,
                              tracklist,
                              total,
                              available,
                              missing,
                              orderedSongs,
                              viewItems,
                              artwork: entry.artwork,
                              isLoading: Boolean(!tracklist && !settings.metadataFetchPaused),
                            });
                            if (!tracklist && !settings.metadataFetchPaused && tryAcquireMetadata('album_tracklist', entry.key)) {
                              void (async () => {
                                try {
                                  const result = await loadAlbumTracklist(getPrimaryArtistName(entry.artist), entry.album);
                                  const cache = await loadAlbumTracklistCache();
                                  setAlbumTracklists(cache);
                                  if (!result) {
                                    setActiveAlbum((prev) => (prev ? { ...prev, isLoading: false } : prev));
                                    return;
                                  }
                                  const matches = buildAlbumTrackMatches(entry.songs, result);
                                  setActiveAlbum((prev) =>
                                    prev
                                      ? {
                                          ...prev,
                                          tracklist: result,
                                          total: matches.total,
                                          available: matches.available,
                                          missing: matches.missing,
                                          orderedSongs: matches.orderedSongs,
                                          viewItems: matches.viewItems,
                                          isLoading: false,
                                        }
                                      : prev,
                                  );
                                } finally {
                                  releaseMetadata('album_tracklist', entry.key);
                                }
                              })();
                            }
                          }}
                        />
                      </LibraryCardShell>
                    );
                  },
                };
                return (
                  <List<CardGridData<AlbumEntry>>
                    height={height}
                    width={width}
                    itemCount={rowCount}
                    itemSize={CARD_HEIGHT + CARD_GAP}
                    itemData={data}
                    overscanCount={3}
                  >
                    {CardGridRow as ComponentType<ListChildComponentProps<CardGridData<AlbumEntry>>>}
                  </List>
                );
              }}
            </AutoSizer>
          </div>
        </div>
      ) : null}

      {activeTab === 'artists' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={artistQuery}
              onChange={(event) => setArtistQuery(event.target.value)}
              placeholder="Search artists..."
              className="min-w-[240px] flex-1 rounded-lg border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[13px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
            />
            <label className="flex items-center gap-2 text-[12px] text-amply-textSecondary">
              Sort
              <select
                value={artistSort}
                onChange={(event) => setArtistSort(event.target.value as ArtistSort)}
                className="rounded-md border border-amply-border/60 bg-amply-bgSecondary px-2 py-1 text-[12px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
              >
                {artistSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="h-[70vh]">
            <AutoSizer>
              {({ height, width }) => {
                const columns = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
                const rowCount = Math.ceil(filteredArtists.length / columns);
                const data: CardGridData<ArtistGroup> = {
                  items: filteredArtists,
                  columns,
                  getKey: (entry) => entry.label.toLowerCase(),
                  renderItem: (artistGroup) => (
                    <LibraryCardShell>
                      <AlbumCard
                        key={`artist-${artistGroup.label.toLowerCase()}`}
                        title={artistGroup.label}
                        subtitle={`${artistGroup.songs.length} songs`}
                        artwork={artistGroup.artwork}
                        onClick={() => {
                          const artistSongs = artistGroup.songs;
                          if (!artistSongs.length) {
                            return;
                          }
                          const queue = artistSongs.map((item) => item.id);
                          setQueue(queue, artistSongs[0].id);
                          void playSongById(artistSongs[0].id, false);
                        }}
                      />
                    </LibraryCardShell>
                  ),
                };
                return (
                  <List<CardGridData<ArtistGroup>>
                    height={height}
                    width={width}
                    itemCount={rowCount}
                    itemSize={CARD_HEIGHT + CARD_GAP}
                    itemData={data}
                    overscanCount={3}
                  >
                    {CardGridRow as ComponentType<ListChildComponentProps<CardGridData<ArtistGroup>>>}
                  </List>
                );
              }}
            </AutoSizer>
          </div>
        </div>
      ) : null}

      {activeTab === 'genres' ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={genreQuery}
              onChange={(event) => setGenreQuery(event.target.value)}
              placeholder="Search genres..."
              className="min-w-[240px] flex-1 rounded-lg border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[13px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
            />
            <label className="flex items-center gap-2 text-[12px] text-amply-textSecondary">
              Sort
              <select
                value={genreSort}
                onChange={(event) => setGenreSort(event.target.value as GenreSort)}
                className="rounded-md border border-amply-border/60 bg-amply-bgSecondary px-2 py-1 text-[12px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
              >
                {genreSortOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="h-[70vh]">
            <AutoSizer>
              {({ height, width }) => {
                const columns = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
                const rowCount = Math.ceil(filteredGenres.length / columns);
                const data: CardGridData<GenreGroup> = {
                  items: filteredGenres,
                  columns,
                  getKey: (entry) => entry.label.toLowerCase(),
                  renderItem: (genreGroup) => (
                    <LibraryCardShell>
                      <AlbumCard
                        key={`genre-${genreGroup.label.toLowerCase()}`}
                        title={genreGroup.label}
                        subtitle={`${genreGroup.songs.length} songs`}
                        artwork={genreGroup.artwork}
                        onClick={() => {
                          const genreSongs = genreGroup.songs;
                          if (!genreSongs.length) {
                            return;
                          }
                          const queue = genreSongs.map((item) => item.id);
                          setQueue(queue, genreSongs[0].id);
                          void playSongById(genreSongs[0].id, false);
                        }}
                      />
                    </LibraryCardShell>
                  ),
                };
                return (
                  <List<CardGridData<GenreGroup>>
                    height={height}
                    width={width}
                    itemCount={rowCount}
                    itemSize={CARD_HEIGHT + CARD_GAP}
                    itemData={data}
                    overscanCount={3}
                  >
                    {CardGridRow as ComponentType<ListChildComponentProps<CardGridData<GenreGroup>>>}
                  </List>
                );
              }}
            </AutoSizer>
          </div>
        </div>
      ) : null}

      {activeAlbum ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6">
          <div className="w-full max-w-2xl rounded-2xl border border-amply-border/60 bg-amply-surface/95 p-5 shadow-card">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-xl bg-amply-bgSecondary">
                  {activeAlbum.artwork ? (
                    <img src={activeAlbum.artwork} alt={activeAlbum.album} className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </div>
                <div>
                  <h2 className="text-[18px] font-semibold text-amply-textPrimary">{activeAlbum.album}</h2>
                  <p className="text-[12px] text-amply-textSecondary">{activeAlbum.artist}</p>
                  <p className="mt-1 text-[11px] text-amply-textMuted">
                    {activeAlbum.available}/{activeAlbum.total} tracks available
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveAlbum(null)}
                className="rounded-full border border-amply-border/60 px-3 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-card border border-amply-border bg-amply-card">
              <div className="flex items-center justify-between border-b border-amply-border/60 px-4 py-3">
                <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Tracklist</p>
                <span className="text-[11px] text-amply-textMuted">{activeAlbum.total} tracks</span>
              </div>
              <div className="max-h-[50vh] overflow-y-auto">
                {activeAlbum.isLoading ? (
                  <div className="px-4 py-4 text-[12px] text-amply-textMuted">
                    <div className="flex items-center gap-2 rounded-lg border border-amply-border/60 px-3 py-2">
                      <div className="h-3 w-3 animate-spin rounded-full border-2 border-amply-border border-t-amply-accent" />
                      Fetching album tracklist...
                    </div>
                  </div>
                ) : activeAlbum.tracklist?.tracks?.length ? (
                  <div className="divide-y divide-amply-border/40">
                    {activeAlbum.viewItems.map((track) => {
                      const isMissing = !track.available;
                      return (
                        <div
                          key={`${track.position}-${track.title}`}
                          className={`flex items-center justify-between gap-3 px-4 py-3 text-[12px] ${
                            isMissing ? 'opacity-40' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium text-amply-textPrimary">
                              {track.position}. {track.title}
                            </p>
                            <p className="truncate text-[12px] text-amply-textSecondary">{activeAlbum.album}</p>
                          </div>
                          <span className="text-[11px] uppercase tracking-[0.2em] text-amply-textMuted">
                            {isMissing ? 'Missing' : 'Available'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-4 py-6 text-[13px] text-amply-textMuted">No tracklist cached yet for this album.</p>
                )}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (!activeAlbum.orderedSongs.length) {
                    return;
                  }
                  const queue = activeAlbum.orderedSongs.map((song) => song.id);
                  setQueue(queue, activeAlbum.orderedSongs[0].id);
                  setAlbumQueueView({
                    album: activeAlbum.album,
                    artist: activeAlbum.artist,
                    items: activeAlbum.viewItems,
                  });
                  setNowPlayingTab('queue');
                  navigate('/now-playing');
                  void playSongById(activeAlbum.orderedSongs[0].id, false);
                  setActiveAlbum(null);
                }}
                className="rounded-full bg-amply-accent px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amply-accentHover"
              >
                Play Album
              </button>
              <button
                type="button"
                onClick={() => setActiveAlbum(null)}
                className="rounded-full border border-amply-border/60 px-4 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default LibraryPage;




