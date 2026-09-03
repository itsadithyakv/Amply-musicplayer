import { isSchedulerBackgroundHidden, isSchedulerInRestoreGrace } from '@/services/appScheduler';

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
  if (isSchedulerBackgroundHidden() || isSchedulerInRestoreGrace()) {
    return true;
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

export const waitForMetadataIdle = async (idleMs = 30_000, pollMs = 2000): Promise<void> => {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return;
  }
  while (isMetadataActivityPaused(idleMs)) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, pollMs));
  }
};
