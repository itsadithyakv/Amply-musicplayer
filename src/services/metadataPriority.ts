/**
 * Global metadata priority system
 * Tracks user activity to prioritize basic playback over expensive metadata operations
 */

let lastSongChangeTime = 0;
let rapidChangeTimeout: number | null = null;
let isRapidlyChanging = false;
let removeUnloadListener: (() => void) | null = null;

const clearRapidChangeTimeout = (): void => {
  if (rapidChangeTimeout !== null) {
    window.clearTimeout(rapidChangeTimeout);
    rapidChangeTimeout = null;
  }
};

/**
 * Registers the unload cleanup for the rapid-change timer. Idempotent: repeated calls share one listener.
 * Returns a disposer that removes the listener and clears any pending timer.
 */
export const initMetadataPriority = (): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }
  if (!removeUnloadListener) {
    const handleUnload = () => clearRapidChangeTimeout();
    window.addEventListener('beforeunload', handleUnload);
    removeUnloadListener = () => {
      window.removeEventListener('beforeunload', handleUnload);
      removeUnloadListener = null;
    };
  }
  return disposeMetadataPriority;
};

export const disposeMetadataPriority = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  clearRapidChangeTimeout();
  isRapidlyChanging = false;
  removeUnloadListener?.();
};

export const notifySongChange = (): void => {
  const now = Date.now();
  const timeSinceLastChange = now - lastSongChangeTime;
  lastSongChangeTime = now;

  // If user is changing songs rapidly (< 3 seconds), delay expensive operations
  if (timeSinceLastChange < 3000) {
    isRapidlyChanging = true;
    clearRapidChangeTimeout();
    // The unload listener only matters once a timer exists, so register it lazily here.
    initMetadataPriority();

    // Set a timeout to allow expensive operations after user settles
    rapidChangeTimeout = window.setTimeout(() => {
      isRapidlyChanging = false;
      rapidChangeTimeout = null;
    }, 5000); // Wait 5 seconds after last change
  } else {
    isRapidlyChanging = false;
  }
};

export const shouldLoadExpensiveMetadata = (): boolean => {
  return !isRapidlyChanging;
};

import.meta.hot?.dispose(disposeMetadataPriority);
