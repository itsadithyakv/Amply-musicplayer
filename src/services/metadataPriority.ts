/**
 * Global metadata priority system
 * Tracks user activity to prioritize basic playback over expensive metadata operations
 */

let lastSongChangeTime = 0;
let rapidChangeTimeout: number | null = null;
let isRapidlyChanging = false;

export const notifySongChange = (): void => {
  const now = Date.now();
  const timeSinceLastChange = now - lastSongChangeTime;
  lastSongChangeTime = now;

  // If user is changing songs rapidly (< 3 seconds), delay expensive operations
  if (timeSinceLastChange < 3000) {
    isRapidlyChanging = true;

    // Clear any existing timeout
    if (rapidChangeTimeout) {
      window.clearTimeout(rapidChangeTimeout);
    }

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

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (rapidChangeTimeout) {
      window.clearTimeout(rapidChangeTimeout);
    }
  });
}
