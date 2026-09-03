import { useEffect, useState } from 'react';

export const useIdleRender = (delayMs = 200): boolean => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timeout: number | null = null;
    let idleHandle: number | null = null;

    const idle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }).requestIdleCallback;
    const cancelIdle = (globalThis as typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback;

    const finish = () => {
      if (!cancelled) {
        setReady(true);
      }
    };

    if (typeof idle === 'function') {
      idleHandle = idle(finish, { timeout: delayMs });
    } else {
      timeout = window.setTimeout(finish, delayMs);
    }

    return () => {
      cancelled = true;
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
      if (idleHandle !== null && typeof cancelIdle === 'function') {
        cancelIdle(idleHandle);
      }
    };
  }, [delayMs]);

  return ready;
};
