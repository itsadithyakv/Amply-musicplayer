import { beginControlInteraction } from '@/services/controlInteraction';
import clsx from 'clsx';
import { memo, useEffect, useRef } from 'react';
import { IconButton, Slider } from '@/components/ui';
import LyricsViewer from '@/components/LyricsViewer/LyricsViewer';
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { useScrubbedProgress } from '@/components/Player/useScrubbedProgress';
import { usePlayerStore } from '@/store/playerStore';
import { formatDuration } from '@/utils/time';
import { beginInteractionFeedback } from '@/services/interactionFeedback';
import { beginTrackedInteraction, cancelTrackedInteraction, scheduleAfterPaint, settleTrackedInteraction } from '@/services/interactionTrace';
import { useLyricsView, useNowPlayingView } from '@/hooks/useLibraryViews';
import { QueuePanel } from '@/pages/NowPlaying/QueuePanel';
import { TabHeader, type NowPlayingTabId } from '@/pages/NowPlaying/TabHeader';

const NowPlayingHero = memo(({ hidden }: { hidden: boolean }) => {
  const { song, isPlaying, shuffleEnabled, repeatMode } = useNowPlayingView();
  const { positionSec, durationSec, onScrub, onSeek } = useScrubbedProgress();
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const playNext = usePlayerStore((state) => state.playNext);
  const setShuffleEnabled = usePlayerStore((state) => state.setShuffleEnabled);
  const toggleLoopSong = usePlayerStore((state) => state.toggleLoopSong);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);

  const isLooping = repeatMode === 'one';

  return (
    <section className={hidden ? 'hidden' : 'grid grid-cols-[minmax(260px,320px)_minmax(0,1fr)] gap-8'}>
      <div className={`neu-well aspect-square w-full max-w-[320px] overflow-hidden rounded-lg transition-transform duration-500 ${isPlaying ? 'anim-float' : ''}`}>
        {song?.albumArt ? <ArtworkImage src={song.albumArt} alt={song.album} className="h-full w-full object-cover" loading="eager" forceReady /> : null}
      </div>

      <div className="flex flex-col justify-center gap-5">
        <div>
          <p className="text-[18px] font-bold text-amply-textPrimary">{song?.title ?? 'No song selected'}</p>
          <div className="flex flex-wrap items-center gap-3 text-[14px] font-medium text-amply-textSecondary">
            <div className="neu-well h-10 w-10 overflow-hidden rounded-sm">
              <ArtworkImage src={song?.albumArt} alt={song?.artist ?? 'Artist'} className="h-full w-full object-cover" loading="eager" forceReady />
            </div>
            <span>{song?.artist ?? 'Pick a track from Library'}</span>
            {song?.album ? <span className="text-[12px] text-amply-textMuted">{song.album}</span> : null}
          </div>
        </div>

        <div className="space-y-1">
          <Slider
            value={positionSec}
            min={0}
            max={durationSec || 1}
            step={0.1}
            onChange={onScrub}
            onCommit={onSeek}
            ariaLabel="Playback position"
            formatValue={formatDuration}
          />
          <div className="flex justify-between text-[12px] tabular-nums text-amply-textMuted">
            <span>{formatDuration(positionSec)}</span>
            <span>{formatDuration(durationSec)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-1 items-center justify-end">
            <IconButton
              name={shuffleEnabled ? 'shuffle' : 'queue'}
              label={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
              variant="ghost"
              active={shuffleEnabled}
              accentIcon={shuffleEnabled}
              onClick={() => setShuffleEnabled(!shuffleEnabled)}
            />
          </div>
          <div className="flex items-center justify-center gap-3">
            <IconButton
              name="prev"
              label="Previous"
              variant="ghost"
              onClick={() => {
                const finishInteraction = beginControlInteraction('previous', 'Opening previous track...');
                void playPrevious().finally(() => {
                  finishInteraction();
                });
              }}
            />
            <IconButton
              name={isPlaying ? 'pause' : 'play'}
              label={isPlaying ? 'Pause' : 'Play'}
              size="xl"
              variant="accent"
              className={isPlaying ? 'anim-pulse-ring' : undefined}
              onClick={() => {
                const finishInteraction = beginControlInteraction('play-pause', isPlaying ? 'Pausing...' : 'Resuming...');
                togglePlayPause();
                finishInteraction();
              }}
            />
            <IconButton
              name="next"
              label="Next"
              variant="ghost"
              onClick={() => {
                const finishInteraction = beginControlInteraction('next', 'Opening next track...');
                void playNext(true).finally(() => {
                  finishInteraction();
                });
              }}
            />
          </div>
          <div className="flex flex-1 items-center justify-start">
            <IconButton
              name={isLooping ? 'repeat-on' : 'repeat'}
              label={isLooping ? 'Loop on' : 'Loop off'}
              variant="ghost"
              active={isLooping}
              accentIcon={isLooping}
              onClick={toggleLoopSong}
            />
          </div>
        </div>
      </div>
    </section>
  );
});
NowPlayingHero.displayName = 'NowPlayingHero';

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

  const handleTabSelect = (tab: NowPlayingTabId) => {
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
