import { lazy, memo, Suspense, useCallback, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeGrid as Grid, type GridChildComponentProps } from 'react-window';
import { useNavigate } from 'react-router-dom';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { PageHeader, PillButton, SoftPanel } from '@/components/ui/AmplyUI';
import addIcon from '@/assets/icons/add.svg';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Playlist } from '@/types/music';
import { type PlaylistCardView } from '@/services/libraryRepository';
import { useLibraryTabView, usePlaylistCardsView } from '@/hooks/useLibraryViews';

const PlaylistComposer = lazy(() => import('@/components/Playlists/PlaylistComposer'));

const SmartMixIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
    <path d="M5 16.5V14m4 4.5v-9m4 6.5V6m4 10.5V11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="m17.6 4 .45 1.15L19.2 5.6l-1.15.45-.45 1.15-.45-1.15L16 5.6l1.15-.45L17.6 4Z" fill="currentColor" />
  </svg>
);

const UserPlaylistIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-6 w-6">
    <path d="M5 7h9M5 11h9M5 15h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M17.5 12.5v6m-3-3h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

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
  const isSmart = playlist.type !== 'custom';

  return (
    <div
      onClick={() => onOpen(playlist.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(playlist.id);
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open ${playlist.name}`}
      className="playlist-card render-contained group relative h-full overflow-hidden rounded-[22px] border border-white/10 bg-[#171513] p-5 text-white transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:shadow-[var(--amply-shadow-card)]"
    >
      {artworkSet.length ? (
        <div className="absolute inset-y-0 right-0 grid w-[58%] grid-cols-2 grid-rows-2 gap-px bg-black" aria-hidden="true">
          {artworkSet.slice(0, 4).map((artwork, index) => (
            <ArtworkImage
              key={`${playlist.id}-art-${index}`}
              src={artwork}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]"
              placeholderClassName="h-full w-full bg-[#292521]"
              pulse={false}
            />
          ))}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(17,15,14,0.99)_0%,rgba(17,15,14,0.96)_38%,rgba(17,15,14,0.72)_61%,rgba(17,15,14,0.18)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(0deg,rgba(12,11,10,0.72)_0%,transparent_46%)]" />
      <div className="relative flex h-full min-w-0 flex-col">
        <div className="flex items-start justify-between gap-4">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] border backdrop-blur-sm ${isSmart ? 'border-amply-accent/25 bg-amply-accent/15 text-amply-accent' : 'border-white/12 bg-black/35 text-white/80'}`}>
            {isSmart ? <SmartMixIcon /> : <UserPlaylistIcon />}
          </div>
          <span className="shrink-0 rounded-full border border-white/15 bg-black/55 px-2.5 py-1 text-[10px] font-medium text-white/80 backdrop-blur-md">
            {playlist.songIds.length} tracks
          </span>
        </div>

        <div className="mt-4 min-w-0 max-w-[62%]">
          <p className="truncate text-[18px] font-semibold tracking-[-0.025em] text-white [text-shadow:0_1px_12px_rgba(0,0,0,0.55)]">{playlist.name}</p>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-white/76 [text-shadow:0_1px_8px_rgba(0,0,0,0.7)]">{playlist.description || 'A playlist made by you.'}</p>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <p className="text-[9px] font-semibold uppercase tracking-[0.17em] text-white/65">{isSmart ? 'Smart mix' : 'User made'}</p>
          <div className="flex items-center gap-2">
            {!isSmart ? (
              <>
                <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(playlist); }} className="rounded-full border border-white/15 bg-black/45 px-3 py-2 text-[10px] font-semibold text-white/85 backdrop-blur-md hover:bg-black/65">Edit</button>
                <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(playlist); }} className="rounded-full border border-white/15 bg-black/45 px-3 py-2 text-[10px] font-semibold text-white/85 backdrop-blur-md hover:bg-black/65">Delete</button>
              </>
            ) : null}
            <button type="button" onClick={(event) => { event.stopPropagation(); onPlay(playlist, firstSongId); }} disabled={!firstSongId} className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amply-accent text-black hover:bg-amply-accentHover disabled:opacity-40" aria-label={`Play ${playlist.name}`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5-11-6.5z" /></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

const PlaylistCell = memo(({ columnIndex, rowIndex, style, data }: GridChildComponentProps) => {
  const { items, columnCount, renderCard } = data as { items: PlaylistCardView[]; columnCount: number; renderCard: (item: PlaylistCardView) => JSX.Element };
  const item = items[rowIndex * columnCount + columnIndex];
  return item ? <div style={style} className="p-3">{renderCard(item)}</div> : null;
});

