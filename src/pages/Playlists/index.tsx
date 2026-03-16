import clsx from 'clsx';
import { useMemo, useState } from 'react';
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

  const playlistToneClasses = [
    'bg-gradient-to-br from-[#1f2a45] via-[#151b26] to-[#0f1218]',
    'bg-gradient-to-br from-[#3a2614] via-[#22170e] to-[#14110c]',
    'bg-gradient-to-br from-[#1a352d] via-[#121f1b] to-[#0c1311]',
    'bg-gradient-to-br from-[#3a1d34] via-[#23131f] to-[#130b11]',
  ];

  const playlistGlowClasses = [
    'shadow-[0_0_0_1px_rgba(90,130,255,0.16),0_14px_30px_rgba(17,24,39,0.6)]',
    'shadow-[0_0_0_1px_rgba(255,170,90,0.16),0_14px_30px_rgba(20,12,8,0.6)]',
    'shadow-[0_0_0_1px_rgba(96,220,170,0.16),0_14px_30px_rgba(9,16,13,0.6)]',
    'shadow-[0_0_0_1px_rgba(210,120,230,0.16),0_14px_30px_rgba(17,10,15,0.6)]',
  ];

  const playlistCards = useMemo(() => {
    const mapArtworkSet = (playlist: Playlist): string[] => {
      const artSet = new Set<string>();
      for (const song of songs) {
        if (!playlist.songIds.includes(song.id)) {
          continue;
        }
        if (song.albumArt) {
          artSet.add(song.albumArt);
        }
        if (artSet.size >= 4) {
          break;
        }
      }
      const list = [...artSet];
      if (list.length) {
        while (list.length < 4) {
          list.push(list[list.length - 1]);
        }
      }
      return list;
    };

    return playlists.map((playlist) => ({
      playlist,
      artwork: getPlaylistArtwork(playlist),
      artworkSet: mapArtworkSet(playlist),
      totalDuration: playlist.songIds
        .map((id) => songs.find((song) => song.id === id)?.duration ?? 0)
        .reduce((sum, duration) => sum + duration, 0),
    }));
  }, [playlists, songs]);

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
    <div className="space-y-5 pb-8">
      <header className="space-y-1">
        <h1 className="text-[30px] font-bold tracking-tight text-amply-textPrimary">Playlists</h1>
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {playlistCards.map(({ playlist, artwork, artworkSet, totalDuration }, index) => {
          const firstSong = songs.find((song) => playlist.songIds.includes(song.id));
          const backgroundStyle = artworkSet[0]
            ? {
                backgroundImage: `linear-gradient(140deg, rgba(10, 10, 12, 0.8), rgba(10, 10, 12, 0.5)), url(${artworkSet[0]})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundBlendMode: 'overlay',
              }
            : undefined;

          return (
            <div
              key={playlist.id}
              onDoubleClick={(event) => {
                if ((event.target as HTMLElement).closest('[data-play-button="true"]')) {
                  return;
                }

                openPlaylistQueue(playlist.songIds, firstSong?.id);
              }}
              className={clsx(
                'playlist-card group relative overflow-hidden rounded-card border border-amply-border/60 p-5 transition-all duration-300 ease-smooth hover:scale-[1.01] hover:shadow-lift',
                playlistToneClasses[index % playlistToneClasses.length],
                playlistGlowClasses[index % playlistGlowClasses.length],
              )}
              style={backgroundStyle}
              title="Double-click to open queue"
            >
              {artworkSet[0] ? (
                <div className="blur-backdrop playlist-backdrop">
                  <img src={artworkSet[0]} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
                </div>
              ) : null}

              <div className="glass-overlay" />

              <div className="relative flex h-full flex-col justify-between gap-4">
                <div className="space-y-1">
                  <p className="playlist-text-shadow text-[18px] font-semibold text-amply-textPrimary">{playlist.name}</p>
                  <p className="playlist-text-shadow text-[12px] text-amply-textSecondary">
                    {playlist.description || 'Curated playlist'}
                  </p>
                  <p className="playlist-text-shadow text-[12px] font-semibold text-amply-textPrimary/90">
                    {playlist.songIds.length} songs
                  </p>
                  <p className="text-[11px] text-amply-textMuted">Double-click to open queue</p>
                </div>

                <div className="flex items-end justify-between gap-3">
                  <div className="artwork-collage max-w-[220px]">
                    {[0, 1, 2, 3].map((slot) => {
                      const art = artworkSet[slot] ?? artworkSet[0];
                      return (
                        <div
                          key={`${playlist.id}-art-${slot}`}
                          className="artwork-tile h-20 w-20 bg-gradient-to-br from-[#1d1f2a] via-[#12151f] to-[#0c0f17]"
                        >
                          {art ? <img src={art} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" /> : null}
                        </div>
                      );
                    })}
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
                    className="rounded-full bg-amply-accent px-4 py-2 text-[12px] font-semibold text-black transition-colors hover:bg-amply-accentHover"
                  >
                    Play
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PlaylistsPage;
