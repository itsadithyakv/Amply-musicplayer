import { usePersistedPreference } from '@/hooks/usePersistedPreference';
import { oneOf } from '@/services/preferences';
import { useEffect, useMemo, useRef, useState, useTransition, type ComponentType } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import { useNavigate } from 'react-router-dom';
import SongList from '@/components/SongList/SongList';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { IconButton, PageHeader, PillButton, SegmentedTabs, UnifiedSearchInput, UnifiedSelectInput } from '@/components/ui/AmplyUI';
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
import { pickPlaylistArtwork } from '@/services/playlistArtworkService';
import { useAlbumArtFrequency } from '@/hooks/useAlbumArtFrequency';
import { useLibraryTabView } from '@/hooks/useLibraryViews';

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
  totalPlays: number;
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
const CARD_GAP = 18;
const CARD_HEIGHT = 244;

const LibraryCardShell = ({ children }: { children: React.ReactNode }) => <div className="h-full [&>*]:h-full">{children}</div>;

const CardGridRow = <T,>({ index, style, data }: ListChildComponentProps<CardGridData<T>>) => {
  const { items, columns, renderItem, getKey } = data;
  const start = index * columns;
  const slice = items.slice(start, start + columns);

  return (
    <div style={{ ...style, paddingBottom: CARD_GAP }}>
      <div className="grid h-full" style={{ gap: CARD_GAP, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {slice.map((item, offset) => (
          <div key={getKey(item, start + offset)}>{renderItem(item)}</div>
        ))}
      </div>
    </div>
  );
};

const buildGenreGroups = (songs: Song[], artworkFor: (songs: Song[]) => string | undefined): GenreGroup[] => {
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

  return [...groups.values()]
    .map((group) => ({
      ...group,
      artwork: group.artwork ?? artworkFor(group.songs),
    }))
    .sort((a, b) => b.totalPlays - a.totalPlays || b.songs.length - a.songs.length || a.label.localeCompare(b.label));
};

const buildArtistGroups = (songs: Song[], artworkFor: (songs: Song[]) => string | undefined): ArtistGroup[] => {
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

  return [...groups.values()]
    .map((group) => ({
      ...group,
      artwork: group.artwork ?? artworkFor(group.songs),
    }))
    .sort((a, b) => b.totalPlays - a.totalPlays || b.songs.length - a.songs.length || a.label.localeCompare(b.label));
};

type AlbumSort = 'title_asc' | 'title_desc' | 'artist_asc' | 'most_played' | 'most_songs';
type ArtistSort = 'name_asc' | 'name_desc' | 'most_played' | 'most_songs';
type GenreSort = 'name_asc' | 'name_desc' | 'most_played' | 'most_songs';

const isLibraryTab = oneOf<LibraryTab>(['songs', 'albums', 'artists', 'genres']);
const isAlbumSort = oneOf<AlbumSort>(['title_asc', 'title_desc', 'artist_asc', 'most_played', 'most_songs']);
const isArtistSort = oneOf<ArtistSort>(['name_asc', 'name_desc', 'most_played', 'most_songs']);
const isGenreSort = oneOf<GenreSort>(['name_asc', 'name_desc', 'most_played', 'most_songs']);

type AlbumEntry = {
  album: string;
  artist: string;
  artwork?: string;
  songs: Song[];
  key: string;
  totalPlays: number;
};

const sortAlbums = (albums: AlbumEntry[], sortBy: AlbumSort): AlbumEntry[] => {
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
  const [isTabPending, startTabTransition] = useTransition();
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
  const metadataFetchPaused = usePlayerStore((state) => state.settings.metadataFetchPaused);

  const [activeTab, setActiveTab] = usePersistedPreference<LibraryTab>('library-tab', isLibraryTab, initialTab);
  const navigate = useNavigate();
  const [albumSort, setAlbumSort] = usePersistedPreference<AlbumSort>('library-sort:albums', isAlbumSort, 'title_asc');
  const [albumQuery, setAlbumQuery] = useState('');
  const [artistSort, setArtistSort] = usePersistedPreference<ArtistSort>('library-sort:artists', isArtistSort, 'name_asc');
  const [artistQuery, setArtistQuery] = useState('');
  const [genreSort, setGenreSort] = usePersistedPreference<GenreSort>('library-sort:genres', isGenreSort, 'name_asc');
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
  const libraryTabView = useLibraryTabView(activeTab);
  const deferredSongs = libraryTabView.songs;
  const activeAlbumSignatureRef = useRef<string | null>(null);
  const shouldBuildAlbums = activeTab === 'albums' || activeAlbum !== null;
  const shouldBuildArtists = activeTab === 'artists';
  const shouldBuildGenres = activeTab === 'genres';
  const shouldBuildArtworkFrequency = shouldBuildAlbums || shouldBuildArtists || shouldBuildGenres;
  const albumArtFrequency = useAlbumArtFrequency(shouldBuildArtworkFrequency ? deferredSongs : []);
  const pickArtwork = useMemo(
    () => (groupSongs: Song[]) => pickPlaylistArtwork(groupSongs, albumArtFrequency),
    [albumArtFrequency],
  );

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
  }, [deferredSongs.length]);

  const albums = useMemo<AlbumEntry[]>(() => {
    if (!shouldBuildAlbums) {
      return [];
    }
    const map = new Map<string, AlbumEntry>();
    for (const song of deferredSongs) {
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
    return [...map.values()].map((entry) => ({
      ...entry,
      artwork: entry.artwork ?? pickArtwork(entry.songs),
    }));
  }, [deferredSongs, shouldBuildAlbums, pickArtwork]);

  const albumsByKey = useMemo(() => new Map(albums.map((album) => [album.key, album])), [albums]);

  useEffect(() => {
    if (!activeAlbum) {
      activeAlbumSignatureRef.current = null;
      return;
    }
    const primaryArtist = getPrimaryArtistName(activeAlbum.artist);
    const albumKey = getAlbumTracklistKey(primaryArtist, activeAlbum.album);
    const matchingSongs = albumsByKey.get(albumKey)?.songs ?? [];
    const normalizedArtist = primaryArtist.trim().toLowerCase();
    const normalizedAlbum = activeAlbum.album.trim().toLowerCase();
    const signature = `${normalizedArtist}::${normalizedAlbum}::${matchingSongs.map((song) => song.id).join('|')}`;
    if (signature === activeAlbumSignatureRef.current) {
      return;
    }
    activeAlbumSignatureRef.current = signature;
    const tracklist = albumTracklists[albumKey] ?? activeAlbum.tracklist ?? null;
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
  }, [albumTracklists, activeAlbum, albumsByKey]);

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
    if (!shouldBuildAlbums) {
      return new Map();
    }
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
  }, [albums, albumTracklists, shouldBuildAlbums]);
  const artists = useMemo(
    () => (shouldBuildArtists ? buildArtistGroups(deferredSongs, pickArtwork) : []),
    [deferredSongs, shouldBuildArtists, pickArtwork],
  );
  const genres = useMemo(
    () => (shouldBuildGenres ? buildGenreGroups(deferredSongs, pickArtwork) : []),
    [deferredSongs, shouldBuildGenres, pickArtwork],
  );

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
        return sorted.sort((a, b) => b.totalPlays - a.totalPlays || b.songs.length - a.songs.length);
      case 'most_songs':
        return sorted.sort((a, b) => b.songs.length - a.songs.length || b.totalPlays - a.totalPlays);
      case 'name_asc':
      default:
        return sorted.sort((a, b) => a.label.localeCompare(b.label));
    }
  }, [genres, genreQuery, genreSort]);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Library" description={`${deferredSongs.length.toLocaleString()} songs indexed`} />

      <div
        className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"
        aria-busy={isTabPending}
      >
        <SegmentedTabs
          tabs={tabs}
          value={activeTab}
          onChange={(tab) => startTabTransition(() => setActiveTab(tab))}
          variant="bare"
          className="w-full justify-between sm:w-auto sm:justify-start"
        />

        {activeTab === 'songs' ? (
          <div className="flex min-w-0 items-center gap-2">
            <input
              value={localPath}
              onChange={(event) => setLocalPath(event.target.value)}
              placeholder="Add folder path..."
              className="hidden min-h-[44px] min-w-[260px] flex-1 rounded-2xl bg-[var(--control-surface)] px-4 py-2.5 text-[13px] text-amply-textPrimary shadow-[inset_0_0_0_1px_var(--control-border)] outline-none transition-colors placeholder:text-amply-textMuted focus:shadow-[inset_0_0_0_1px_rgb(var(--amply-accent))] md:block"
            />
            <IconButton
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
              title="Add music folder"
            >
              <img src={addIcon} alt="" className="ui-icon h-4 w-4" />
            </IconButton>
            <PillButton
              type="button"
              onClick={() => {
                void scanLibrary();
              }}
            >
              {isScanning ? 'Scanning...' : 'Rescan'}
            </PillButton>
          </div>
        ) : null}
      </div>

      {isScanning ? <p className="text-[13px] text-amply-textSecondary">Scanning library...</p> : null}
      {scanError ? <p className="text-[13px] text-red-400">{scanError}</p> : null}

      {activeTab === 'songs' ? <SongList songs={deferredSongs} persistKey="library-songs" /> : null}

      {activeTab === 'albums' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <UnifiedSearchInput
              value={albumQuery}
              onValueChange={setAlbumQuery}
              placeholder="Search albums or artists..."
              className="min-w-0 flex-1"
            />
            <UnifiedSelectInput
              label="Sort"
              value={albumSort}
              onChange={(event) => setAlbumSort(event.target.value as AlbumSort)}
              className="w-full md:w-[260px]"
            >
              {albumSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UnifiedSelectInput>
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
                              isLoading: Boolean(!tracklist && !metadataFetchPaused),
                            });
                            if (!tracklist && !metadataFetchPaused && tryAcquireMetadata('album_tracklist', entry.key)) {
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
                              isLoading: Boolean(!tracklist && !metadataFetchPaused),
                            });
                            if (!tracklist && !metadataFetchPaused && tryAcquireMetadata('album_tracklist', entry.key)) {
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
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <UnifiedSearchInput
              value={artistQuery}
              onValueChange={setArtistQuery}
              placeholder="Search artists..."
              className="min-w-0 flex-1"
            />
            <UnifiedSelectInput
              label="Sort"
              value={artistSort}
              onChange={(event) => setArtistSort(event.target.value as ArtistSort)}
              className="w-full md:w-[260px]"
            >
              {artistSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UnifiedSelectInput>
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
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <UnifiedSearchInput
              value={genreQuery}
              onValueChange={setGenreQuery}
              placeholder="Search genres..."
              className="min-w-0 flex-1"
            />
            <UnifiedSelectInput
              label="Sort"
              value={genreSort}
              onChange={(event) => setGenreSort(event.target.value as GenreSort)}
              className="w-full md:w-[260px]"
            >
              {genreSortOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UnifiedSelectInput>
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
        <div className="ui-modal-backdrop fixed inset-0 z-50 flex items-center justify-center px-4 py-6">
          <div className="ui-soft-card w-full max-w-2xl rounded-[30px] p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-xl bg-amply-bgSecondary">
                  {activeAlbum.artwork ? (
                    <ArtworkImage src={activeAlbum.artwork} alt={activeAlbum.album} className="h-full w-full object-cover" />
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

            <div className="ui-soft-card mt-4 rounded-[30px]">
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
                  const firstSong = activeAlbum.orderedSongs[0];
                  if (!firstSong?.id) {
                    return;
                  }
                  const queue = activeAlbum.orderedSongs.map((song) => song.id).filter(Boolean);
                  if (!queue.length) {
                    return;
                  }
                  setQueue(queue, firstSong.id);
                  setAlbumQueueView({
                    album: activeAlbum.album,
                    artist: activeAlbum.artist,
                    items: activeAlbum.viewItems,
                  });
                  setNowPlayingTab('queue');
                  navigate('/now-playing');
                  void playSongById(firstSong.id, false);
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




