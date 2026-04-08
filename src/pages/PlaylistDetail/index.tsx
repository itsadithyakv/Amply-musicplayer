import { useMemo, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SongList from '@/components/SongList/SongList';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import shuffleIcon from '@/assets/icons/shuffle.svg';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Song } from '@/types/music';
import { useArtworkReady } from '@/hooks/useArtworkReady';
import { buildArtworkSet } from '@/services/playlistArtworkService';
import { useAlbumArtFrequency } from '@/hooks/useAlbumArtFrequency';

const PlaylistDetailPage = () => {
  const { playlistId } = useParams();
  const playlists = useLibraryStore((state) => state.playlists);
  const songs = useLibraryStore((state) => state.songs);
  const recordPlaylistUse = useLibraryStore((state) => state.recordPlaylistUse);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setShuffleEnabled = usePlayerStore((state) => state.setShuffleEnabled);
  const navigate = useNavigate();
  const artworkReady = useArtworkReady();
  const albumArtFrequency = useAlbumArtFrequency(songs);

  const playlist = useMemo(
    () => playlists.find((entry) => entry.id === playlistId),
    [playlists, playlistId],
  );
  const songsById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const playlistSongs = useMemo(
    () => (playlist ? playlist.songIds.map((id) => songsById.get(id)).filter((song): song is Song => song !== undefined) : []),
    [playlist, songsById],
  );
  const artworkSet = useMemo(() => {
    const list = buildArtworkSet(playlistSongs, albumArtFrequency, 4, playlist?.artwork);
    if (list.length) {
      while (list.length < 4) {
        list.push(list[list.length - 1]);
      }
    }
    return list;
  }, [playlistSongs, albumArtFrequency, playlist?.artwork]);
  const collageBackground = useMemo(() => {
    if (!artworkReady || !artworkSet.length) {
      return undefined;
    }
    const layers = artworkSet.map(
      (art, index) => `linear-gradient(140deg, rgba(10,10,12,${0.75 - index * 0.1}), rgba(10,10,12,0.35)), url(${art})`,
    );
    return {
      backgroundImage: layers.join(','),
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundBlendMode: 'overlay',
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

  const playlistIds = playlistSongs.map((song) => song.id);

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
        className="rounded-card border border-amply-border bg-amply-card p-6"
        style={collageBackground}
      >
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => navigate('/playlists')}
              className="inline-flex w-fit items-center gap-2 rounded-md border border-amply-border px-3 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Back
            </button>
            <div>
              <h1 className="text-[28px] font-bold text-amply-textPrimary">{playlist.name}</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
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
              className="inline-flex items-center gap-2 rounded-full border border-amply-border px-5 py-2 text-[12px] font-semibold text-amply-textPrimary transition-colors hover:bg-amply-hover"
            >
              <img src={shuffleIcon} alt="" className="h-4 w-4 brightness-0 invert" />
              Shuffle
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-start gap-5">
          <div className="relative h-[180px] w-[180px] overflow-hidden rounded-2xl border border-amply-border/60 bg-black/40 shadow-card">
            {artworkSet.length ? (
              <div className="grid h-full w-full grid-cols-2 gap-2 p-3">
                {artworkSet.map((art, index) => (
                  <div key={`art-${index}`} className="overflow-hidden rounded-xl">
                    <ArtworkImage src={art} alt="" className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.18em] text-amply-textMuted">
                Amply
              </div>
            )}
          </div>
          <div className="min-w-[220px] flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-amply-border/60 bg-black/35 px-2 py-0.5 text-[11px] text-amply-textSecondary">
                {playlistSongs.length} tracks
              </span>
              <span className="rounded-full border border-amply-border/60 bg-black/35 px-2 py-0.5 text-[11px] text-amply-textSecondary">
                {playlist.type === 'custom' ? 'Your playlist' : 'Smart mix'}
              </span>
            </div>
            <p className="text-[13px] text-amply-textSecondary">
              {playlist.description || 'Curated playlist'}
            </p>
          </div>
        </div>
      </header>

      <div className="min-w-[260px]">
        <SongList songs={playlistSongs} persistKey={`playlist-${playlist.id}`} initialSort="recently_added" />
      </div>
    </div>
  );
};

export default PlaylistDetailPage;
