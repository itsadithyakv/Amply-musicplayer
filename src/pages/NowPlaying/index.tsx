import clsx from 'clsx';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import prevIcon from '@/assets/icons/prev.svg';
import nextIcon from '@/assets/icons/next.svg';
import playIcon from '@/assets/icons/play.svg';
import pauseIcon from '@/assets/icons/pause.svg';
import shuffleIcon from '@/assets/icons/shuffle.svg';
import queueIcon from '@/assets/icons/queue.svg';
import repeatIcon from '@/assets/icons/repeat.svg';
import repeatOnIcon from '@/assets/icons/repeat-on.svg';
import settingsIcon from '@/assets/icons/settings.svg';
import LyricsViewer from '@/components/LyricsViewer/LyricsViewer';
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { usePlayerStore } from '@/store/playerStore';
import { formatDuration } from '@/utils/time';
import { beginInteractionFeedback } from '@/services/interactionFeedback';
import { beginPerfInteraction } from '@/services/perfDiagnostics';
import { beginTrackedInteraction, cancelTrackedInteraction, scheduleAfterPaint, settleTrackedInteraction } from '@/services/interactionTrace';
import { usePlaybackProgress } from '@/store/playbackProgressStore';
import { useLyricsView, useNowPlayingView, useQueueView } from '@/hooks/useLibraryViews';

const darkSurfaceIconClass = 'ui-icon h-5 w-5';

const beginPageControlInteraction = (name: string, message: string) => {
  const perf = beginPerfInteraction(name);
  const endFeedback = beginInteractionFeedback({
    delayMs: 140,
    minVisibleMs: 150,
    message,
  });
  return () => {
    scheduleAfterPaint(() => {
      perf.end();
      endFeedback();
    });
  };
};

const NowPlayingHero = memo(({ hidden }: { hidden: boolean }) => {
  const { song, isPlaying, shuffleEnabled, repeatMode } = useNowPlayingView();
  const positionSec = usePlaybackProgress((progress) => progress.positionSec);
  const durationSec = usePlaybackProgress((progress) => progress.durationSec);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const playNext = usePlayerStore((state) => state.playNext);
  const setShuffleEnabled = usePlayerStore((state) => state.setShuffleEnabled);
  const toggleLoopSong = usePlayerStore((state) => state.toggleLoopSong);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);

  const progressPercent = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
  const isLooping = repeatMode === 'one';

  return (
    <section className={hidden ? 'hidden' : 'grid grid-cols-[minmax(260px,320px)_minmax(0,1fr)] gap-8'}>
      <div
        className="aspect-square w-full max-w-[320px] overflow-hidden rounded-card bg-zinc-800 shadow-card"
        style={{ aspectRatio: '1 / 1' }}
      >
        {song?.albumArt ? <ArtworkImage src={song.albumArt} alt={song.album} className="h-full w-full object-cover" loading="eager" forceReady /> : null}
      </div>

      <div className="flex flex-col justify-center gap-5">
        <div>
          <p className="text-[18px] font-bold text-amply-textPrimary">{song?.title ?? 'No song selected'}</p>
          <div className="flex flex-wrap items-center gap-3 text-[14px] font-medium text-amply-textSecondary">
            <div className="h-10 w-10 overflow-hidden rounded-xl bg-amply-bgSecondary shadow-card">
              <ArtworkImage src={song?.albumArt} alt={song?.artist ?? 'Artist'} className="h-full w-full object-cover" loading="eager" forceReady />
            </div>
            <span>{song?.artist ?? 'Pick a track from Library'}</span>
            {song?.album ? <span className="text-[12px] text-amply-textMuted">{song.album}</span> : null}
          </div>
        </div>

        <div className="space-y-2">
          <div className="relative h-1 rounded-full bg-[#404040]">
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
          <div className="flex justify-between text-[12px] text-amply-textMuted">
            <span>{formatDuration(positionSec)}</span>
            <span>{formatDuration(durationSec)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center justify-end">
            <button
              type="button"
              onClick={() => setShuffleEnabled(!shuffleEnabled)}
              className={`rounded-full p-2 ${shuffleEnabled ? 'text-amply-accent' : 'text-amply-textSecondary'} hover:bg-amply-hover`}
              title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
            >
              <img
                src={shuffleEnabled ? shuffleIcon : queueIcon}
                alt={shuffleEnabled ? 'Shuffle' : 'In order'}
                className={darkSurfaceIconClass}
              />
            </button>
          </div>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                const finishInteraction = beginPageControlInteraction('previous', 'Opening previous track...');
                void playPrevious().finally(() => {
                  finishInteraction();
                });
              }}
              className="rounded-full p-2 text-amply-textSecondary hover:bg-amply-hover"
            >
              <img src={prevIcon} alt="Previous" className={darkSurfaceIconClass} />
            </button>
            <button
              type="button"
              onClick={() => {
                const finishInteraction = beginPageControlInteraction('play-pause', isPlaying ? 'Pausing...' : 'Resuming...');
                togglePlayPause();
                finishInteraction();
              }}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-amply-accent text-black transition-colors hover:bg-amply-accentHover"
            >
              <img src={isPlaying ? pauseIcon : playIcon} alt="Play/Pause" className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => {
                const finishInteraction = beginPageControlInteraction('next', 'Opening next track...');
                void playNext(true).finally(() => {
                  finishInteraction();
                });
              }}
              className="rounded-full p-2 text-amply-textSecondary hover:bg-amply-hover"
            >
              <img src={nextIcon} alt="Next" className={darkSurfaceIconClass} />
            </button>
          </div>
          <div className="flex flex-1 items-center justify-start">
            <button
              type="button"
              onClick={toggleLoopSong}
              className={`rounded-full p-2 ${isLooping ? 'text-amply-accent' : 'text-amply-textSecondary'} hover:bg-amply-hover`}
              title={isLooping ? 'Loop on' : 'Loop off'}
            >
              <img src={isLooping ? repeatOnIcon : repeatIcon} alt="Loop song" className={darkSurfaceIconClass} />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

