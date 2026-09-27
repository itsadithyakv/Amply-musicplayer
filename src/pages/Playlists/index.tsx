import { lazy, memo, Suspense, useCallback, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid as Grid, type GridChildComponentProps } from 'react-window';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, ConfirmDialog, IconButton, Modal, PageHeader, Surface } from '@/components/ui';
import { importPlaylistFile } from '@/services/playlistImport';
import { CoverBackdrop } from '@/components/ui/CoverBackdrop';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Playlist } from '@/types/music';
import { type PlaylistCardView } from '@/services/libraryRepository';
import { useLibraryTabView, usePlaylistCardsView } from '@/hooks/useLibraryViews';
import { useT } from '@/i18n';
import { localizedPlaylistDescription, localizedPlaylistName } from '@/i18n/playlistNames';

const PlaylistComposer = lazy(() => import('@/components/Playlists/PlaylistComposer'));

/** Artwork well edge in px; the card is `p-4` (16) around it and each grid cell is `p-3` (12). */
const CARD_ARTWORK_SIZE = 128;
const CARD_PADDING = 16;
const CELL_PADDING = 12;
const PLAYLIST_ROW_HEIGHT = CARD_ARTWORK_SIZE + CARD_PADDING * 2 + CELL_PADDING * 2; // 184

const PlaylistCard = memo(({
  playlist,
  artworkSet,
  firstSongId,
  onPlay,
  onOpen,
  onEdit,
  onDelete,
}: {
  playlist: Playlist;
  artworkSet: string[];
  firstSongId?: string;
  onPlay: (playlist: Playlist, firstSongId?: string) => void;
  onOpen: (playlistId: string) => void;
  onEdit: (playlist: Playlist) => void;
  onDelete: (playlist: Playlist) => void;
}) => {
  const { t, tp } = useT();
  const isSmart = playlist.type !== 'custom';
  const name = localizedPlaylistName(playlist);
  const description = localizedPlaylistDescription(playlist);

  return (
    <Surface
      as="article"
      variant="raised-sm"
      radius="md"
      interactive
      onClick={() => onOpen(playlist.id)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(playlist.id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={t('playlists.card.open', { name })}
      className="render-contained group relative flex h-full min-w-0 cursor-pointer items-stretch overflow-hidden outline-none"
    >
      <CoverBackdrop src={artworkSet[0]} fade="right" />
      <div style={{ width: CARD_ARTWORK_SIZE }} className="shrink-0" aria-hidden="true" />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col p-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[18px] font-semibold tracking-[-0.02em] text-amply-onCover">{name}</p>
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-amply-onCoverMuted">{description || t('playlists.card.defaultDescription')}</p>
          </div>
          {!isSmart ? (
            <div className="flex shrink-0 items-center gap-1">
              <IconButton name="edit" label={t('playlists.card.edit', { name })} size="sm" variant="flat" onClick={(event) => { event.stopPropagation(); onEdit(playlist); }} />
              <IconButton name="trash" label={t('playlists.card.delete', { name })} size="sm" variant="flat" onClick={(event) => { event.stopPropagation(); onDelete(playlist); }} />
            </div>
          ) : null}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 pr-12">
          <Badge tone={isSmart ? 'accent' : 'neutral'} icon={isSmart ? 'smart-mix' : 'playlist-add'}>
            {isSmart ? t('playlists.badge.smart') : t('playlists.badge.custom')}
          </Badge>
          <Badge>{tp('playlists.tracks', playlist.songIds.length)}</Badge>
        </div>
      </div>

      <IconButton
        name="play"
        label={t('playlists.card.play', { name })}
        size="md"
        variant="accent"
        disabled={!firstSongId}
        onClick={(event) => { event.stopPropagation(); onPlay(playlist, firstSongId); }}
        className="absolute bottom-4 right-4 opacity-0 transition-opacity duration-150 focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100"
      />
    </Surface>
  );
});

const PlaylistCell = memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps) => {
  const { items, columnCount, renderCard } = data as { items: PlaylistCardView[]; columnCount: number; renderCard: (item: PlaylistCardView) => JSX.Element };
  const item = items[rowIndex * columnCount + columnIndex];
  return item ? <div style={style} className="p-3">{renderCard(item)}</div> : null;
});

