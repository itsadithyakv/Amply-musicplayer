import { shuffle } from '@/utils/random';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SongList from '@/components/SongList/SongList';
import { Badge, Button, Card, ConfirmDialog, IconButton, Kicker, Meta, Modal } from '@/components/ui';
import { exportPlaylistFile } from '@/services/playlistImport';
import { PlaylistArtworkCollage } from '@/components/Playlists/PlaylistArtworkCollage';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaylistDetailView } from '@/hooks/useLibraryViews';
import { t as translate, useT } from '@/i18n';
import { localizedPlaylistDescription, localizedPlaylistName } from '@/i18n/playlistNames';

const PlaylistComposer = lazy(() => import('@/components/Playlists/PlaylistComposer'));

const formatPlaylistLength = (totalSeconds: number): string => {
  const minutes = Math.max(0, Math.round(totalSeconds / 60));
  if (minutes < 60) {
    return translate('playlists.length.minutes', { minutes });
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? translate('playlists.length.hoursMinutes', { hours, minutes: rest }) : translate('playlists.length.hours', { hours });
};

const PlaylistDetailPage = () => {
  const { t, tp } = useT();
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
  const totalSeconds = useMemo(
    () => playlistSongs.reduce((total, song) => total + (Number.isFinite(song.duration) ? song.duration : 0), 0),
    [playlistSongs],
  );

  if (!playlist) {
    return (
      <div className="space-y-4 pb-8">
        <IconButton name="chevron-left" label={t('playlists.detail.back')} variant="flat" onClick={() => navigate('/playlists')} />
        <Card padding="lg" className="text-[13px] text-amply-textSecondary">{t('playlists.detail.notFound')}</Card>
      </div>
    );
  }

  const isCustom = playlist.type === 'custom';
  const name = localizedPlaylistName(playlist);
  const description = localizedPlaylistDescription(playlist);
  const totalLength = formatPlaylistLength(totalSeconds);

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
              <IconButton name="chevron-left" label={t('playlists.detail.backShort')} size="sm" variant="flat" onClick={() => navigate('/playlists')} />
              <Kicker>{isCustom ? t('playlists.badge.custom') : t('playlists.badge.smart')}</Kicker>
            </div>
            <h1 className="text-[30px] font-bold tracking-[-0.025em] text-amply-textPrimary">{name}</h1>
            <Meta className="max-w-xl">{description || t('playlists.detail.defaultDescription')}</Meta>
            <div className="flex flex-wrap items-center gap-2">
              <Badge icon="list">{tp('playlists.tracks', playlistSongs.length)}</Badge>
              <Badge icon="clock">{totalLength}</Badge>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button variant="primary" icon="play" onClick={handlePlayPlaylist} disabled={!playlistSongs.length}>{t('common.play')}</Button>
              <Button icon="shuffle" onClick={handleShufflePlaylist} disabled={!playlistIds.length}>{t('playlists.detail.shuffle')}</Button>
              <IconButton
                name="download"
                label={t('playlists.detail.export')}
                disabled={!playlistIds.length}
                onClick={() => {
                  void exportPlaylistFile({ name, songIds: playlistIds }).then((saved) => {
                    if (saved) {
                      usePlayerStore.getState().showToast(t('playlists.detail.exported'));
                    }
                  });
                }}
              />
              {isCustom ? (
                <>
                  <IconButton name="edit" label={t('playlists.composer.editTitle')} onClick={() => setEditing(true)} />
                  <IconButton name="trash" label={t('playlists.detail.delete')} variant="danger" onClick={() => setConfirmDelete(true)} />
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

      <Modal open={editing} onClose={() => setEditing(false)} size="xl" title={t('playlists.composer.editTitle')} description={t('playlists.composer.modalDescription')}>
        <Suspense fallback={<div className="p-10 text-center text-[12px] text-amply-textSecondary">{t('playlists.composer.preparing')}</div>}>
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
        title={t('playlists.delete.title', { name })}
        body={t('playlists.delete.detailBody')}
        confirmLabel={t('playlists.delete.confirm')}
        danger
      />
    </div>
  );
};

export default PlaylistDetailPage;
