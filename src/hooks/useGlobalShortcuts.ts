import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';

export const useGlobalShortcuts = (): void => {
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);

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
        const position = usePlayerStore.getState().positionSec;
        const duration = usePlayerStore.getState().durationSec;
        const nextPos = Math.min(duration || position + 5, position + 5);
        usePlayerStore.getState().seekTo(nextPos);
        return;
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        const position = usePlayerStore.getState().positionSec;
        const nextPos = Math.max(0, position - 5);
        usePlayerStore.getState().seekTo(nextPos);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayPause, playNext, playPrevious]);
};