const QueuePanel = memo(({ active }: { active: boolean }) => {
  const { currentSongId, albumQueueView, allowReorder, items: queueDisplay } = useQueueView();
  const playSongById = usePlayerStore((state) => state.playSongById);
  const removeQueuedSong = usePlayerStore((state) => state.removeQueuedSong);
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);

  return (
    <section className={active ? 'block' : 'hidden'} aria-hidden={!active}>
      <div className="rounded-card border border-amply-border bg-amply-card">
        <div className="flex items-center justify-between border-b border-amply-border/60 px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Queue</p>
            {albumQueueView ? (
              <span className="rounded-full border border-amply-border/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-amply-textMuted">
                Album Mode
              </span>
            ) : null}
          </div>
          <span className="text-[11px] text-amply-textMuted">{queueDisplay.length} songs</span>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {queueDisplay.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-amply-textMuted">Queue is empty.</p>
          ) : (
            <div className="divide-y divide-amply-border/40">
              {queueDisplay.map((queuedSong, index) => {
                const isCurrent = queuedSong.id === currentSongId;
                return (
                  <div
                    key={`${queuedSong.id ?? 'missing'}-${queuedSong.position}-${queuedSong.title}`}
                    draggable={allowReorder}
                    onDragStart={(event) => {
                      if (!allowReorder) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData('text/queue-index', String(index));
                    }}
                    onDragOver={(event) => {
                      if (allowReorder) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      if (!allowReorder) {
                        return;
                      }
                      const from = Number(event.dataTransfer.getData('text/queue-index'));
                      reorderQueue(from, index);
                    }}
                    className={clsx(
                      'flex items-center justify-between gap-3 px-4 py-3',
                      isCurrent && 'border-l-2 border-amply-accent bg-amply-hover/60',
                      !queuedSong.available && 'opacity-40',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => {
                        if (queuedSong.available && queuedSong.id) {
                          const finishInteraction = beginPageControlInteraction('queue-item-play', 'Opening track...');
                          void playSongById(queuedSong.id).finally(() => {
                            finishInteraction();
                          });
                        }
                      }}
                    >
                      <p className="truncate text-[13px] font-medium text-amply-textPrimary">
                        {queuedSong.position}. {queuedSong.title}
                      </p>
                      <p className="truncate text-[12px] text-amply-textSecondary">{queuedSong.subtitle}</p>
                    </button>
                    {albumQueueView ? (
                      <span className="text-[11px] uppercase tracking-[0.2em] text-amply-textMuted">
                        {queuedSong.available ? 'Available' : 'Missing'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-[11px] uppercase tracking-[0.2em] text-amply-textMuted transition-colors hover:text-amply-textPrimary"
                        onClick={() => removeQueuedSong(queuedSong.id!)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
});

const TabHeader = memo(
  ({
    nowPlayingTab,
    onSelectTab,
  }: {
    nowPlayingTab: 'lyrics' | 'queue';
    onSelectTab: (tab: 'lyrics' | 'queue') => void;
  }) => {
  const albumQueueView = usePlayerStore((state) => state.albumQueueView);
  const reshuffleQueue = usePlayerStore((state) => state.reshuffleQueue);
  const isLyricsTab = nowPlayingTab === 'lyrics';
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tabs = useMemo(
    () => [
      { id: 'lyrics' as const, label: 'Lyrics' },
      { id: 'queue' as const, label: 'Queue' },
    ],
    [],
  );

  useEffect(() => {
    setSettingsOpen(false);
  }, [nowPlayingTab]);

  return (
    <div className="flex items-center justify-between border-b border-amply-border pb-2">
      <div className="flex-1" />
      <div className="flex flex-1 justify-center">
        <div className="inline-flex items-center gap-1 rounded-full border border-amply-border/60 bg-amply-bgSecondary/60 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
                nowPlayingTab === tab.id
                  ? 'bg-amply-accent text-black shadow-[0_8px_18px_rgba(236,138,42,0.22)]'
                  : 'text-amply-textSecondary hover:bg-amply-hover'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative flex flex-1 justify-end">
        <button
          type="button"
          onClick={() => setSettingsOpen((prev) => !prev)}
          className="rounded-full p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
          title="Tab settings"
        >
          <img src={settingsIcon} alt="" className={darkSurfaceIconClass} />
        </button>
        {settingsOpen ? (
          <div className="absolute right-0 top-11 z-20 w-48 rounded-xl border border-amply-border/60 bg-amply-card p-2 shadow-card">
            {isLyricsTab ? (
              <div className="space-y-1 text-[12px] text-amply-textSecondary">
                <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.2em] text-amply-textMuted">Lyrics</p>
                <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1">
                  <span>Sync</span>
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('amply://lyrics-offset', { detail: { deltaMs: -500 } }));
                      }}
                      className="rounded-full px-2 py-1 text-amply-textSecondary transition-colors hover:bg-amply-hover"
                    >
                      -
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new CustomEvent('amply://lyrics-offset', { detail: { deltaMs: 500 } }));
                      }}
                      className="rounded-full px-2 py-1 text-amply-textSecondary transition-colors hover:bg-amply-hover"
                    >
                      +
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(new CustomEvent('amply://lyrics-choose'));
                    setSettingsOpen(false);
                  }}
                  className="w-full rounded-lg px-2 py-1.5 text-left text-amply-textSecondary transition-colors hover:bg-amply-hover"
                >
                  Choose lyrics
                </button>
              </div>
            ) : (
              <div className="space-y-1 text-[12px] text-amply-textSecondary">
                <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.2em] text-amply-textMuted">Queue</p>
                {!albumQueueView ? (
                  <button
                    type="button"
                    onClick={() => {
                      reshuffleQueue();
                      setSettingsOpen(false);
                    }}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-amply-textSecondary transition-colors hover:bg-amply-hover"
                  >
                    Re-shuffle queue
                  </button>
                ) : (
                  <p className="px-2 py-1.5 text-[11px] text-amply-textMuted">Album mode active</p>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
});

const NowPlayingPage = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const nowPlayingTab = usePlayerStore((state) => state.nowPlayingTab);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const { song } = useLyricsView(currentSongId);
  const isLyricsTab = nowPlayingTab === 'lyrics';
  const tabFeedbackRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (nowPlayingTab === 'now-playing') {
      setNowPlayingTab('queue');
    }
  }, [nowPlayingTab, setNowPlayingTab]);

  const handleTabSelect = (tab: 'lyrics' | 'queue') => {
    if (tab === nowPlayingTab) {
      return;
    }
    tabFeedbackRef.current?.();
    cancelTrackedInteraction('now-playing-tab', { reason: 'superseded' });
    beginTrackedInteraction('now-playing-tab', tab === 'lyrics' ? 'lyrics-tab-open' : 'queue-tab-open', {
      from: nowPlayingTab,
    });
    tabFeedbackRef.current = beginInteractionFeedback({
      delayMs: 120,
      minVisibleMs: 160,
      message: tab === 'lyrics' ? 'Opening lyrics...' : 'Opening queue...',
    });
    setNowPlayingTab(tab);
  };

  useEffect(() => {
    if (nowPlayingTab !== 'queue') {
      return;
    }
    return scheduleAfterPaint(() => {
      settleTrackedInteraction('now-playing-tab', { target: 'queue' });
      tabFeedbackRef.current?.();
      tabFeedbackRef.current = null;
    });
  }, [nowPlayingTab]);

  useEffect(() => {
    return () => {
      tabFeedbackRef.current?.();
      tabFeedbackRef.current = null;
      cancelTrackedInteraction('now-playing-tab', { reason: 'page-unmount' });
    };
  }, []);

  return (
    <div className={clsx('flex h-full min-h-0 flex-col pt-2', isLyricsTab ? 'w-full gap-3 pb-2' : 'w-full gap-6 pb-10')}>
      <NowPlayingHero hidden={isLyricsTab} />
      <TabHeader nowPlayingTab={isLyricsTab ? 'lyrics' : 'queue'} onSelectTab={handleTabSelect} />

      <section className={isLyricsTab ? 'min-h-0 flex-1' : 'hidden'} aria-hidden={!isLyricsTab}>
        <ErrorBoundary
          fallback={
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="text-[13px] text-amply-textMuted">Lyrics failed to render. Reopen the tab and try again.</p>
            </div>
          }
        >
          <LyricsViewer
            song={song ?? null}
            active={isLyricsTab}
            fullHeight
            onShellReady={() => {
              settleTrackedInteraction('now-playing-tab', { target: 'lyrics' });
              tabFeedbackRef.current?.();
              tabFeedbackRef.current = null;
            }}
          />
        </ErrorBoundary>
      </section>

      <QueuePanel active={!isLyricsTab} />
    </div>
  );
};

export default NowPlayingPage;
