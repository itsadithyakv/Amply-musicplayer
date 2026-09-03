import { beginPerfInteraction } from '@/services/perfDiagnostics';

type TrackedInteractionHandle = ReturnType<typeof beginPerfInteraction>;

const MAX_PENDING_INTERACTIONS = 200;
const pendingInteractions = new Map<string, TrackedInteractionHandle>();

export const beginTrackedInteraction = (
  key: string,
  name: string,
  data?: Record<string, unknown>,
): TrackedInteractionHandle => {
  pendingInteractions.get(key)?.cancel({ reason: 'replaced' });
  // Delete before re-inserting so the key moves to the end of the Map's insertion order.
  pendingInteractions.delete(key);
  if (pendingInteractions.size >= MAX_PENDING_INTERACTIONS) {
    const oldestKey = pendingInteractions.keys().next().value;
    if (oldestKey !== undefined) {
      pendingInteractions.get(oldestKey)?.cancel({ reason: 'evicted' });
      pendingInteractions.delete(oldestKey);
    }
  }
  const handle = beginPerfInteraction(name, data);
  pendingInteractions.set(key, handle);
  return handle;
};

export const settleTrackedInteraction = (key: string, data?: Record<string, unknown>): void => {
  const handle = pendingInteractions.get(key);
  if (!handle) {
    return;
  }
  pendingInteractions.delete(key);
  handle.end(data);
};

export const cancelTrackedInteraction = (key: string, data?: Record<string, unknown>): void => {
  const handle = pendingInteractions.get(key);
  if (!handle) {
    return;
  }
  pendingInteractions.delete(key);
  handle.cancel(data);
};

export const scheduleAfterPaint = (callback: () => void, frames = 2): (() => void) => {
  if (typeof window === 'undefined') {
    callback();
    return () => {};
  }

  let cancelled = false;
  let handle = 0;
  let remaining = Math.max(1, frames);

  const tick = () => {
    if (cancelled) {
      return;
    }
    remaining -= 1;
    if (remaining <= 0) {
      callback();
      return;
    }
    handle = window.requestAnimationFrame(tick);
  };

  handle = window.requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    if (handle) {
      window.cancelAnimationFrame(handle);
    }
  };
};
