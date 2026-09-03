import { useEffect, useState } from 'react';
import { cancelIdle, requestIdle } from '@/utils/idle';

/** Becomes true once the browser has had an idle slot (or `delayMs` has elapsed). */
export const useIdleRender = (delayMs = 200): boolean => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const handle = requestIdle(
      () => {
        if (!cancelled) {
          setReady(true);
        }
      },
      { timeout: delayMs, fallbackDelayMs: delayMs },
    );
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  }, [delayMs]);

  return ready;
};
