import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PlaylistComposer from '@/components/Playlists/PlaylistComposer';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Playlist } from '@/types/music';

const PlaylistsPage = () => {
  const songs = useLibraryStore((state) => state.songs);
  const playlists = useLibraryStore((state) => state.playlists);
  const upsertCustomPlaylist = useLibraryStore((state) => state.upsertCustomPlaylist);
  const navigate = useNavigate();

  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);

  const [showComposer, setShowComposer] = useState(false);

  const getPlaylistArtwork = (playlist: Playlist): string | undefined => {
    if (playlist.artwork) {
      return playlist.artwork;
    }

    const firstSong = songs.find((song) => playlist.songIds.includes(song.id));
    return firstSong?.albumArt;
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
        <h1 className="text-2xl font-bold text-amply-textPrimary">Playlists</h1>
        <p className="text-[13px] text-amply-textSecondary">Custom playlists and smart mixes.</p>
      </header>

      <div className="rounded-card border border-amply-border bg-amply-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[18px] font-bold text-amply-textPrimary">Create Playlist</p>
            <p className="text-[13px] text-amply-textSecondary">Build a custom playlist with your own cover image and description.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowComposer((current) => !current)}
            className="rounded-lg bg-amply-accent px-4 py-2 text-[13px] font-medium text-black transition-colors hover:bg-amply-accentHover"
          >
            {showComposer ? 'Close' : 'New Playlist'}
          </button>
        </div>

        {showComposer ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setShowComposer(false)}
          >
            <div
              className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-card border border-amply-border bg-amply-card shadow-card"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-amply-border px-5 py-4">
                <div>
                  <p className="text-[16px] font-semibold text-amply-textPrimary">Create Playlist</p>
                  <p className="text-[12px] text-amply-textMuted">Add details and pick songs to include.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowComposer(false)}
                  className="rounded-md border border-amply-border px-3 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
                >
                  Close
                </button>
              </div>
              <div className="max-h-[calc(90vh-64px)] overflow-y-auto px-5 py-4">
                <PlaylistComposer
                  songs={songs}
                  onSave={(playlist) => {
                    void upsertCustomPlaylist(playlist).then(() => {
                      setShowComposer(false);
                    });
                  }}
                  onCancel={() => setShowComposer(false)}
                />
              </div>
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
  );
};

export default PlaylistsPage;
