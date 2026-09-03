/**
 * requestIdleCallback with a setTimeout fallback. The returned handle records which
 * scheduler produced it so cancelIdle always calls the matching cancel API.
 */

export type IdleHandle = { kind: 'idle'; id: number } | { kind: 'timeout'; id: number };

type IdleCapableGlobal = typeof globalThis & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

const idleGlobal = globalThis as IdleCapableGlobal;

export const requestIdle = (callback: () => void, options: { timeout?: number; fallbackDelayMs?: number } = {}): IdleHandle => {
  const { timeout = 1500, fallbackDelayMs = 32 } = options;
  if (typeof idleGlobal.requestIdleCallback === 'function') {
    return { kind: 'idle', id: idleGlobal.requestIdleCallback(callback, { timeout }) };
  }
  return { kind: 'timeout', id: setTimeout(callback, fallbackDelayMs) as unknown as number };
};

/** Resolve once the browser is idle (or after `timeout` ms). Use to yield inside long loops. */
export const yieldToIdle = (timeout = 300): Promise<void> =>
  new Promise<void>((resolve) => {
    requestIdle(() => resolve(), { timeout, fallbackDelayMs: 0 });
  });

export const cancelIdle = (handle: IdleHandle | null | undefined): void => {
  if (!handle) {
    return;
  }
  if (handle.kind === 'idle' && typeof idleGlobal.cancelIdleCallback === 'function') {
    idleGlobal.cancelIdleCallback(handle.id);
    return;
  }
  clearTimeout(handle.id);
};
