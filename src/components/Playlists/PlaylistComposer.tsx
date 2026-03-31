import { memo, useMemo, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import type { Playlist, Song } from '@/types/music';

interface PlaylistComposerProps {
  songs: Song[];
  onSave: (playlist: Playlist) => void | Promise<void>;
  onCancel: () => void;
}

const toDataUrl = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
};

interface PlaylistSongRowData {
  songs: Song[];
  selectedSongIds: string[];
  togglePlaylistSong: (songId: string) => void;
}

const PlaylistSongRow = memo(({ index, style, data }: ListChildComponentProps<PlaylistSongRowData>) => {
  const song = data.songs[index];
  if (!song) {
    return null;
  }
  const selected = data.selectedSongIds.includes(song.id);

  return (
    <div
      style={style}
      className="flex min-w-0 items-center justify-between rounded-md px-3 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
    >
      <div className="min-w-0">
        <p className="truncate text-[13px] text-amply-textPrimary">{song.title}</p>
        <p className="truncate text-[11px] text-amply-textMuted">
          {song.artist} â€¢ {song.album}
        </p>
      </div>
      <button
        type="button"
        onClick={() => data.togglePlaylistSong(song.id)}
        className={`rounded-md border px-3 py-1 text-[11px] transition-colors ${
          selected
            ? 'border-amply-accent text-amply-accent'
            : 'border-amply-border text-amply-textSecondary hover:bg-amply-hover'
        }`}
      >
        {selected ? 'Added' : 'Add'}
      </button>
    </div>
  );
});

const PlaylistComposer = ({ songs, onSave, onCancel }: PlaylistComposerProps) => {
  const [playlistName, setPlaylistName] = useState('');
  const [playlistDescription, setPlaylistDescription] = useState('');
  const [playlistArtwork, setPlaylistArtwork] = useState<string | undefined>(undefined);
  const [playlistSongQuery, setPlaylistSongQuery] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'favorites' | 'recent' | 'most_played'>('all');
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const composerSongs = useMemo(() => {
    const query = playlistSongQuery.trim().toLowerCase();
    let filtered = [...songs];

    if (filterTab === 'favorites') {
      filtered = filtered.filter((song) => song.favorite);
    } else if (filterTab === 'recent') {
      filtered = filtered.sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
    } else if (filterTab === 'most_played') {
      filtered = filtered.sort((a, b) => b.playCount - a.playCount);
    }

    if (query) {
      filtered = filtered.filter((song) => `${song.title} ${song.artist} ${song.album}`.toLowerCase().includes(query));
    }

    return filtered.slice(0, 300);
  }, [playlistSongQuery, songs, filterTab]);

  const selectedSongs = useMemo(() => {
    const map = new Map(songs.map((song) => [song.id, song]));
    return selectedSongIds.map((id) => map.get(id)).filter(Boolean) as Song[];
  }, [selectedSongIds, songs]);

  const togglePlaylistSong = (songId: string) => {
    setSelectedSongIds((current) => (current.includes(songId) ? current.filter((id) => id !== songId) : [...current, songId]));
  };

  const rowData = useMemo(
    () => ({
      songs: composerSongs,
      selectedSongIds,
      togglePlaylistSong,
    }),
    [composerSongs, selectedSongIds, togglePlaylistSong],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="rounded-lg border border-amply-border bg-amply-bgSecondary p-4">
            <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Playlist Details</p>
            <div className="mt-3 flex items-start gap-4">
              <div className="h-24 w-24 overflow-hidden rounded-md border border-amply-border bg-zinc-900">
                {playlistArtwork ? <ArtworkImage src={playlistArtwork} alt="Playlist cover" className="h-full w-full object-cover" /> : null}
              </div>
              <div className="flex-1 space-y-2">
                <label className="space-y-1">
                  <span className="text-[12px] text-amply-textMuted">Playlist Name</span>
                  <input
                    value={playlistName}
                    onChange={(event) => setPlaylistName(event.target.value)}
                    placeholder="Enter playlist name"
                    className="w-full rounded-lg border border-amply-border bg-amply-bgPrimary px-3 py-2 text-[13px] text-amply-textPrimary outline-none focus:border-amply-accent"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-[12px] text-amply-textMuted">Description</span>
                  <input
                    value={playlistDescription}
                    onChange={(event) => setPlaylistDescription(event.target.value)}
                    placeholder="Short description"
                    className="w-full rounded-lg border border-amply-border bg-amply-bgPrimary px-3 py-2 text-[13px] text-amply-textPrimary outline-none focus:border-amply-accent"
                  />
                </label>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <label className="rounded-md border border-amply-border px-3 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover">
                Choose Cover
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
              <span className="text-[12px] text-amply-textMuted">{selectedSongIds.length} songs</span>
            </div>
          </div>

          <div className="rounded-lg border border-amply-border bg-amply-bgSecondary p-4">
            <div className="flex items-center justify-between">
              <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Selected</p>
              <button
                type="button"
                onClick={() => setSelectedSongIds([])}
                className="text-[11px] text-amply-textMuted hover:text-amply-textPrimary"
              >
                Clear
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {selectedSongs.length ? (
                selectedSongs.map((song) => (
                  <div key={`selected-${song.id}`} className="flex items-center justify-between rounded-md border border-amply-border px-3 py-2 text-[12px] text-amply-textSecondary">
                    <span className="truncate pr-2">{song.title} - {song.artist}</span>
                    <button
                      type="button"
                      onClick={() => togglePlaylistSong(song.id)}
                      className="rounded-md border border-amply-border px-2 py-1 text-[11px] text-amply-textSecondary hover:bg-amply-hover"
                    >
                      Remove
                    </button>
                  </div>
                ))
              ) : (
                <p className="text-[12px] text-amply-textMuted">No songs selected yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-3">
          <div className="rounded-lg border border-amply-border bg-amply-bgSecondary p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[13px] font-medium text-amply-textPrimary">Add to playlist</p>
                <p className="text-[12px] text-amply-textMuted">Search your library and add tracks.</p>
              </div>
              <input
                value={playlistSongQuery}
                onChange={(event) => setPlaylistSongQuery(event.target.value)}
                placeholder="Search songs or artists"
                className="w-full max-w-xs rounded-lg border border-amply-border bg-amply-bgPrimary px-3 py-2 text-[12px] text-amply-textPrimary outline-none focus:border-amply-accent"
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'All' },
                { id: 'favorites', label: 'Favorites' },
                { id: 'recent', label: 'Recently Added' },
                { id: 'most_played', label: 'Most Played' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id as typeof filterTab)}
                  className={`rounded-full border px-3 py-1 text-[11px] transition-colors ${
                    filterTab === tab.id
                      ? 'border-amply-accent bg-amply-accent text-black'
                      : 'border-amply-border text-amply-textSecondary hover:bg-amply-hover'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-80 rounded-lg border border-amply-border bg-amply-bgSecondary p-2">
            <AutoSizer>
              {({ height, width }) => (
                <List
                  height={height}
                  width={width}
                  itemCount={composerSongs.length}
                  itemSize={56}
                  itemData={rowData}
                  overscanCount={6}
                >
                  {PlaylistSongRow}
                </List>
              )}
            </AutoSizer>
          </div>
        </div>
      </div>

      

      {playlistError ? <p className="mt-3 text-[12px] text-red-400">{playlistError}</p> : null}

      <div className="mt-4 flex gap-2">
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

            void onSave(playlist);
          }}
          className="rounded-lg bg-amply-accent px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover"
        >
          Save Playlist
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-amply-border px-4 py-2 text-[13px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default PlaylistComposer;


