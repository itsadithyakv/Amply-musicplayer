import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackProgress } from '@/store/playbackProgressStore';

/**
 * Playback position for a progress slider. While the thumb is being dragged the
 * scrub value is shown instead of the live position; the seek itself only
 * happens on commit (thumb release / key up). After a commit the scrub value is
 * held until the store reports a new position, so the label does not jump back.
 */
export const useScrubbedProgress = () => {
  const livePositionSec = usePlaybackProgress((progress) => progress.positionSec);
  const durationSec = usePlaybackProgress((progress) => progress.durationSec);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const [scrubSec, setScrubSec] = useState<number | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    if (committedRef.current) {
      committedRef.current = false;
      setScrubSec(null);
    }
  }, [livePositionSec]);

  const onScrub = useCallback((value: number) => {
    committedRef.current = false;
    setScrubSec(value);
  }, []);

  const onSeek = useCallback(
    (value: number) => {
      setScrubSec(value);
      committedRef.current = true;
      seekTo(value);
    },
    [seekTo],
  );

  return {
    positionSec: scrubSec ?? livePositionSec,
    durationSec,
    onScrub,
    onSeek,
  };
};
