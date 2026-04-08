const getLastInteraction = (): number => {
  if (typeof window === 'undefined') {
    return 0;
  }
  const value = (window as unknown as { __AMP_LAST_INTERACTION__?: number }).__AMP_LAST_INTERACTION__;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
};

export const isMetadataActivityPaused = (idleMs = 30_000): boolean => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }
  if (document.hidden) {
    return false;
  }
  const last = getLastInteraction();
  if (!last) {
    return false;
  }
  return Date.now() - last < idleMs;
};

export const isMetadataPaused = (idleMs = 30_000): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  const userPaused = (window as unknown as { __AMP_METADATA_PAUSED__?: boolean }).__AMP_METADATA_PAUSED__ === true;
  return userPaused || isMetadataActivityPaused(idleMs);
};

export const waitForMetadataIdle = async (idleMs = 30_000, pollMs = 2000): Promise<void> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  while (isMetadataActivityPaused(idleMs)) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, pollMs));
  }
};
