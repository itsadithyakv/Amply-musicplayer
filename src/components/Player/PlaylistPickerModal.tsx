import { useRef, useState } from 'react';
import { Button, Kicker, Modal, TextInput } from '@/components/ui';
import type { Playlist, Song } from '@/types/music';

interface PlaylistPickerModalProps {
  open: boolean;
  onClose: () => void;
  song: Song | null | undefined;
  playlists: Playlist[];
  onAddToPlaylist: (playlistId: string, songId: string) => Promise<void>;
  onCreatePlaylist: (playlist: Playlist) => Promise<void>;
  /** Short status line shown in the player bar after an action. */
  onMessage: (message: string) => void;
}

/** "Add to playlist" dialog: quick-create row plus the list of custom playlists. */
export const PlaylistPickerModal = ({ open, onClose, song, playlists, onAddToPlaylist, onCreatePlaylist, onMessage }: PlaylistPickerModalProps) => {
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const createPlaylist = async () => {
    if (!song) {
      return;
    }
    const name = newPlaylistName.trim();
    if (!name) {
      return;
    }
    await onCreatePlaylist({
      id: `custom_${Date.now()}`,
      name,
      type: 'custom',
      description: 'User playlist',
      songIds: [song.id],
      updatedAt: Math.floor(Date.now() / 1000),
    });
    setNewPlaylistName('');
    onClose();
    onMessage(`Created ${name}`);
  };

  return (
    <Modal open={open} onClose={onClose} title="Add to playlist" size="sm" initialFocusRef={inputRef}>
      <div className="space-y-2">
        <Kicker>Quick create</Kicker>
        <div className="flex items-center gap-2">
          <TextInput
            ref={inputRef}
            className="flex-1"
            size="sm"
            value={newPlaylistName}
            onValueChange={setNewPlaylistName}
            placeholder="New playlist name"
          />
          <Button variant="primary" size="sm" onClick={() => void createPlaylist()} disabled={!song || !newPlaylistName.trim()}>
            Create
          </Button>
        </div>
      </div>

      <div className="mt-4 max-h-64 space-y-1 overflow-y-auto pr-1">
        {playlists.length ? (
          playlists.map((playlist) => {
            const inPlaylist = Boolean(song && playlist.songIds.includes(song.id));
            return (
              <button
                key={playlist.id}
                type="button"
                onClick={async () => {
                  if (!song) {
                    return;
                  }
                  if (inPlaylist) {
                    onMessage(`Already in ${playlist.name}`);
                  } else {
                    await onAddToPlaylist(playlist.id, song.id);
                    onMessage(`Added to ${playlist.name}`);
                  }
                  onClose();
                }}
                className="neu-flat neu-interactive flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-[12px] text-amply-textSecondary hover:text-amply-textPrimary"
              >
                <span className="truncate">{playlist.name}</span>
                <span className="shrink-0 text-[12px] text-amply-textMuted">{inPlaylist ? 'Added' : playlist.songIds.length}</span>
              </button>
            );
          })
        ) : (
          <p className="px-2 py-2 text-[12px] text-amply-textMuted">No playlists yet.</p>
        )}
      </div>
    </Modal>
  );
};
