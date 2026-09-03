import { shuffle } from '@/utils/random';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SongList from '@/components/SongList/SongList';
import { Badge, Button, Card, ConfirmDialog, IconButton, Kicker, Meta, Modal } from '@/components/ui';
import { PlaylistArtworkCollage } from '@/components/Playlists/PlaylistArtworkCollage';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaylistDetailView } from '@/hooks/useLibraryViews';

const PlaylistComposer = lazy(() => import('@/components/Playlists/PlaylistComposer'));

const formatPlaylistLength = (totalSeconds: number): string => {
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
};

const PlaylistDetailPage = () => {
  const { playlistId } = useParams();
  const recordPlaylistUse = useLibraryStore((state) => state.recordPlaylistUse);
  const songs = useLibraryStore((state) => state.songs);
  const upsertCustomPlaylist = useLibraryStore((state) => state.upsertCustomPlaylist);
  const deleteCustomPlaylist = useLibraryStore((state) => state.deleteCustomPlaylist);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setShuffleEnabled = usePlayerStore((state) => state.setShuffleEnabled);
  const navigate = useNavigate();
  const { playlist, playlistSongs, playlistIds, artworkSet } = usePlaylistDetailView(playlistId);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const totalLength = useMemo(
    () => formatPlaylistLength(playlistSongs.reduce((total, song) => total + (Number.isFinite(song.duration) ? song.duration : 0), 0)),
    [playlistSongs],
  );

  if (!playlist) {
    return (
      <div className="space-y-4 pb-8">
        <IconButton name="chevron-left" label="Back to playlists" variant="flat" onClick={() => navigate('/playlists')} />
        <Card padding="lg" className="text-[13px] text-amply-textSecondary">Playlist not found.</Card>
      </div>
    );
  }

  const isCustom = playlist.type === 'custom';

  const handlePlayPlaylist = () => {
    if (!playlistSongs.length) {
      return;
    }
    const first = playlistSongs[0];
    if (!first) {
      return;
    }
    setQueue(playlistIds, first.id, { playlistId: playlist.id });
    setShuffleEnabled(false);
    void playSongById(first.id, false);
    void recordPlaylistUse(playlist.id);
  };

  const handleShufflePlaylist = () => {
    if (playlistIds.length === 0) {
      return;
    }
    const shuffled = shuffle(playlistIds);
    setQueue(shuffled, shuffled[0], { playlistId: playlist.id });
    setShuffleEnabled(true);
    void playSongById(shuffled[0], false);
    void recordPlaylistUse(playlist.id);
  };

  return (
    <div className="anim-stagger space-y-6 pb-8">
      <Card as="header" padding="lg" radius="lg" className="render-contained">
        <div className="flex flex-wrap items-start gap-6">
          <PlaylistArtworkCollage artworkSet={artworkSet} radius="md" padded className="h-[196px] w-[196px]" />

          <div className="flex min-w-[220px] flex-1 flex-col gap-3">
            <div className="flex items-center gap-3">
              <IconButton name="chevron-left" label="Back" size="sm" variant="flat" onClick={() => navigate('/playlists')} />
              <Kicker>{isCustom ? 'Your playlist' : 'Smart mix'}</Kicker>
            </div>
            <h1 className="text-[30px] font-bold tracking-[-0.025em] text-amply-textPrimary">{playlist.name}</h1>
            <Meta className="max-w-xl">{playlist.description || 'Curated playlist'}</Meta>
            <div className="flex flex-wrap items-center gap-2">
              <Badge icon="list">{playlistSongs.length} tracks</Badge>
              <Badge icon="clock">{totalLength}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button variant="primary" icon="play" onClick={handlePlayPlaylist} disabled={!playlistSongs.length}>Play</Button>
              <Button icon="shuffle" onClick={handleShufflePlaylist} disabled={!playlistIds.length}>Shuffle</Button>
              {isCustom ? (
                <>
                  <IconButton name="edit" label="Edit playlist" onClick={() => setEditing(true)} />
                  <IconButton name="trash" label="Delete playlist" variant="danger" onClick={() => setConfirmDelete(true)} />
                </>
              ) : null}
            </div>
          </div>
        </div>
      </Card>

      <div className="min-w-[260px]">
        <SongList
          songs={playlistSongs}
          persistKey={`playlist-${playlist.id}`}
          initialSort="recently_added"
          hideSort={isCustom}
        />
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} size="xl" title="Edit playlist" description="Details, tracks, and playback order.">
        <Suspense fallback={<div className="p-10 text-center text-[12px] text-amply-textSecondary">Preparing your library…</div>}>
          <PlaylistComposer
            songs={songs}
            initialPlaylist={playlist}
            onSave={async (updated) => { await upsertCustomPlaylist(updated); setEditing(false); }}
            onCancel={() => setEditing(false)}
          />
        </Suspense>
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => { void deleteCustomPlaylist(playlist.id).then(() => navigate('/playlists')); }}
        title={`Remove “${playlist.name}”?`}
        body="Your music files will stay in the library."
        confirmLabel="Delete"
        danger
      />
    </div>
  );
};

export default PlaylistDetailPage;
