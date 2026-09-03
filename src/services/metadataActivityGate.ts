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
  // Bounded so a permanently-active user cannot pin the caller's promise chain forever.
  const maxPolls = Math.max(1, Math.ceil(180_000 / pollMs));
  for (let i = 0; i < maxPolls && isMetadataActivityPaused(idleMs); i += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, pollMs));
  }
};
