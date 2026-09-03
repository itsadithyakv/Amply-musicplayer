import { lazy, Suspense, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SongList from '@/components/SongList/SongList';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import shuffleIcon from '@/assets/icons/shuffle.svg';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useArtworkReady } from '@/hooks/useArtworkReady';
import { usePlaylistDetailView } from '@/hooks/useLibraryViews';
import { PillButton } from '@/components/ui/AmplyUI';

const PlaylistComposer = lazy(() => import('@/components/Playlists/PlaylistComposer'));

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
  const artworkReady = useArtworkReady();
  const { playlist, playlistSongs, playlistIds, artworkSet } = usePlaylistDetailView(playlistId);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const heroBackground = useMemo(() => {
    if (!artworkReady || !artworkSet.length) {
      return undefined;
    }
    const artwork = artworkSet[0].replace(/"/g, '%22');
    return {
      backgroundImage: `linear-gradient(90deg, rgba(18,16,14,0.92) 0%, rgba(18,16,14,0.80) 44%, rgba(18,16,14,0.52) 100%), url("${artwork}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundColor: '#181614',
    } as CSSProperties;
  }, [artworkReady, artworkSet]);

  if (!playlist) {
    return (
      <div className="space-y-4 pb-8">
        <button
          type="button"
          onClick={() => navigate('/playlists')}
          className="w-fit rounded-md border border-amply-border px-3 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
        >
          Back to Playlists
        </button>
        <div className="rounded-card border border-amply-border bg-amply-card p-6 text-[13px] text-amply-textMuted">
          Playlist not found.
        </div>
      </div>
    );
  }

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

  return (
    <div className="space-y-6 pb-8">
      <header
        className="overflow-hidden rounded-card border border-white/10 bg-[#181614] p-6 text-white"
        style={heroBackground}
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => navigate('/playlists')}
              className="inline-flex w-fit items-center gap-2 rounded-[12px] border border-white/20 bg-black/15 px-3 py-1.5 text-[12px] text-white/72 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
            <div>
              <h1 className="text-[30px] font-bold tracking-[-0.025em] text-white">{playlist.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {playlist.type === 'custom' ? (
              <>
                <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center rounded-full border border-white/20 bg-black/15 px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-white/10">Edit</button>
                <button type="button" onClick={() => setConfirmDelete(true)} className="inline-flex items-center rounded-full border border-white/20 bg-black/15 px-4 py-2 text-[12px] font-semibold text-white/72 transition-colors hover:bg-white/10 hover:text-red-300">Delete</button>
              </>
            ) : null}
            <button
              type="button"
              onClick={handlePlayPlaylist}
              className="inline-flex items-center gap-2 rounded-full bg-amply-accent px-5 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amply-accentHover"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5-11-6.5z" />
              </svg>
              Play
            </button>
            <button
              type="button"
              onClick={() => {
                if (playlistIds.length === 0) {
                  return;
                }
                const shuffled = [...playlistIds];
                for (let i = shuffled.length - 1; i > 0; i -= 1) {
                  const swap = Math.floor(Math.random() * (i + 1));
                  [shuffled[i], shuffled[swap]] = [shuffled[swap], shuffled[i]];
                }
                setQueue(shuffled, shuffled[0], { playlistId: playlist.id });
                setShuffleEnabled(true);
                void playSongById(shuffled[0], false);
                void recordPlaylistUse(playlist.id);
              }}
              className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/15 px-5 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              <img src={shuffleIcon} alt="" className="h-4 w-4 brightness-0 invert" />
              Shuffle
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-start gap-5">
          <div className="relative h-[196px] w-[196px] shrink-0 overflow-hidden rounded-[20px] border border-white/20 bg-black/30">
            {artworkSet.length ? (
              <div className="grid h-full w-full grid-cols-2 gap-1.5 p-2">
                {artworkSet.map((art, index) => (
                  <div key={`art-${index}`} className="overflow-hidden rounded-[12px] bg-black/20">
                    <ArtworkImage src={art} alt="" className="h-full w-full object-cover" pulse={false} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.18em] text-white/45">
                Amply
              </div>
            )}
          </div>
          <div className="min-w-[220px] flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] text-white/72">
                {playlistSongs.length} tracks
              </span>
              <span className="rounded-full border border-white/15 bg-black/25 px-2.5 py-1 text-[11px] text-white/72">
                {playlist.type === 'custom' ? 'Your playlist' : 'Smart mix'}
              </span>
            </div>
            <p className="max-w-xl text-[13px] leading-relaxed text-white/72">
              {playlist.description || 'Curated playlist'}
            </p>
          </div>
        </div>
      </header>

      <div className="min-w-[260px]">
        <SongList
          songs={playlistSongs}
          persistKey={`playlist-${playlist.id}`}
          initialSort="recently_added"
          hideSort={playlist.type === 'custom'}
        />
      </div>

      {editing ? (
        <div className="ui-modal-backdrop fixed inset-0 z-50 overflow-y-auto p-4 sm:p-6" onClick={() => setEditing(false)}>
          <div className="flex min-h-full items-start justify-center sm:items-center">
            <div className="ui-soft-card my-2 w-full max-w-6xl overflow-hidden rounded-[26px]" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-amply-border/40 px-6 py-4">
                <div><p className="text-[16px] font-semibold text-amply-textPrimary">Edit playlist</p><p className="text-[12px] text-amply-textMuted">Details, tracks, and playback order.</p></div>
                <button type="button" onClick={() => setEditing(false)} className="rounded-[12px] border border-amply-border/50 px-3 py-2 text-[12px] text-amply-textSecondary hover:bg-amply-hover">Close</button>
              </div>
              <div className="max-h-[min(88vh,940px)] overflow-y-auto px-6 py-5">
                <Suspense fallback={<div className="p-10 text-center text-[12px] text-amply-textMuted">Preparing your library…</div>}>
                  <PlaylistComposer songs={songs} initialPlaylist={playlist} onSave={async (updated) => { await upsertCustomPlaylist(updated); setEditing(false); }} onCancel={() => setEditing(false)} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div className="ui-modal-backdrop fixed inset-0 z-[60] flex items-center justify-center p-5" onClick={() => setConfirmDelete(false)}>
          <div role="alertdialog" aria-modal="true" className="ui-soft-card w-full max-w-sm rounded-[24px] p-5" onClick={(event) => event.stopPropagation()}>
            <p className="amply-kicker">Delete playlist</p>
            <h2 className="mt-2 text-[20px] font-semibold text-amply-textPrimary">Remove “{playlist.name}”?</h2>
            <p className="mt-2 text-[12px] leading-relaxed text-amply-textSecondary">Your music files will stay in the library.</p>
            <div className="mt-5 flex justify-end gap-2"><PillButton type="button" onClick={() => setConfirmDelete(false)}>Cancel</PillButton><button type="button" className="rounded-[14px] bg-red-500/90 px-4 py-2.5 text-[12px] font-semibold text-white" onClick={() => { void deleteCustomPlaylist(playlist.id).then(() => navigate('/playlists')); }}>Delete</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default PlaylistDetailPage;
