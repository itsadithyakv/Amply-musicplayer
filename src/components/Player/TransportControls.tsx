import { memo, type MutableRefObject } from 'react';
import { IconButton } from '@/components/ui';
import { beginControlInteraction } from '@/services/controlInteraction';
import { usePlayerStore } from '@/store/playerStore';

interface PrimaryTransportProps {
  /** Guards previous/next against double-fire while a track change is in flight. */
  actionBusyRef: MutableRefObject<boolean>;
}

/** Previous / play-pause / next. */
export const PrimaryTransport = memo(({ actionBusyRef }: PrimaryTransportProps) => {
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const pausePlayback = usePlayerStore((state) => state.pausePlayback);
  const resumePlayback = usePlayerStore((state) => state.resumePlayback);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);

  return (
    <div className="flex items-center justify-center gap-2">
      <IconButton
        name="prev"
        label="Previous"
        variant="ghost"
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
      />
      <IconButton
        name={isPlaying ? 'pause' : 'play'}
        label={isPlaying ? 'Pause' : 'Play'}
        size="lg"
        variant="accent"
        onClick={() => {
          const finishInteraction = beginControlInteraction('play-pause', isPlaying ? 'Pausing...' : 'Resuming...');
          if (isPlaying) {
            pausePlayback();
          } else {
            resumePlayback();
          }
          finishInteraction();
        }}
      />
      <IconButton
        name="next"
        label="Next"
        variant="ghost"
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
      />
    </div>
  );
});
PrimaryTransport.displayName = 'PrimaryTransport';

/** Full transport row: shuffle, primary transport, loop. */
export const TransportControls = memo(({ actionBusyRef }: PrimaryTransportProps) => {
  const shuffleEnabled = usePlayerStore((state) => state.shuffleEnabled);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const setShuffleEnabled = usePlayerStore((state) => state.setShuffleEnabled);
  const toggleLoopSong = usePlayerStore((state) => state.toggleLoopSong);
  const isLooping = repeatMode === 'one';

  return (
    <div className="flex items-center gap-2">
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
      <PrimaryTransport actionBusyRef={actionBusyRef} />
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
  );
});
TransportControls.displayName = 'TransportControls';
