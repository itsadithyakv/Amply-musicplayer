import { useSyncExternalStore } from 'react';

type PlaybackProgress = {
  positionSec: number;
  durationSec: number;
};

type Listener = () => void;

let snapshot: PlaybackProgress = {
  positionSec: 0,
  durationSec: 0,
};

const listeners = new Set<Listener>();

export const getPlaybackProgressSnapshot = (): PlaybackProgress => snapshot;

export const setPlaybackProgress = (positionSec: number, durationSec: number): void => {
  if (snapshot.positionSec === positionSec && snapshot.durationSec === durationSec) {
    return;
  }

  snapshot = { positionSec, durationSec };
  for (const listener of listeners) {
    listener();
  }
};

const subscribePlaybackProgress = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const usePlaybackProgress = <T,>(selector: (progress: PlaybackProgress) => T): T => {
  return useSyncExternalStore(
    subscribePlaybackProgress,
    () => selector(snapshot),
    () => selector(snapshot),
  );
};
