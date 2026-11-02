import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { limitSettings, type ProFeature } from '@/services/proFeatures';
import { isTauri } from '@/services/storageService';
import type { AppSettings } from '@/types/music';

interface ProStatus {
  isPro: boolean;
  storeInstall: boolean;
  offline: boolean;
  price: string | null;
}

export type PurchaseOutcome = 'purchased' | 'already-owned' | 'cancelled' | 'network-error' | 'failed' | 'store-opened';

/** What the upgrade dialog is open for. */
export type PaywallRequest = { kind: 'feature'; feature?: ProFeature } | { kind: 'intro'; features: ProFeature[] };

interface ProState extends ProStatus {
  /** The Store has answered at least once since launch. */
  checked: boolean;
  busy: boolean;
  paywall: PaywallRequest | null;
  /** The last known answer, without asking the Store. Awaited before settings reach the engine. */
  load: () => Promise<void>;
  refresh: () => Promise<boolean>;
  purchase: () => Promise<PurchaseOutcome>;
  openPaywall: (feature?: ProFeature) => void;
  showIntro: (features: ProFeature[]) => void;
  closePaywall: () => void;
}

const FREE_STATUS: ProStatus = { isPro: false, storeInstall: false, offline: false, price: null };

let loading: Promise<void> | null = null;

export const useProStore = create<ProState>((set, get) => ({
  ...FREE_STATUS,
  checked: false,
  busy: false,
  paywall: null,
  load: () => {
    loading ??= (async () => {
      if (!isTauri()) {
        return;
      }
      try {
        const status = await invoke<ProStatus>('pro_status_cached');
        // A refresh that overtook this read is newer.
        if (!get().checked) {
          set(status);
        }
      } catch {
        // Stays free until the Store answers.
      }
    })();
    return loading;
  },
  refresh: async () => {
    if (!isTauri()) {
      set({ checked: true });
      return false;
    }
    try {
      const status = await invoke<ProStatus>('pro_refresh');
      // The listing is not always readable; keep a price already shown.
      set({ ...status, price: status.price ?? get().price, checked: true });
      return status.isPro;
    } catch {
      set({ checked: true });
      return get().isPro;
    }
  },
  purchase: async () => {
    if (!isTauri()) {
      return 'failed';
    }
    set({ busy: true });
    try {
      const { outcome, status } = await invoke<{ outcome: PurchaseOutcome; status: ProStatus }>('pro_purchase');
      set({ ...status, price: status.price ?? get().price });
      return outcome;
    } catch {
      return 'failed';
    } finally {
      set({ busy: false });
    }
  },
  openPaywall: (feature) => set({ paywall: { kind: 'feature', feature } }),
  showIntro: (features) => set({ paywall: { kind: 'intro', features } }),
  closePaywall: () => set({ paywall: null }),
}));

/** The settings Amply actually runs on: all of them with Pro, the free limits without. */
export const effectiveSettings = (settings: AppSettings): AppSettings =>
  useProStore.getState().isPro ? settings : limitSettings(settings);

/** True when Pro is active; otherwise opens the upgrade dialog for `feature` and returns false. */
export const requirePro = (feature: ProFeature): boolean => {
  const state = useProStore.getState();
  if (state.isPro) {
    return true;
  }
  state.openPaywall(feature);
  return false;
};
