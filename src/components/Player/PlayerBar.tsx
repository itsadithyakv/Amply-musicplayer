import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import prevIcon from '@/assets/icons/prev.svg';
import nextIcon from '@/assets/icons/next.svg';
import playIcon from '@/assets/icons/play.svg';
import pauseIcon from '@/assets/icons/pause.svg';
import shuffleIcon from '@/assets/icons/shuffle.svg';
import queueIcon from '@/assets/icons/queue.svg';
import repeatIcon from '@/assets/icons/repeat.svg';
import repeatOnIcon from '@/assets/icons/repeat-on.svg';
import lyricsIcon from '@/assets/icons/lyrics.svg';
import addIcon from '@/assets/icons/add.svg';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { formatDuration } from '@/utils/time';

const iconButtonClass = 'rounded-full p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover hover:text-amply-textPrimary';
const darkSurfaceIconClass = 'h-5 w-5 brightness-0 invert';
const panelIconClass = 'h-4 w-4 brightness-0 invert';

const PlayerBar = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const positionSec = usePlayerStore((state) => state.positionSec);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const shuffleEnabled = usePlayerStore((state) => state.shuffleEnabled);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const volume = usePlayerStore((state) => state.volume);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);

  const pausePlayback = usePlayerStore((state) => state.pausePlayback);
  const resumePlayback = usePlayerStore((state) => state.resumePlayback);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const setShuffleEnabled = usePlayerStore((state) => state.setShuffleEnabled);
  const toggleLoopSong = usePlayerStore((state) => state.toggleLoopSong);

  const song = useLibraryStore((state) => (currentSongId ? state.getSongById(currentSongId) : undefined));
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const customPlaylists = useLibraryStore((state) => state.customPlaylists);
  const addSongToCustomPlaylist = useLibraryStore((state) => state.addSongToCustomPlaylist);
  const upsertCustomPlaylist = useLibraryStore((state) => state.upsertCustomPlaylist);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [favoritePulse, setFavoritePulse] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState<string | null>(null);
  const [playlistMessage, setPlaylistMessage] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const favoriteClickRef = useRef<number | null>(null);
  const favoriteMessageRef = useRef<number | null>(null);
  const playlistMessageRef = useRef<number | null>(null);
  const suppressFavoriteClickRef = useRef(false);
  const actionBusyRef = useRef(false);

  useEffect(() => {
    return () => {
      if (favoriteClickRef.current) {
        window.clearTimeout(favoriteClickRef.current);
      }
      if (favoriteMessageRef.current) {
        window.clearTimeout(favoriteMessageRef.current);
      }
      if (playlistMessageRef.current) {
        window.clearTimeout(playlistMessageRef.current);
      }
    };
  }, []);

  const progressPercent = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
  const isLooping = repeatMode === 'one';

  return (
    <footer className="relative z-50 h-[84px] border-t border-amply-border/60 bg-amply-surface px-5 py-2 shadow-[0_-12px_30px_rgba(0,0,0,0.5)]">
      <div className="grid h-full grid-cols-[1.6fr_2fr_1.2fr] items-center gap-4">
        <div className="relative flex min-w-0 items-center gap-3">
          <Link to="/now-playing" className="flex min-w-0 items-center gap-3 rounded-xl p-2 transition-colors hover:bg-amply-hover">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800">
              {song?.albumArt ? (
                <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" loading="lazy" decoding="async" />
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-bold text-amply-textPrimary">{song?.title ?? 'Select a track'}</p>
              <p className="truncate text-[12px] text-amply-textSecondary">{song ? `${song.artist} - ${song.album}` : 'Your local library'}</p>
            </div>
          </Link>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!song}
              onClick={() => {
                if (!song) {
                  return;
                }
                if (suppressFavoriteClickRef.current) {
                  suppressFavoriteClickRef.current = false;
                  return;
                }
                if (favoriteClickRef.current) {
                  window.clearTimeout(favoriteClickRef.current);
                }
                favoriteClickRef.current = window.setTimeout(() => {
                  const willFavorite = !song.favorite;
                  void toggleFavorite(song.id);
                  if (willFavorite) {
                    setFavoritePulse(true);
                    setFavoriteMessage('Added to Favorites');
                    if (favoriteMessageRef.current) {
                      window.clearTimeout(favoriteMessageRef.current);
                    }
                    favoriteMessageRef.current = window.setTimeout(() => {
                      setFavoritePulse(false);
                      setFavoriteMessage(null);
                    }, 1400);
                  } else {
                    setFavoriteMessage(null);
                    setFavoritePulse(false);
                  }
                }, 220);
              }}
              onDoubleClick={() => {
                if (favoriteClickRef.current) {
                  window.clearTimeout(favoriteClickRef.current);
                }
                suppressFavoriteClickRef.current = true;
                setShowPlaylistPicker(true);
              }}
              className={`rounded-lg border border-amply-border/60 p-2 transition-colors ${
                song?.favorite ? 'border-amply-accent text-amply-accent shadow-glow' : 'text-amply-textSecondary hover:bg-amply-hover'
              }`}
              title="Favorite (double-click to add to playlist)"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                className={`${favoritePulse ? 'favorite-pulse' : ''}`}
                aria-hidden="true"
              >
                <path
                  d="M12 20.4L10.3 18.9C6.6 15.5 4.2 13.2 4.2 10.2C4.2 8.1 5.8 6.5 7.9 6.5C9.2 6.5 10.4 7.1 11.2 8.1C12 7.1 13.2 6.5 14.5 6.5C16.6 6.5 18.2 8.1 18.2 10.2C18.2 13.2 15.8 15.5 12.1 18.9L12 19L12 20.4Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              type="button"
              disabled={!song}
              onClick={() => setShowPlaylistPicker((value) => !value)}
              className="rounded-lg border border-amply-border/60 p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-60"
              title="Add to playlist"
            >
              <img src={addIcon} alt="Add to playlist" className={panelIconClass} />
            </button>
          </div>

          {favoriteMessage ? (
            <span className="text-[11px] text-amply-accent">{favoriteMessage}</span>
          ) : null}
          {playlistMessage ? (
            <span className="text-[11px] text-amply-accent">{playlistMessage}</span>
          ) : null}

          {showPlaylistPicker ? (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-md"
              onClick={() => setShowPlaylistPicker(false)}
            >
              <div
                className="w-full max-w-md rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="flex items-center justify-between border-b border-amply-border/60 pb-3">
                  <p className="text-[12px] uppercase tracking-[0.2em] text-amply-textMuted">Add to playlist</p>
                  <button
                    type="button"
                    onClick={() => setShowPlaylistPicker(false)}
                    className="rounded-md border border-amply-border/60 px-2 py-1 text-[11px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
                  >
                    Close
                  </button>
                </div>

                <div className="mt-4 space-y-2">
                  <label className="text-[10px] uppercase tracking-[0.2em] text-amply-textMuted">Quick Create</label>
                  <div className="flex items-center gap-2">
                    <input
                      value={newPlaylistName}
                      onChange={(event) => setNewPlaylistName(event.target.value)}
                      placeholder="New playlist name"
                      className="flex-1 rounded-md border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[12px] text-amply-textPrimary outline-none transition-colors focus:border-amply-accent"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!song) {
                          return;
                        }
                        const name = newPlaylistName.trim();
                        if (!name) {
                          return;
                        }
                        const playlist = {
                          id: `custom_${Date.now()}`,
                          name,
                          type: 'custom' as const,
                          description: 'User playlist',
                          songIds: [song.id],
                          updatedAt: Math.floor(Date.now() / 1000),
                        };
                        await upsertCustomPlaylist(playlist);
                        setNewPlaylistName('');
                        setShowPlaylistPicker(false);
                        setPlaylistMessage(`Created ${name}`);
                        if (playlistMessageRef.current) {
                          window.clearTimeout(playlistMessageRef.current);
                        }
                        playlistMessageRef.current = window.setTimeout(() => {
                          setPlaylistMessage(null);
                        }, 1600);
                      }}
                      className="rounded-md bg-amply-accent px-3 py-2 text-[11px] font-semibold text-black transition-colors hover:bg-amply-accentHover"
                    >
                      Create
                    </button>
                  </div>
                </div>

                <div className="mt-4 max-h-64 space-y-1 overflow-y-auto pr-1">
                  {customPlaylists.length ? (
                    customPlaylists.map((playlist) => {
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
                              setPlaylistMessage(`Already in ${playlist.name}`);
                            } else {
                              await addSongToCustomPlaylist(playlist.id, song.id);
                              setPlaylistMessage(`Added to ${playlist.name}`);
                            }
                            if (playlistMessageRef.current) {
                              window.clearTimeout(playlistMessageRef.current);
                            }
                            playlistMessageRef.current = window.setTimeout(() => {
                              setPlaylistMessage(null);
                            }, 1600);
                            setShowPlaylistPicker(false);
                          }}
                          className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover hover:text-amply-textPrimary"
                        >
                          <span className="truncate">{playlist.name}</span>
                          <span className="text-[11px] text-amply-textMuted">
                            {inPlaylist ? 'Added' : playlist.songIds.length}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <p className="px-2 py-2 text-[12px] text-amply-textMuted">No playlists yet.</p>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center justify-end">
              <button
                type="button"
                onClick={() => setShuffleEnabled(!shuffleEnabled)}
                className={`${iconButtonClass} ${shuffleEnabled ? 'text-amply-accent' : ''}`}
                title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
              >
                <img
                  src={shuffleEnabled ? shuffleIcon : queueIcon}
                  alt={shuffleEnabled ? 'Shuffle' : 'In order'}
                  className={darkSurfaceIconClass}
                />
              </button>
            </div>
            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (actionBusyRef.current) {
                    return;
                  }
                  actionBusyRef.current = true;
                  void playPrevious().finally(() => {
                    actionBusyRef.current = false;
                  });
                }}
                className={iconButtonClass}
              >
                <img src={prevIcon} alt="Previous" className={darkSurfaceIconClass} />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isPlaying) {
                    pausePlayback();
                  } else {
                    resumePlayback();
                  }
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-amply-accent text-black shadow-glow transition-colors hover:bg-amply-accentHover"
              >
                <img src={isPlaying ? pauseIcon : playIcon} alt="Play/Pause" className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (actionBusyRef.current) {
                    return;
                  }
                  actionBusyRef.current = true;
                  void playNext(true).finally(() => {
                    actionBusyRef.current = false;
                  });
                }}
                className={iconButtonClass}
              >
                <img src={nextIcon} alt="Next" className={darkSurfaceIconClass} />
              </button>
            </div>
            <div className="flex flex-1 items-center justify-start">
              <button
                type="button"
                onClick={toggleLoopSong}
                className={`${iconButtonClass} ${isLooping ? 'text-amply-accent' : ''}`}
                title={isLooping ? 'Loop on' : 'Loop off'}
              >
                <img src={isLooping ? repeatOnIcon : repeatIcon} alt="Loop song" className={darkSurfaceIconClass} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-amply-textMuted">
            <span className="w-9 text-right">{formatDuration(positionSec)}</span>
            <div className="relative h-1 flex-1 rounded-full bg-[#3a3a3a]">
              <div className="absolute left-0 top-0 h-1 rounded-full bg-amply-accent" style={{ width: `${progressPercent}%` }} />
              <input
                type="range"
                min={0}
                max={durationSec || 1}
                step={0.1}
                value={positionSec}
                onChange={(event) => seekTo(Number(event.target.value))}
                className="absolute left-0 top-[-6px] h-4 w-full cursor-pointer appearance-none bg-transparent"
              />
            </div>
            <span className="w-9">{formatDuration(durationSec)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Link
            to="/now-playing"
            onClick={() => setNowPlayingTab('queue')}
            className="rounded-lg border border-amply-border/60 p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
            title="Queue"
          >
            <img src={queueIcon} alt="Queue" className={panelIconClass} />
          </Link>
          <Link
            to="/now-playing"
            onClick={() => setNowPlayingTab('lyrics')}
            className="rounded-lg border border-amply-border/60 p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
            title="Lyrics"
          >
            <img src={lyricsIcon} alt="Lyrics" className={panelIconClass} />
          </Link>
          <label className="ml-2 flex items-center gap-2 text-[12px] text-amply-textSecondary">
            Vol
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="h-1 w-24 cursor-pointer accent-amply-accent"
            />
          </label>
        </div>
      </div>
    </footer>
  );
};

export default PlayerBar;
