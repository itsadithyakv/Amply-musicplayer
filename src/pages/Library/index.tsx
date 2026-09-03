import { usePersistedPreference } from '@/hooks/usePersistedPreference';
import { oneOf } from '@/services/preferences';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useNavigate } from 'react-router-dom';
import SongList from '@/components/SongList/SongList';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { Button, IconButton, PageHeader, ProgressBar, SearchInput, SegmentedTabs, Select, TextInput } from '@/components/ui';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { LibraryTab, Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';
import { pickMusicFolders } from '@/services/storageService';
import {
  getAlbumTracklistKey,
  loadAlbumTracklist,
  loadAlbumTracklistCache,
  type AlbumTracklist,
} from '@/services/albumTracklistService';
import { releaseMetadata, tryAcquireMetadata } from '@/services/metadataAttemptService';
import { pickPlaylistArtwork } from '@/services/playlistArtworkService';
import { useAlbumArtFrequency } from '@/hooks/useAlbumArtFrequency';
import { useLibraryTabView } from '@/hooks/useLibraryViews';
import { LibraryCardGrid } from './LibraryCardGrid';
import { AlbumDetailModal, type ActiveAlbum } from './AlbumDetailModal';
import {
  albumSortOptions,
  artistSortOptions,
  buildAlbumTrackMatches,
  buildArtistGroups,
  buildGenreGroups,
  genreSortOptions,
  isAlbumSort,
  isArtistSort,
  isGenreSort,
  sortAlbums,
  sortGroups,
  type AlbumEntry,
  type AlbumSort,
  type AlbumTrackMatches,
  type ArtistSort,
  type GenreSort,
  type SongGroup,
} from './libraryGroups';

const tabs: Array<{ label: string; value: LibraryTab }> = [
  { label: 'Songs', value: 'songs' },
  { label: 'Albums', value: 'albums' },
  { label: 'Artists', value: 'artists' },
  { label: 'Genres', value: 'genres' },
];

interface LibraryPageProps {
  initialTab?: LibraryTab;
}

const isLibraryTab = oneOf<LibraryTab>(['songs', 'albums', 'artists', 'genres']);

type AlbumSummary = AlbumTrackMatches & { tracklist: AlbumTracklist | null };

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
  const [activeAlbum, setActiveAlbum] = useState<ActiveAlbum | null>(null);
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
            ...matches,
            songs: matchingSongs,
            tracklist,
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
    const map = new Map<string, AlbumSummary>();
    if (!shouldBuildAlbums) {
      return map;
    }
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
    const matches = query ? artists.filter((artist) => artist.label.toLowerCase().includes(query)) : artists;
    return sortGroups(matches, artistSort);
  }, [artists, artistQuery, artistSort]);

  const filteredGenres = useMemo(() => {
    const query = genreQuery.trim().toLowerCase();
    const matches = query ? genres.filter((genre) => genre.label.toLowerCase().includes(query)) : genres;
    return sortGroups(matches, genreSort);
  }, [genres, genreQuery, genreSort]);

  /** Opens the album detail modal and, if no tracklist is cached, fetches one in the background. */
  const openAlbum = useCallback(
    (entry: AlbumEntry) => {
      const cached = albumSummaries.get(entry.key);
      const tracklist = cached?.tracklist ?? null;
      const matches = cached ?? buildAlbumTrackMatches(entry.songs, tracklist);
      setActiveAlbum({
        album: entry.album,
        artist: getPrimaryArtistName(entry.artist),
        songs: entry.songs,
        tracklist,
        total: matches.total,
        available: matches.available,
        missing: matches.missing,
        orderedSongs: matches.orderedSongs,
        viewItems: matches.viewItems,
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
            const fetched = buildAlbumTrackMatches(entry.songs, result);
            setActiveAlbum((prev) =>
              prev
                ? {
                    ...prev,
                    ...fetched,
                    tracklist: result,
                    isLoading: false,
                  }
                : prev,
            );
          } finally {
            releaseMetadata('album_tracklist', entry.key);
          }
        })();
      }
    },
    [albumSummaries, metadataFetchPaused],
  );

  const playGroup = useCallback(
    (group: SongGroup) => {
      const groupSongs = group.songs;
      if (!groupSongs.length) {
        return;
      }
      const queue = groupSongs.map((item) => item.id);
      setQueue(queue, groupSongs[0].id);
      void playSongById(groupSongs[0].id, false);
    },
    [playSongById, setQueue],
  );

  const playActiveAlbum = useCallback(() => {
    if (!activeAlbum?.orderedSongs.length) {
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
  }, [activeAlbum, navigate, playSongById, setAlbumQueueView, setNowPlayingTab, setQueue]);

  const closeAlbum = useCallback(() => setActiveAlbum(null), []);

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Library" description={`${deferredSongs.length.toLocaleString()} songs indexed`} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between" aria-busy={isTabPending}>
        <SegmentedTabs
          tabs={tabs}
          value={activeTab}
          onChange={(tab) => startTabTransition(() => setActiveTab(tab))}
          variant="bare"
          ariaLabel="Library sections"
          className="w-full justify-between sm:w-auto sm:justify-start"
        />

        {activeTab === 'songs' ? (
          <div className="flex min-w-0 items-center gap-2">
            <TextInput
              value={localPath}
              onValueChange={setLocalPath}
              icon="folder"
              placeholder="Add folder path..."
              className="hidden min-w-[260px] flex-1 md:flex"
            />
            <IconButton
              name="add"
              label="Add music folder"
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
            />
            <Button
              variant="secondary"
              icon="refresh"
              onClick={() => {
                void scanLibrary();
              }}
            >
              {isScanning ? 'Scanning...' : 'Rescan'}
            </Button>
          </div>
        ) : null}
      </div>

      {isScanning ? (
        <div className="space-y-2">
          <ProgressBar indeterminate ariaLabel="Scanning library" />
          <p className="text-[13px] text-amply-textSecondary">Scanning library...</p>
        </div>
      ) : null}
      {scanError ? <p className="text-[13px] text-amply-danger">{scanError}</p> : null}

      {activeTab === 'songs' ? <SongList songs={deferredSongs} persistKey="library-songs" /> : null}

      {activeTab === 'albums' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <SearchInput
              value={albumQuery}
              onValueChange={setAlbumQuery}
              placeholder="Search albums or artists..."
              className="min-w-0 flex-1"
            />
            <Select
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
            </Select>
          </div>

          <LibraryCardGrid
            items={filteredAlbums}
            getKey={(entry) => entry.key}
            renderItem={(entry) => {
              const summary = albumSummaries.get(entry.key);
              const meta = summary?.tracklist ? `${summary.available}/${summary.total} tracks` : `${entry.songs.length} tracks`;
              return (
                <AlbumCard
                  title={entry.album}
                  subtitle={entry.artist}
                  artwork={entry.artwork}
                  meta={meta}
                  onClick={() => openAlbum(entry)}
                  onInfo={() => openAlbum(entry)}
                />
              );
            }}
          />
        </div>
      ) : null}

      {activeTab === 'artists' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <SearchInput value={artistQuery} onValueChange={setArtistQuery} placeholder="Search artists..." className="min-w-0 flex-1" />
            <Select
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
            </Select>
          </div>

          <LibraryCardGrid
            items={filteredArtists}
            getKey={(entry) => entry.label.toLowerCase()}
            renderItem={(artistGroup) => (
              <AlbumCard
                title={artistGroup.label}
                subtitle={`${artistGroup.songs.length} songs`}
                artwork={artistGroup.artwork}
                onClick={() => playGroup(artistGroup)}
              />
            )}
          />
        </div>
      ) : null}

      {activeTab === 'genres' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <SearchInput value={genreQuery} onValueChange={setGenreQuery} placeholder="Search genres..." className="min-w-0 flex-1" />
            <Select
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
            </Select>
          </div>

          <LibraryCardGrid
            items={filteredGenres}
            getKey={(entry) => entry.label.toLowerCase()}
            renderItem={(genreGroup) => (
              <AlbumCard
                title={genreGroup.label}
                subtitle={`${genreGroup.songs.length} songs`}
                artwork={genreGroup.artwork}
                onClick={() => playGroup(genreGroup)}
              />
            )}
          />
        </div>
      ) : null}

      <AlbumDetailModal album={activeAlbum} onClose={closeAlbum} onPlay={playActiveAlbum} />
    </div>
  );
};

export default LibraryPage;
