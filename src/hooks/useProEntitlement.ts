import { useEffect } from 'react';
import { useProStore } from '@/store/proStore';

const FOCUS_REFRESH_INTERVAL_MS = 30 * 60_000;

/**
 * Keeps Pro in step with the Store: at launch, and on returning to the window at most every half
 * hour, which picks up a purchase made on another PC or a refund without a restart.
 */
export const useProEntitlement = () => {
  useEffect(() => {
    const { refresh } = useProStore.getState();
    void refresh();
    let lastRefresh = Date.now();
    const onFocus = () => {
      if (Date.now() - lastRefresh >= FOCUS_REFRESH_INTERVAL_MS) {
        lastRefresh = Date.now();
        void refresh();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
};
