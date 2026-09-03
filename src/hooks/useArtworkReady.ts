import { useSyncExternalStore } from 'react';
import { useLibraryStore } from '@/store/libraryStore';

const isLowMemoryStartup = (): boolean =>
  typeof window !== 'undefined' &&
  (window as unknown as { __AMP_LOW_MEMORY_MODE__?: boolean; __AMP_LOW_PERF__?: boolean }).__AMP_LOW_MEMORY_MODE__ === true;

let readyOnce = false;
let startupTimer: number | null = null;
let unsubscribeLibrary: (() => void) | null = null;
const listeners = new Set<() => void>();

const getSnapshot = (): boolean =>
  readyOnce || (useLibraryStore.getState().initialized && !isLowMemoryStartup());

const markReady = (): void => {
  if (readyOnce) {
    return;
  }
  readyOnce = true;
  if (startupTimer !== null) {
    window.clearTimeout(startupTimer);
    startupTimer = null;
  }
  unsubscribeLibrary?.();
  unsubscribeLibrary = null;
  listeners.forEach((listener) => listener());
};

const startGate = (): void => {
  if (getSnapshot()) {
    markReady();
    return;
  }

  if (!unsubscribeLibrary) {
    unsubscribeLibrary = useLibraryStore.subscribe((state) => {
      if (state.initialized && !isLowMemoryStartup()) {
        markReady();
      }
    });
  }

  if (startupTimer === null) {
    startupTimer = window.setTimeout(markReady, isLowMemoryStartup() ? 4500 : 1200);
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  startGate();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && !readyOnce) {
      unsubscribeLibrary?.();
      unsubscribeLibrary = null;
      if (startupTimer !== null) {
        window.clearTimeout(startupTimer);
        startupTimer = null;
      }
    }
  };
};

export const useArtworkReady = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, () => false);
