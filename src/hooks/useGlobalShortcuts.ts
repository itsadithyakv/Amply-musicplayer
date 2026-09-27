import { useEffect } from 'react';
import { playbackActions, usePlayerStore } from '@/store/playerStore';
import { getPlaybackProgressSnapshot } from '@/store/playbackProgressStore';
import { scheduleInteraction } from '@/services/playbackScheduler';

const VOLUME_STEP = 0.05;
/** The volume to return to when M unmutes. */
let volumeBeforeMute = 0.85;

/** Volume change for ↑ / ↓ / M, or null for any other key. Exported for tests. */
export const nextVolumeForKey = (code: string, volume: number): number | null => {
  if (code === 'ArrowUp') {
    return Math.min(1, Math.round((volume + VOLUME_STEP) * 100) / 100);
  }
  if (code === 'ArrowDown') {
    return Math.max(0, Math.round((volume - VOLUME_STEP) * 100) / 100);
  }
  if (code === 'KeyM') {
    if (volume > 0) {
      volumeBeforeMute = volume;
      return 0;
    }
    return volumeBeforeMute > 0 ? volumeBeforeMute : 0.85;
  }
  return null;
};

export const useGlobalShortcuts = (): void => {
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // Volume keys may auto-repeat; everything else acts once per press.
      const isVolumeKey = event.code === 'ArrowUp' || event.code === 'ArrowDown';
      if (event.defaultPrevented || (event.repeat && !isVolumeKey) || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }

      const nextVolume = event.shiftKey ? null : nextVolumeForKey(event.code, usePlayerStore.getState().volume);
      if (nextVolume !== null) {
        event.preventDefault();
        const { setVolume, showToast } = usePlayerStore.getState();
        setVolume(nextVolume);
        showToast(nextVolume === 0 ? 'Muted' : `Volume ${Math.round(nextVolume * 100)}%`);
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