const PlaylistsPage = () => {
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
  const renderCard = useCallback((item: PlaylistCardView) => (
    <PlaylistCard playlist={item.playlist} artworkSet={item.artworkSet} firstSongId={item.firstSongId} onPlay={handlePlay} onOpen={handleOpen} onEdit={openEditor} onDelete={setPendingDelete} />
  ), [handleOpen, handlePlay, openEditor]);

  return (
    <div className="min-w-0 space-y-5 overflow-x-hidden pb-8">
      <PageHeader eyebrow="Your listening" title="Playlists" description="Smart mixes from Amply and playlists arranged by you." />

      <SoftPanel className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[16px] font-semibold text-amply-textPrimary">Make it yours</p>
            <p className="mt-0.5 text-[13px] text-amply-textSecondary">Shape the track order and let the artwork follow your music.</p>
          </div>
          <PillButton type="button" onClick={() => { setEditingPlaylist(null); setShowComposer(true); }} variant="primary"><img src={addIcon} alt="" className="ui-icon h-4 w-4" />New playlist</PillButton>
        </div>
      </SoftPanel>

      {playlistCards.length ? (
        <SoftPanel className="h-[70vh] min-w-0 overflow-hidden">
          <AutoSizer>{({ height, width }) => {
            const columnCount = width >= 820 ? 2 : 1;
            const columnWidth = Math.floor((width - 12) / columnCount);
            return <Grid columnCount={columnCount} columnWidth={columnWidth} height={height} rowCount={Math.ceil(playlistCards.length / columnCount)} rowHeight={230} width={width} style={{ overflowX: 'hidden' }} itemData={{ items: playlistCards, columnCount, renderCard }} overscanRowCount={2}>{PlaylistCell}</Grid>;
          }}</AutoSizer>
        </SoftPanel>
      ) : <SoftPanel className="p-8 text-center text-[13px] text-amply-textSecondary">No playlists yet. Create one to get started.</SoftPanel>}

      {showComposer ? (
        <div className="ui-modal-backdrop fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6" onClick={() => { setShowComposer(false); setEditingPlaylist(null); }}>
          <div className="flex min-h-full items-start justify-center sm:items-center">
            <div className="ui-soft-card my-2 w-full max-w-6xl overflow-hidden rounded-[26px]" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-amply-border/40 px-5 py-4 sm:px-6">
                <div><p className="text-[16px] font-semibold text-amply-textPrimary">{editingPlaylist ? 'Edit playlist' : 'Create playlist'}</p><p className="mt-0.5 text-[12px] text-amply-textMuted">Details, tracks, and playback order.</p></div>
                <button type="button" onClick={() => { setShowComposer(false); setEditingPlaylist(null); }} className="rounded-[12px] border border-amply-border/50 px-3 py-2 text-[12px] text-amply-textSecondary hover:bg-amply-hover">Close</button>
              </div>
              <div className="max-h-[min(88vh,940px)] overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
                <Suspense fallback={<div className="p-10 text-center text-[12px] text-amply-textMuted">Preparing your library…</div>}>
                  <PlaylistComposer songs={songs} initialPlaylist={editingPlaylist} onSave={async (playlist) => { await upsertCustomPlaylist(playlist); setShowComposer(false); setEditingPlaylist(null); }} onCancel={() => { setShowComposer(false); setEditingPlaylist(null); }} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <div className="ui-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-5" onClick={() => setPendingDelete(null)}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-playlist-title" className="ui-soft-card w-full max-w-sm rounded-[24px] p-5" onClick={(event) => event.stopPropagation()}>
            <p className="amply-kicker">Delete playlist</p>
            <h2 id="delete-playlist-title" className="mt-2 text-[20px] font-semibold tracking-[-0.02em] text-amply-textPrimary">Remove “{pendingDelete.name}”?</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-amply-textSecondary">The playlist will be removed. Your music files will not be affected.</p>
            <div className="mt-5 flex justify-end gap-2">
              <PillButton type="button" onClick={() => setPendingDelete(null)}>Cancel</PillButton>
              <button type="button" onClick={() => { const id = pendingDelete.id; setPendingDelete(null); void deleteCustomPlaylist(id); }} className="rounded-[14px] bg-red-500/90 px-4 py-2.5 text-[12px] font-semibold text-white hover:bg-red-500">Delete</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PlaylistsPage;
