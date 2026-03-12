import { useMemo, useState } from 'react';
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

const PlaylistComposer = ({ songs, onSave, onCancel }: PlaylistComposerProps) => {
  const [playlistName, setPlaylistName] = useState('');
  const [playlistDescription, setPlaylistDescription] = useState('');
  const [playlistArtwork, setPlaylistArtwork] = useState<string | undefined>(undefined);
  const [playlistSongQuery, setPlaylistSongQuery] = useState('');
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const [playlistError, setPlaylistError] = useState<string | null>(null);

  const composerSongs = useMemo(() => {
    const query = playlistSongQuery.trim().toLowerCase();
    const filtered = query
      ? songs.filter((song) => `${song.title} ${song.artist} ${song.album}`.toLowerCase().includes(query))
      : songs;

    return filtered.slice(0, 300);
  }, [playlistSongQuery, songs]);

  const togglePlaylistSong = (songId: string) => {
    setSelectedSongIds((current) => (current.includes(songId) ? current.filter((id) => id !== songId) : [...current, songId]));
  };

  return (
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
                <span className="truncate pr-2">
                  {song.title} - {song.artist}
                </span>
                <span>{selected ? '✓' : '+'}</span>
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
