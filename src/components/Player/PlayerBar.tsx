import { Link, useLocation } from 'react-router-dom';
import { memo, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import prevIcon from '@/assets/icons/prev.svg';
import nextIcon from '@/assets/icons/next.svg';
import playIcon from '@/assets/icons/play.svg';
import pauseIcon from '@/assets/icons/pause.svg';
import shuffleIcon from '@/assets/icons/shuffle.svg';
import queueIcon from '@/assets/icons/queue.svg';
import repeatIcon from '@/assets/icons/repeat.svg';
import repeatOnIcon from '@/assets/icons/repeat-on.svg';
import lyricsIcon from '@/assets/icons/lyrics.svg';
import trashIcon from '@/assets/icons/trash.svg';
import addIcon from '@/assets/icons/add.svg';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { formatDuration } from '@/utils/time';
import { beginInteractionFeedback } from '@/services/interactionFeedback';
import { beginPerfInteraction } from '@/services/perfDiagnostics';
import { beginTrackedInteraction, scheduleAfterPaint } from '@/services/interactionTrace';
import { usePlaybackProgress } from '@/store/playbackProgressStore';
import { usePlayerBarView } from '@/hooks/useLibraryViews';

const iconButtonClass = 'rounded-full p-2.5 text-amply-textSecondary transition-colors hover:bg-amply-hover hover:text-amply-textPrimary';
const darkSurfaceIconClass = 'ui-icon h-5 w-5';
const panelIconClass = 'ui-icon h-4 w-4';

const settleVisualInteraction = (done: () => void): void => {
  scheduleAfterPaint(done);
};

const beginControlInteraction = (name: string, message: string) => {
  const perf = beginPerfInteraction(name);
  const endFeedback = beginInteractionFeedback({
    delayMs: 140,
    minVisibleMs: 150,
    message,
  });
  return () => {
    settleVisualInteraction(() => {
      perf.end();
      endFeedback();
    });
  };
};

const ProgressSection = memo(() => {
  const positionSec = usePlaybackProgress((progress) => progress.positionSec);
  const durationSec = usePlaybackProgress((progress) => progress.durationSec);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const progressPercent = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;

  return (
    <div className="flex items-center gap-2 text-[11px] text-amply-textMuted">
      <span className="w-9 text-right">{formatDuration(positionSec)}</span>
      <div className="ui-range-track relative h-1 flex-1 rounded-full">
        <div className="absolute left-0 top-0 h-1 rounded-full bg-amply-accent" style={{ width: `${progressPercent}%` }} />
        <input
          type="range"
          min={0}
          max={durationSec || 1}
          step={0.1}
          value={positionSec}
          onChange={(event) => seekTo(Number(event.target.value))}
          className="ui-progress-range absolute left-0 top-[-6px] h-4 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
      <span className="w-9">{formatDuration(durationSec)}</span>
    </div>
  );
});

const TransportControls = memo(({ actionBusyRef }: { actionBusyRef: MutableRefObject<boolean> }) => {
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const shuffleEnabled = usePlayerStore((state) => state.shuffleEnabled);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const pausePlayback = usePlayerStore((state) => state.pausePlayback);
  const resumePlayback = usePlayerStore((state) => state.resumePlayback);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const setShuffleEnabled = usePlayerStore((state) => state.setShuffleEnabled);
  const toggleLoopSong = usePlayerStore((state) => state.toggleLoopSong);
  const isLooping = repeatMode === 'one';

  return (
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
            const finishInteraction = beginControlInteraction('previous', 'Opening previous track...');
            void playPrevious().finally(() => {
              actionBusyRef.current = false;
              finishInteraction();
            });
          }}
          className={iconButtonClass}
        >
          <img src={prevIcon} alt="Previous" className={darkSurfaceIconClass} />
        </button>
        <button
          type="button"
          onClick={() => {
            const finishInteraction = beginControlInteraction('play-pause', isPlaying ? 'Pausing...' : 'Resuming...');
            if (isPlaying) {
              pausePlayback();
            } else {
              resumePlayback();
            }
            finishInteraction();
          }}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-amply-accent text-black shadow-glow transition-colors hover:bg-amply-accentHover"
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
            const finishInteraction = beginControlInteraction('next', 'Opening next track...');
            void playNext(true).finally(() => {
              actionBusyRef.current = false;
              finishInteraction();
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
  );
});

const RightControls = memo(() => {
  const location = useLocation();
  const { currentSongId, nowPlayingTab, song, volume } = usePlayerBarView();
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const deleteCurrentSong = usePlayerStore((state) => state.deleteCurrentSong);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!currentSongId) {
      setConfirmDeleteOpen(false);
      setDeleteBusy(false);
    }
  }, [currentSongId]);

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <Link
          to="/now-playing"
          onClick={() => {
            if (location.pathname !== '/now-playing') {
              beginTrackedInteraction('route:now-playing', 'now-playing-open', { source: 'player-bar', target: 'queue' });
            }
            if (location.pathname !== '/now-playing' || nowPlayingTab !== 'queue') {
              beginTrackedInteraction('now-playing-tab', 'queue-tab-open', { source: 'player-bar' });
            }
            setNowPlayingTab('queue');
          }}
          className="ui-control-surface rounded-2xl p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
          title="Queue"
        >
          <img src={queueIcon} alt="Queue" className={panelIconClass} />
        </Link>
        <Link
          to="/now-playing"
          onClick={() => {
            if (location.pathname !== '/now-playing') {
              beginTrackedInteraction('route:now-playing', 'now-playing-open', { source: 'player-bar', target: 'lyrics' });
            }
            if (location.pathname !== '/now-playing' || nowPlayingTab !== 'lyrics') {
              beginTrackedInteraction('now-playing-tab', 'lyrics-tab-open', { source: 'player-bar' });
            }
            setNowPlayingTab('lyrics');
          }}
          className="ui-control-surface rounded-2xl p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
          title="Lyrics"
        >
          <img src={lyricsIcon} alt="Lyrics" className={panelIconClass} />
        </Link>
        <button
          type="button"
          onClick={() => {
            if (!currentSongId || deleteBusy) {
              return;
            }
            setConfirmDeleteOpen(true);
          }}
          disabled={!currentSongId || deleteBusy}
          className="ui-control-surface rounded-2xl p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-40"
          title="Delete song"
        >
          <img src={trashIcon} alt="Delete song" className={panelIconClass} />
        </button>
        <label className="ml-2 flex items-center gap-2 rounded-full px-2 text-[11px] uppercase tracking-[0.16em] text-amply-textMuted">
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

      {confirmDeleteOpen && typeof document !== 'undefined' ? createPortal(
        <div
          className="ui-modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center p-4 backdrop-blur-md"
          onClick={() => {
            if (!deleteBusy) {
              setConfirmDeleteOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-song-title"
            className="ui-soft-card w-full max-w-md rounded-[28px] border border-amply-border/70 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-amply-border/60 pb-3">
              <p id="delete-song-title" className="text-[12px] uppercase tracking-[0.2em] text-amply-textMuted">Delete song</p>
              <p className="mt-2 text-[14px] font-medium text-amply-textPrimary">
                Delete {song?.title ?? 'this song'} from your device?
              </p>
              <p className="mt-1 text-[12px] text-amply-textSecondary">
                This removes the local file, not just the track from Amply.
              </p>
            </div>

            {song ? (
              <div className="mt-4 rounded-xl border border-amply-border/60 bg-amply-bgSecondary/60 px-3 py-2">
                <p className="truncate text-[13px] font-semibold text-amply-textPrimary">{song.title}</p>
                <p className="truncate text-[12px] text-amply-textSecondary">
                  {song.artist} - {song.album}
                </p>
              </div>
            ) : null}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteOpen(false)}
                disabled={deleteBusy}
                className="rounded-md border border-amply-border/60 px-3 py-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!currentSongId || deleteBusy) {
                    return;
                  }
                  setDeleteBusy(true);
                  void deleteCurrentSong().finally(() => {
                    setDeleteBusy(false);
                    setConfirmDeleteOpen(false);
                  });
                }}
                disabled={!currentSongId || deleteBusy}
                className="rounded-md bg-[#d74c4c] px-3 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#e15c5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteBusy ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
});

