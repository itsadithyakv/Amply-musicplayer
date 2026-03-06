import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SongList from '@/components/SongList/SongList';
import AlbumCard from '@/components/AlbumCard/AlbumCard';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { LibraryTab, Playlist, Song } from '@/types/music';
import { splitArtistNames } from '@/utils/artists';

const tabs: Array<{ label: string; value: LibraryTab }> = [
  { label: 'Songs', value: 'songs' },
  { label: 'Albums', value: 'albums' },
  { label: 'Artists', value: 'artists' },
  { label: 'Genres', value: 'genres' },
  { label: 'Playlists', value: 'playlists' },
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

const toDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
};

const LibraryPage = ({ initialTab = 'songs' }: LibraryPageProps) => {
  const songs = useLibraryStore((state) => state.songs);
  const playlists = useLibraryStore((state) => state.playlists);
  const isScanning = useLibraryStore((state) => state.isScanning);
  const scanError = useLibraryStore((state) => state.scanError);
  const upsertCustomPlaylist = useLibraryStore((state) => state.upsertCustomPlaylist);
  const navigate = useNavigate();

  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);

  const [activeTab, setActiveTab] = useState<LibraryTab>(initialTab);

  const [showPlaylistComposer, setShowPlaylistComposer] = useState(false);
  const [playlistName, setPlaylistName] = useState('');
  const [playlistDescription, setPlaylistDescription] = useState('');
  const [playlistArtwork, setPlaylistArtwork] = useState<string | undefined>(undefined);
  const [playlistSongQuery, setPlaylistSongQuery] = useState('');
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const albums = useMemo(() => getRepresentativeSongs(songs, 'album'), [songs]);
  const artists = useMemo(() => buildArtistGroups(songs), [songs]);
  const genres = useMemo(() => buildGenreGroups(songs), [songs]);

  const composerSongs = useMemo(() => {
    const query = playlistSongQuery.trim().toLowerCase();
    const filtered = query
      ? songs.filter((song) => `${song.title} ${song.artist} ${song.album}`.toLowerCase().includes(query))
      : songs;

    return filtered.slice(0, 300);
  }, [playlistSongQuery, songs]);

  const getPlaylistArtwork = (playlist: Playlist): string | undefined => {
    if (playlist.artwork) {
      return playlist.artwork;
    }

    const firstSong = songs.find((song) => playlist.songIds.includes(song.id));
    return firstSong?.albumArt;
  };

  const togglePlaylistSong = (songId: string) => {
    setSelectedSongIds((current) => (current.includes(songId) ? current.filter((id) => id !== songId) : [...current, songId]));
  };

  const resetComposer = () => {
    setPlaylistName('');
    setPlaylistDescription('');
    setPlaylistArtwork(undefined);
    setPlaylistSongQuery('');
    setSelectedSongIds([]);
    setPlaylistError(null);
    setShowPlaylistComposer(false);
  };

  const openPlaylistQueue = (playlistSongIds: string[], startSongId?: string) => {
    const queue = playlistSongIds.filter((songId) => songs.some((song) => song.id === songId));
    const fallbackSongId = queue[0];
    const targetSongId = startSongId && queue.includes(startSongId) ? startSongId : fallbackSongId;

    if (!targetSongId) {
      return;
    }

    setQueue(queue, targetSongId);
    setNowPlayingTab('queue');
    navigate('/now-playing');
  };

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

      {activeTab === 'songs' ? <SongList songs={songs} /> : null}

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

      {activeTab === 'playlists' ? (
        <div className="space-y-4">
          <div className="rounded-card border border-amply-border bg-amply-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[18px] font-bold text-amply-textPrimary">Playlists</p>
                <p className="text-[13px] text-amply-textSecondary">Create custom playlists with your own cover image and description.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowPlaylistComposer((current) => !current)}
                className="rounded-lg bg-amply-accent px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover"
              >
                {showPlaylistComposer ? 'Close' : 'New Playlist'}
              </button>
            </div>

            {showPlaylistComposer ? (
              <div className="mt-4 space-y-4 border-t border-amply-border pt-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-[12px] text-amply-textMuted">Playlist Name</span>
                    <input
                      value={playlistName}
                      onChange={(event) => setPlaylistName(event.target.value)}
                      placeholder="Enter playlist name"
                      className="w-full rounded-lg border border-amply-border bg-amply-bgSecondary px-3 py-2 text-[13px] text-amply-textPrimary outline-none focus:border-amply-accent"
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[12px] text-amply-textMuted">Description</span>
                    <input
                      value={playlistDescription}
                      onChange={(event) => setPlaylistDescription(event.target.value)}
                      placeholder="Short description"
                      className="w-full rounded-lg border border-amply-border bg-amply-bgSecondary px-3 py-2 text-[13px] text-amply-textPrimary outline-none focus:border-amply-accent"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="rounded-md border border-amply-border px-3 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover">
                    Pick Cover Image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (!file) {
                          return;
                        }

                        void toDataUrl(file)
                          .then((dataUrl) => {
                            setPlaylistArtwork(dataUrl);
                            setPlaylistError(null);
                          })
                          .catch(() => {
                            setPlaylistError('Could not load the selected image.');
                          });
                      }}
                    />
                  </label>
                  {playlistArtwork ? (
                    <div className="h-14 w-14 overflow-hidden rounded-md border border-amply-border">
                      <img src={playlistArtwork} alt="Playlist cover" className="h-full w-full object-cover" />
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[13px] font-medium text-amply-textPrimary">Songs in playlist ({selectedSongIds.length})</p>
                    <input
                      value={playlistSongQuery}
                      onChange={(event) => setPlaylistSongQuery(event.target.value)}
                      placeholder="Filter songs"
                      className="w-56 rounded-lg border border-amply-border bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none focus:border-amply-accent"
                    />
                  </div>

                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-amply-border bg-amply-bgSecondary p-2">
                    {composerSongs.map((song) => {
                      const selected = selectedSongIds.includes(song.id);
                      return (
                        <button
                          key={`playlist-song-${song.id}`}
                          type="button"
                          onClick={() => togglePlaylistSong(song.id)}
                          className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-[12px] transition-colors ${
                            selected ? 'bg-amply-hover text-amply-textPrimary' : 'text-amply-textSecondary hover:bg-amply-hover'
                          }`}
                        >
                          <span className="truncate pr-2">{song.title} - {song.artist}</span>
                          <span>{selected ? '?' : '+'}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {playlistError ? <p className="text-[12px] text-red-400">{playlistError}</p> : null}

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const name = playlistName.trim();
                      if (!name) {
                        setPlaylistError('Playlist name is required.');
                        return;
                      }

                      if (!selectedSongIds.length) {
                        setPlaylistError('Select at least one song for the playlist.');
                        return;
                      }

                      const playlist: Playlist = {
                        id: `custom_${Date.now()}`,
                        name,
                        type: 'custom',
                        description: playlistDescription.trim() || 'Custom playlist',
                        artwork: playlistArtwork,
                        songIds: selectedSongIds,
                        updatedAt: Math.floor(Date.now() / 1000),
                      };

                      void upsertCustomPlaylist(playlist).then(() => {
                        resetComposer();
                      });
                    }}
                    className="rounded-lg bg-amply-accent px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover"
                  >
                    Save Playlist
                  </button>
                  <button
                    type="button"
                    onClick={resetComposer}
                    className="rounded-lg border border-amply-border px-4 py-2 text-[13px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            {playlists.map((playlist) => {
              const firstSong = songs.find((song) => playlist.songIds.includes(song.id));
              const artwork = getPlaylistArtwork(playlist);

              return (
                <div
                  key={playlist.id}
                  onDoubleClick={(event) => {
                    if ((event.target as HTMLElement).closest('[data-play-button="true"]')) {
                      return;
                    }

                    openPlaylistQueue(playlist.songIds, firstSong?.id);
                  }}
                  className="rounded-card border border-amply-border bg-amply-card p-4 transition-colors hover:bg-[#1d1d1d]"
                  title="Double-click to open queue"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-zinc-800">
                        {artwork ? <img src={artwork} alt={playlist.name} className="h-full w-full object-cover" /> : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-[18px] font-bold text-amply-textPrimary">{playlist.name}</p>
                        <p className="truncate text-[13px] text-amply-textSecondary">{playlist.description}</p>
                        <p className="text-[12px] text-amply-textMuted">{playlist.songIds.length} songs - double-click for queue</p>
                      </div>
                    </div>
                    <button
                      data-play-button="true"
                      type="button"
                      onClick={() => {
                        if (!playlist.songIds.length || !firstSong) {
                          return;
                        }
                        setQueue(playlist.songIds, firstSong.id);
                        void playSongById(firstSong.id, false);
                      }}
                      className="rounded-full bg-amply-accent px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover"
                    >
                      Play
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default LibraryPage;




