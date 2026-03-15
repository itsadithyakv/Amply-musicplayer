import { useMemo, useState } from 'react';
import SongList from '@/components/SongList/SongList';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { LibraryTab, Song } from '@/types/music';
import { splitArtistNames } from '@/utils/artists';

const tabs: Array<{ label: string; value: LibraryTab }> = [
  { label: 'Songs', value: 'songs' },
  { label: 'Albums', value: 'albums' },
  { label: 'Artists', value: 'artists' },
  { label: 'Genres', value: 'genres' },
];

interface LibraryPageProps {
  initialTab?: LibraryTab;
}

const getRepresentativeSongs = (songs: Song[], key: keyof Song): Song[] => {
  const map = new Map<string, Song>();
  for (const song of songs) {
    const group = String(song[key] || 'Unknown');
    if (!map.has(group)) {
      map.set(group, song);
    }
  }
  return [...map.values()];
};

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

const buildGenreGroups = (songs: Song[]): GenreGroup[] => {
  const groups = new Map<string, GenreGroup>();

  for (const song of songs) {
    const label = song.genre?.trim() || 'Unknown Genre';
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

type AlbumSort = 'title_asc' | 'title_desc' | 'artist_asc' | 'most_played';
type ArtistSort = 'name_asc' | 'name_desc' | 'most_played' | 'most_songs';
type GenreSort = 'name_asc' | 'name_desc' | 'most_played' | 'most_songs';

const sortAlbums = (albums: Song[], sortBy: AlbumSort): Song[] => {
  const sorted = [...albums];
  switch (sortBy) {
    case 'title_desc':
      return sorted.sort((a, b) => b.album.localeCompare(a.album) || a.artist.localeCompare(b.artist));
    case 'artist_asc':
      return sorted.sort((a, b) => a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));
    case 'most_played':
      return sorted.sort((a, b) => b.playCount - a.playCount || a.album.localeCompare(b.album));
    case 'title_asc':
    default:
      return sorted.sort((a, b) => a.album.localeCompare(b.album) || a.artist.localeCompare(b.artist));
  }
};

const albumSortOptions: Array<{ label: string; value: AlbumSort }> = [
  { label: 'Album (A-Z)', value: 'title_asc' },
  { label: 'Album (Z-A)', value: 'title_desc' },
  { label: 'Artist (A-Z)', value: 'artist_asc' },
  { label: 'Most Played', value: 'most_played' },
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
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);

  const [activeTab, setActiveTab] = useState<LibraryTab>(initialTab);
  const [albumSort, setAlbumSort] = useState<AlbumSort>('title_asc');
  const [albumQuery, setAlbumQuery] = useState('');
  const [artistSort, setArtistSort] = useState<ArtistSort>('name_asc');
  const [artistQuery, setArtistQuery] = useState('');
  const [genreSort, setGenreSort] = useState<GenreSort>('name_asc');
  const [genreQuery, setGenreQuery] = useState('');

  const albums = useMemo(() => getRepresentativeSongs(songs, 'album'), [songs]);
  const filteredAlbums = useMemo(() => {
    const query = albumQuery.trim().toLowerCase();
    if (!query) {
      return sortAlbums(albums, albumSort);
    }

    const matches = albums.filter((song) => {
      const album = song.album?.toLowerCase() ?? '';
      const artist = song.artist?.toLowerCase() ?? '';
      return album.includes(query) || artist.includes(query);
    });

    return sortAlbums(matches, albumSort);
  }, [albums, albumQuery, albumSort]);
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
    <div className="space-y-6 pb-10">
      <header className="space-y-1">
        <h1 className="text-[30px] font-bold tracking-tight text-amply-textPrimary">Library</h1>
        <p className="text-[13px] text-amply-textSecondary">{songs.length.toLocaleString()} songs indexed</p>
      </header>

      <div className="flex gap-2 rounded-xl border border-amply-border/60 bg-amply-surface p-2">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={`rounded-lg px-4 py-2 text-[13px] transition-colors ${
              activeTab === tab.value
                ? 'bg-amply-hover text-amply-textPrimary shadow-glow'
                : 'text-amply-textSecondary hover:bg-amply-hover'
            }`}
          >
            {tab.label}
          </button>
        ))}
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

          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-6">
            {filteredAlbums.map((song) => (
            <AlbumCard
              key={`album-${song.album}`}
              title={song.album}
              subtitle={song.artist}
              artwork={song.albumArt}
              onClick={() => {
                const albumSongs = songs.filter((item) => item.album === song.album);
                if (!albumSongs.length) {
                  return;
                }
                const queue = albumSongs.map((item) => item.id);
                setQueue(queue, albumSongs[0].id);
                void playSongById(albumSongs[0].id, false);
              }}
            />
          ))}
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

          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-6">
            {filteredArtists.map((artistGroup) => (
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
          ))}
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

          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-6">
            {filteredGenres.map((genreGroup) => (
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
          ))}
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default LibraryPage;




