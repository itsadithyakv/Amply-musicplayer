import { invoke } from '@tauri-apps/api/core';
import { create } from 'zustand';
import { limitSettings, type ProFeature } from '@/services/proFeatures';
import { readPreference, writePreference } from '@/services/preferences';
import { isTauri } from '@/services/storageService';
import { quietReviewPromptFor } from '@/services/storeReview';
import type { AppSettings } from '@/types/music';

interface ProStatus {
  isPro: boolean;
  storeInstall: boolean;
  offline: boolean;
  price: string | null;
}

/** The 7-day trial, once per Windows account; see `platform/trial.rs`. */
export interface TrialStatus {
  /** Never started here, so it can be offered. */
  available: boolean;
  active: boolean;
  /** Unix seconds. */
  endsAt: number | null;
}

export type PurchaseOutcome = 'purchased' | 'already-owned' | 'cancelled' | 'network-error' | 'failed' | 'store-opened';

/** What the upgrade dialog is open for. */
export type PaywallRequest = { kind: 'feature'; feature?: ProFeature } | { kind: 'intro'; features: ProFeature[] } | { kind: 'trialEnded' } | { kind: 'trialOffer' };

interface ProState extends ProStatus {
  /** Pro was bought. `isPro` is this or an active trial, and is what every lock reads. */
  owned: boolean;
  trial: TrialStatus;
  /** The Store has answered at least once since launch. */
  checked: boolean;
  busy: boolean;
  paywall: PaywallRequest | null;
  /** The last known answer, without asking the Store. Awaited before settings reach the engine. */
  load: () => Promise<void>;
  refresh: () => Promise<boolean>;
  purchase: () => Promise<PurchaseOutcome>;
  startTrial: () => Promise<boolean>;
  openPaywall: (feature?: ProFeature) => void;
  showIntro: (features: ProFeature[]) => void;
  closePaywall: () => void;
}

const FREE_STATUS: ProStatus = { isPro: false, storeInstall: false, offline: false, price: null };
const NO_TRIAL: TrialStatus = { available: false, active: false, endsAt: null };
const TRIAL_DAYS = 7;
export const BROWSER_TRIAL_PREFERENCE = 'pro.trialStartedAt';
const isDigits = (value: string): value is string => /^[0-9]*$/.test(value);

/** Browser previews have no Windows account to remember a trial; a preference stands in. */
const browserTrial = (start: boolean): TrialStatus => {
  const now = Math.floor(Date.now() / 1000);
  let startedAt = Number(readPreference(BROWSER_TRIAL_PREFERENCE, isDigits, '')) || 0;
  if (!startedAt && start) {
    startedAt = now;
    writePreference(BROWSER_TRIAL_PREFERENCE, String(startedAt));
  }
  if (!startedAt) {
    return { available: true, active: false, endsAt: null };
  }
  const endsAt = startedAt + TRIAL_DAYS * 86_400;
  return { available: false, active: now < endsAt, endsAt };
};

const readTrial = async (start = false): Promise<TrialStatus> => {
  if (!isTauri()) {
    return browserTrial(start);
  }
  try {
    return await invoke<TrialStatus>(start ? 'pro_trial_start' : 'pro_trial_status');
  } catch {
    return NO_TRIAL;
  }
};

/** The plan fields for a Store answer and a trial: bought, or trying it. */
const plan = (owned: boolean, trial: TrialStatus) => ({ owned, trial, isPro: owned || trial.active });

let trialEndTimer: ReturnType<typeof setTimeout> | null = null;

let loading: Promise<void> | null = null;

const QUIET_DAYS_AFTER_PAYWALL = 3;
const QUIET_DAYS_AFTER_PRO_NOTICE = 14;

export const useProStore = create<ProState>((set, get) => ({
  ...FREE_STATUS,
  owned: false,
  trial: NO_TRIAL,
  checked: false,
  busy: false,
  paywall: null,
  load: () => {
    loading ??= (async () => {
      const trial = await readTrial();
      if (!isTauri()) {
        set(plan(get().owned, trial));
        return;
      }
      try {
        const status = await invoke<ProStatus>('pro_status_cached');
        // A refresh that overtook this read is newer.
        if (!get().checked) {
          set({ ...status, ...plan(status.isPro, trial) });
        }
      } catch {
        // Stays free until the Store answers.
        set(plan(get().owned, trial));
      }
    })();
    return loading;
  },
  refresh: async () => {
    const trial = await readTrial();
    if (!isTauri()) {
      set({ ...plan(get().owned, trial), checked: true });
      return get().owned;
    }
    try {
      const status = await invoke<ProStatus>('pro_refresh');
      // The listing is not always readable; keep a price already shown.
      set({ ...status, ...plan(status.isPro, trial), price: status.price ?? get().price, checked: true });
      return status.isPro;
    } catch {
      set({ ...plan(get().owned, trial), checked: true });
      return get().owned;
    }
  },
  purchase: async () => {
    if (!isTauri()) {
      return 'failed';
    }
    set({ busy: true });
    try {
      const { outcome, status } = await invoke<{ outcome: PurchaseOutcome; status: ProStatus }>('pro_purchase');
      set({ ...status, ...plan(status.isPro, get().trial), price: status.price ?? get().price });
      return outcome;
    } catch {
      return 'failed';
    } finally {
      set({ busy: false });
    }
  },
  startTrial: async () => {
    const trial = await readTrial(true);
    set(plan(get().owned, trial));
    return trial.active;
  },
  openPaywall: (feature) => set({ paywall: { kind: 'feature', feature } }),
  showIntro: (features) => set({ paywall: { kind: 'intro', features } }),
  closePaywall: () => {
    const { paywall, isPro } = get();
    if (paywall && !isPro) {
      quietReviewPromptFor(paywall.kind === 'intro' ? QUIET_DAYS_AFTER_PRO_NOTICE : QUIET_DAYS_AFTER_PAYWALL);
    }
    set({ paywall: null });
  },
}));

/**
 * Ends the trial on time while Amply is open: when it runs out, `isPro` follows on its own.
 */
useProStore.subscribe((state, previous) => {
  if (state.trial.endsAt === previous.trial.endsAt && state.trial.active === previous.trial.active) {
    return;
  }
  if (trialEndTimer !== null) {
    clearTimeout(trialEndTimer);
    trialEndTimer = null;
  }
  const { endsAt, active } = state.trial;
  if (active && endsAt) {
    const delay = Math.max(1000, endsAt * 1000 - Date.now() + 1000);
    trialEndTimer = setTimeout(() => {
      void readTrial().then((trial) => useProStore.setState(plan(useProStore.getState().owned, trial)));
    }, Math.min(delay, 2 ** 31 - 1));
  }
});

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
