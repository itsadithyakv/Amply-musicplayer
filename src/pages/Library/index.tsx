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

const LibraryPage = ({ initialTab = 'songs' }: LibraryPageProps) => {
  const songs = useLibraryStore((state) => state.songs);
  const isScanning = useLibraryStore((state) => state.isScanning);
  const scanError = useLibraryStore((state) => state.scanError);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);

  const [activeTab, setActiveTab] = useState<LibraryTab>(initialTab);

  const albums = useMemo(() => getRepresentativeSongs(songs, 'album'), [songs]);
  const artists = useMemo(() => buildArtistGroups(songs), [songs]);
  const genres = useMemo(() => buildGenreGroups(songs), [songs]);

  return (
    <div className="space-y-6 pb-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-amply-textPrimary">Library</h1>
        <p className="text-[13px] text-amply-textSecondary">{songs.length.toLocaleString()} songs indexed</p>
      </header>

      <div className="flex gap-2 rounded-lg border border-amply-border bg-amply-card p-2">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setActiveTab(tab.value)}
            className={`rounded-md px-4 py-2 text-[13px] transition-colors ${
              activeTab === tab.value ? 'bg-amply-hover text-amply-textPrimary' : 'text-amply-textSecondary hover:bg-amply-hover'
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
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          {albums.map((song) => (
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
      ) : null}

      {activeTab === 'artists' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          {artists.map((artistGroup) => (
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
      ) : null}

      {activeTab === 'genres' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
          {genres.map((genreGroup) => (
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
      ) : null}

    </div>
  );
};

export default LibraryPage;




