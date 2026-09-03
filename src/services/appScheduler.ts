import { cancelIdle, requestIdle, type IdleHandle } from '@/utils/idle';
import { useSyncExternalStore } from 'react';
import { endPerfMeasure, markPerf, recordPerfEvent } from '@/services/perfDiagnostics';
import { setFlags } from '@/services/runtimeFlags';

type SchedulerPhase = 'foreground-active' | 'background-hidden' | 'restore-grace-period';

type SchedulerState = {
  startupAt: number;
  visibility: DocumentVisibilityState | 'visible';
  focused: boolean;
  minimized: boolean;
  playingBusy: boolean;
  lastRestoreAt: number | null;
  lastHiddenAt: number | null;
  restoreGraceUntil: number;
};

type SchedulerRenderState = Pick<SchedulerState, 'visibility' | 'minimized' | 'lastRestoreAt' | 'restoreGraceUntil'>;

type NonCriticalTaskOptions = {
  delayMs?: number;
  timeoutMs?: number;
  reason?: string;
};

const RESTORE_GRACE_MS = 1800;
const BACKGROUND_DELAY_MS = 5000;
const listeners = new Set<() => void>();
let renderStateCache: SchedulerRenderState | null = null;
let restoreGraceTimer: number | null = null;
// Updated from wheel/pointer handlers; kept out of `state` so it never allocates or notifies.
let lastInteractionAt = Date.now();

let state: SchedulerState = {
  startupAt: Date.now(),
  visibility: typeof document === 'undefined' ? 'visible' : document.visibilityState,
  focused: typeof document === 'undefined' ? true : document.hasFocus(),
  minimized: false,
  playingBusy: false,
  lastRestoreAt: null,
  lastHiddenAt: null,
  restoreGraceUntil: 0,
};

const getPhase = (snapshot: SchedulerState = state): SchedulerPhase => {
  if (snapshot.visibility === 'hidden' || snapshot.minimized) {
    return 'background-hidden';
  }
  if (Date.now() < snapshot.restoreGraceUntil) {
    return 'restore-grace-period';
  }
  return 'foreground-active';
};

const notify = (): void => {
  listeners.forEach((listener) => listener());
};

const patchState = (patch: Partial<SchedulerState>, perfName?: string, data?: Record<string, unknown>): void => {
  const previousPhase = getPhase(state);
  state = {
    ...state,
    ...patch,
  };
  const nextPhase = getPhase(state);
  if (perfName) {
    recordPerfEvent(perfName, { phase: nextPhase, ...(data ?? {}) });
  }
  if (previousPhase !== nextPhase) {
    recordPerfEvent('scheduler.phase', { previousPhase, nextPhase });
  }
  notify();
};

const getSchedulerRenderState = (): SchedulerRenderState => {
  const next: SchedulerRenderState = {
    visibility: state.visibility,
    minimized: state.minimized,
    lastRestoreAt: state.lastRestoreAt,
    restoreGraceUntil: state.restoreGraceUntil,
  };
  if (
    renderStateCache &&
    renderStateCache.visibility === next.visibility &&
    renderStateCache.minimized === next.minimized &&
    renderStateCache.lastRestoreAt === next.lastRestoreAt &&
    renderStateCache.restoreGraceUntil === next.restoreGraceUntil
  ) {
    return renderStateCache;
  }
  renderStateCache = next;
  return next;
};

const subscribeScheduler = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useSchedulerRenderState = (): SchedulerRenderState =>
  useSyncExternalStore(subscribeScheduler, getSchedulerRenderState, getSchedulerRenderState);

export const isSchedulerBackgroundHidden = (): boolean => getPhase() === 'background-hidden';

export const isSchedulerInRestoreGrace = (): boolean => getPhase() === 'restore-grace-period';

export const shouldThrottleNonCriticalWork = (): boolean => {
  const phase = getPhase();
  return phase === 'background-hidden' || phase === 'restore-grace-period';
};