const SongInfoSection = memo(() => {
  const location = useLocation();
  const { song, customPlaylists } = usePlayerBarView();
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const addSongToCustomPlaylist = useLibraryStore((state) => state.addSongToCustomPlaylist);
  const upsertCustomPlaylist = useLibraryStore((state) => state.upsertCustomPlaylist);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [favoritePulse, setFavoritePulse] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState<string | null>(null);
  const [playlistMessage, setPlaylistMessage] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const favoriteMessageRef = useRef<number | null>(null);
  const playlistMessageRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (favoriteMessageRef.current) {
        window.clearTimeout(favoriteMessageRef.current);
      }
      if (playlistMessageRef.current) {
        window.clearTimeout(playlistMessageRef.current);
      }
    };
  }, []);

  return (
    <div className="relative flex min-w-0 items-center gap-3">
      <Link
        to="/now-playing"
        onClick={() => {
          if (location.pathname !== '/now-playing') {
            beginTrackedInteraction('route:now-playing', 'now-playing-open', { source: 'player-bar-song-info' });
          }
        }}
        className="flex min-w-0 items-center gap-3 rounded-xl p-2 transition-colors hover:bg-amply-hover"
      >
        <ArtworkImage
          src={song?.albumArt}
          alt={song?.album ?? 'Unknown Album'}
          className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800"
          loading="eager"
          forceReady
        />
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
          }}
          className={`rounded-lg border border-amply-border/60 p-2 transition-colors ${
            song?.favorite ? 'border-amply-accent text-amply-accent shadow-glow' : 'text-amply-textSecondary hover:bg-amply-hover'
          }`}
          title="Favorite"
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

      {showPlaylistPicker && typeof document !== 'undefined' ? createPortal(
        <div
          className="ui-modal-backdrop fixed inset-0 z-[1000] flex items-center justify-center p-4 backdrop-blur-md"
          onClick={() => setShowPlaylistPicker(false)}
        >
          <div
            className="max-h-[min(86vh,620px)] w-full max-w-md overflow-hidden rounded-2xl border border-amply-border/60 bg-amply-surface p-4 shadow-card"
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
        </div>,
        document.body,
      ) : null}
    </div>
  );
});

