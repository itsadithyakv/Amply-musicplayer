import { useEffect } from 'react';
import { playbackActions, usePlayerStore } from '@/store/playerStore';
import { getPlaybackProgressSnapshot } from '@/store/playbackProgressStore';
import { scheduleInteraction } from '@/services/playbackScheduler';

export const useGlobalShortcuts = (): void => {
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayPause();
        return;
      }

      if (event.code === 'ArrowRight' && event.shiftKey) {
        event.preventDefault();
        scheduleInteraction(() => playbackActions.playNext(true), { reason: 'shortcut.next-track' });
        return;
      }

      if (event.code === 'ArrowLeft' && event.shiftKey) {
        event.preventDefault();
        scheduleInteraction(() => playbackActions.playPrevious(), { reason: 'shortcut.previous-track' });
        return;
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault();
        const { positionSec, durationSec } = getPlaybackProgressSnapshot();
        const nextPos = Math.min(durationSec || positionSec + 5, positionSec + 5);
        playbackActions.seekTo(nextPos);
        return;
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        const { positionSec } = getPlaybackProgressSnapshot();
        const nextPos = Math.max(0, positionSec - 5);
        playbackActions.seekTo(nextPos);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayPause]);
};
