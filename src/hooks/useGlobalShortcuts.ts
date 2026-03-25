import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';

export const useGlobalShortcuts = (): void => {
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const positionSec = usePlayerStore((state) => state.positionSec);
  const durationSec = usePlayerStore((state) => state.durationSec);

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
        void playNext(true);
        return;
      }

      if (event.code === 'ArrowLeft' && event.shiftKey) {
        event.preventDefault();
        void playPrevious();
        return;
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault();
        const nextPos = Math.min(durationSec || positionSec + 5, positionSec + 5);
        seekTo(nextPos);
        return;
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        const nextPos = Math.max(0, positionSec - 5);
        seekTo(nextPos);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayPause, playNext, playPrevious, seekTo, positionSec, durationSec]);
};