const PlaylistsPage = () => {
  const { t, tp } = useT();
  const songs = useLibraryTabView('songs').songs;
  const upsertCustomPlaylist = useLibraryStore((state) => state.upsertCustomPlaylist);
  const deleteCustomPlaylist = useLibraryStore((state) => state.deleteCustomPlaylist);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const playlistCards = usePlaylistCardsView();
  const navigate = useNavigate();
  const [showComposer, setShowComposer] = useState(false);
  const [editingPlaylist, setEditingPlaylist] = useState<Playlist | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Playlist | null>(null);

  const handlePlay = useCallback((playlist: Playlist, firstSongId?: string) => {
    if (!firstSongId) return;
    setQueue(playlist.songIds, firstSongId, { playlistId: playlist.id });
    void playSongById(firstSongId, false);
  }, [playSongById, setQueue]);

  const handleOpen = useCallback((playlistId: string) => navigate(`/playlist/${playlistId}`), [navigate]);
  const openEditor = useCallback((playlist: Playlist) => { setEditingPlaylist(playlist); setShowComposer(true); }, []);
  const closeComposer = useCallback(() => { setShowComposer(false); setEditingPlaylist(null); }, []);
  const renderCard = useCallback((item: PlaylistCardView) => (
    <PlaylistCard playlist={item.playlist} artworkSet={item.artworkSet} firstSongId={item.firstSongId} onPlay={handlePlay} onOpen={handleOpen} onEdit={openEditor} onDelete={setPendingDelete} />
  ), [handleOpen, handlePlay, openEditor]);

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden pb-8">
      <PageHeader
        title={t('playlists.header.title')}
        description={t('playlists.header.description')}
        action={
          <div className="flex items-center gap-2">
            <Button
              icon="folder"
              onClick={() => {
                void importPlaylistFile().then((result) => {
                  if (!result) {
                    return;
                  }
                  usePlayerStore.getState().showToast(tp('playlists.toast.imported', result.total, { found: result.found }));
                  navigate(`/playlist/${result.playlistId}`);
                });
              }}
            >
              {t('playlists.header.import')}
            </Button>
            <Button variant="primary" icon="add" onClick={() => { setEditingPlaylist(null); setShowComposer(true); }}>{t('playlists.header.new')}</Button>
          </div>
        }
      />

      {playlistCards.length ? (
        <Surface variant="pressed" radius="lg" className="anim-rise h-[70vh] min-w-0 overflow-hidden p-1">
          <AutoSizer>{({ height, width }) => {
            const columnCount = width >= 820 ? 2 : 1;
            const columnWidth = Math.floor((width - 12) / columnCount);
            return <Grid columnCount={columnCount} columnWidth={columnWidth} height={height} rowCount={Math.ceil(playlistCards.length / columnCount)} rowHeight={PLAYLIST_ROW_HEIGHT} width={width} style={{ overflowX: 'hidden' }} itemData={{ items: playlistCards, columnCount, renderCard }} overscanRowCount={2}>{PlaylistCell}</Grid>;
          }}</AutoSizer>
        </Surface>
      ) : (
        <Surface variant="well" radius="lg" className="p-8 text-center text-[13px] text-amply-textSecondary">
          {t('playlists.empty')}
        </Surface>
      )}

      <Modal
        open={showComposer}
        onClose={closeComposer}
        size="xl"
        title={editingPlaylist ? t('playlists.composer.editTitle') : t('playlists.composer.createTitle')}
        description={t('playlists.composer.modalDescription')}
      >
        <Suspense fallback={<div className="p-10 text-center text-[12px] text-amply-textSecondary">{t('playlists.composer.preparing')}</div>}>
          <PlaylistComposer
            songs={songs}
            initialPlaylist={editingPlaylist}
            onSave={async (playlist) => { await upsertCustomPlaylist(playlist); closeComposer(); }}
            onCancel={closeComposer}
          />
        </Suspense>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const id = pendingDelete.id;
          setPendingDelete(null);
          void deleteCustomPlaylist(id);
        }}
        title={t('playlists.delete.title', { name: pendingDelete ? localizedPlaylistName(pendingDelete) : '' })}
        body={t('playlists.delete.body')}
        confirmLabel={t('playlists.delete.confirm')}
        danger
      />
    </div>
  );
};

export default PlaylistsPage;