const GameModeBar = memo(({ actionBusyRef }: { actionBusyRef: MutableRefObject<boolean> }) => {
  const { song, isPlaying, volume } = usePlayerBarView();
  const pausePlayback = usePlayerStore((state) => state.pausePlayback);
  const resumePlayback = usePlayerStore((state) => state.resumePlayback);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const setVolume = usePlayerStore((state) => state.setVolume);

  return (
    <footer className="relative z-50 h-[88px] border-t border-amply-border/60 bg-amply-surface/86 px-5 py-2 shadow-[var(--amply-footer-shadow)] backdrop-blur-2xl">
      <div className="grid h-full grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4">
        <Link to="/now-playing" className="flex min-w-0 items-center gap-3 rounded-2xl px-2 py-2.5 transition-colors hover:bg-amply-hover">
          <ArtworkImage
            src={song?.albumArt}
            alt={song?.album ?? 'Unknown Album'}
            className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-800"
            loading="eager"
            forceReady
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-amply-textPrimary">{song?.title ?? 'Select a playlist'}</p>
            <p className="truncate text-[12px] text-amply-textSecondary">{song ? song.artist : 'Lean playback mode'}</p>
          </div>
        </Link>

        <div className="space-y-1">
          <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (actionBusyRef.current) {
                return;
              }
              actionBusyRef.current = true;
              const finishInteraction = beginControlInteraction('previous', 'Opening previous track...');
              void playPrevious().finally(() => {
                actionBusyRef.current = false;
                finishInteraction();
              });
            }}
            className={iconButtonClass}
          >
            <img src={prevIcon} alt="Previous" className={darkSurfaceIconClass} />
          </button>
          <button
            type="button"
            onClick={() => {
              const finishInteraction = beginControlInteraction('play-pause', isPlaying ? 'Pausing...' : 'Resuming...');
              if (isPlaying) {
                pausePlayback();
              } else {
                resumePlayback();
              }
              finishInteraction();
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
              const finishInteraction = beginControlInteraction('next', 'Opening next track...');
              void playNext(true).finally(() => {
                actionBusyRef.current = false;
                finishInteraction();
              });
            }}
            className={iconButtonClass}
          >
            <img src={nextIcon} alt="Next" className={darkSurfaceIconClass} />
          </button>
        </div>
          <ProgressSection />
        </div>

        <div className="flex items-center justify-end gap-2 text-[12px] text-amply-textSecondary">
          <span>Vol</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
            className="h-1 w-24 cursor-pointer accent-amply-accent"
          />
        </div>
      </div>
    </footer>
  );
});

const PlayerBar = () => {
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const actionBusyRef = useRef(false);

  if (gameMode) {
    return <GameModeBar actionBusyRef={actionBusyRef} />;
  }

  return (
    <footer className="relative z-50 h-[88px] border-t border-amply-border/60 bg-amply-surface/86 px-5 py-2 shadow-[var(--amply-footer-shadow)] backdrop-blur-2xl">
      <div className="grid h-full grid-cols-[1.6fr_2fr_1.2fr] items-center gap-4">
        <SongInfoSection />

        <div className="space-y-1">
          <TransportControls actionBusyRef={actionBusyRef} />
          <ProgressSection />
        </div>

        <RightControls />
      </div>
    </footer>
  );
};

export default memo(PlayerBar);