export const getNonCriticalDelay = (baseDelayMs = 0): number => {
  if (getPhase() === 'background-hidden') {
    return Math.max(baseDelayMs, BACKGROUND_DELAY_MS);
  }
  if (getPhase() === 'restore-grace-period') {
    return Math.max(baseDelayMs, Math.max(0, state.restoreGraceUntil - Date.now()));
  }
  return baseDelayMs;
};

export const noteUserInteraction = (): void => {
  // No scheduler phase derives from this timestamp, so there is no state object to rebuild and no
  // listener to notify; just record it and mirror it into the runtime flags.
  const now = Date.now();
  lastInteractionAt = now;
  setFlags({ lastInteractionAt: now });
};

export const getLastInteractionAt = (): number => lastInteractionAt;

export const setSchedulerPlayingBusy = (playingBusy: boolean): void => {
  if (state.playingBusy === playingBusy) {
    return;
  }
  patchState({ playingBusy }, 'scheduler.playing-busy', { playingBusy });
};

export const setSchedulerFocused = (focused: boolean): void => {
  if (state.focused === focused) {
    return;
  }
  patchState({ focused }, 'scheduler.focus', { focused });
  if (focused && (state.visibility === 'visible' || !state.minimized)) {
    markWindowRestored('focus');
  }
};

export const setSchedulerVisibility = (visibility: DocumentVisibilityState): void => {
  if (state.visibility === visibility) {
    return;
  }
  if (visibility === 'hidden') {
    markPerf('window.hidden');
    patchState({ visibility, lastHiddenAt: Date.now() }, 'scheduler.visibility', { visibility });
    return;
  }

  patchState({ visibility }, 'scheduler.visibility', { visibility });
  markWindowRestored('visibility');
};

export const setSchedulerMinimized = (minimized: boolean): void => {
  if (state.minimized === minimized) {
    return;
  }
  if (minimized) {
    markPerf('window.minimized');
    patchState({ minimized, lastHiddenAt: Date.now() }, 'scheduler.minimized', { minimized });
    return;
  }
  patchState({ minimized }, 'scheduler.minimized', { minimized });
  markWindowRestored('minimized');
};

export const markWindowRestored = (reason: string): void => {
  const now = Date.now();
  const restoreGraceUntil = now + RESTORE_GRACE_MS;
  patchState(
    {
      visibility: 'visible',
      minimized: false,
      lastRestoreAt: now,
      restoreGraceUntil,
    },
    'window.restored',
    { reason },
  );
  if (typeof window !== 'undefined') {
    if (restoreGraceTimer !== null) {
      window.clearTimeout(restoreGraceTimer);
    }
    restoreGraceTimer = window.setTimeout(() => {
      restoreGraceTimer = null;
      if (state.restoreGraceUntil <= Date.now()) {
        patchState({ restoreGraceUntil: 0 }, 'window.restore-grace-ended');
      }
    }, Math.max(0, restoreGraceUntil - Date.now()));
  }
  endPerfMeasure('window.hidden', { reason });
  endPerfMeasure('window.minimized', { reason });
  markPerf('window.restore-grace', { reason });
};

export const scheduleNonCriticalTask = (task: () => void, options: NonCriticalTaskOptions = {}): (() => void) => {
  if (typeof window === 'undefined') {
    task();
    return () => {};
  }

  const { delayMs = 0, timeoutMs = 1200, reason } = options;
  const effectiveDelay = getNonCriticalDelay(delayMs);
  let timeoutHandle: number | null = null;
  let idleHandle: IdleHandle | null = null;

  const run = () => {
    if (reason) {
      recordPerfEvent('scheduler.task.run', { reason, phase: getPhase() });
    }
    if (!isSchedulerBackgroundHidden()) {
      idleHandle = requestIdle(task, { timeout: timeoutMs, fallbackDelayMs: 0 });
      return;
    }
    timeoutHandle = window.setTimeout(task, 0);
  };

  timeoutHandle = window.setTimeout(run, effectiveDelay);

  return () => {
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
    }
    cancelIdle(idleHandle);
  };
};
