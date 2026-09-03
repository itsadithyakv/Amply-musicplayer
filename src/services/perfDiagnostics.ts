import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';

type PerfEvent = {
  id: number;
  at: number;
  name: string;
  category: 'mark' | 'event' | 'measure';
  durationMs?: number;
  data?: Record<string, unknown>;
};

type PerfSnapshot = {
  startupAt: number;
  updatedAt: number;
  events: PerfEvent[];
  counters: Record<string, number>;
  lastMeasures: Record<string, number>;
};

type PerfMode = 'off' | 'sampled' | 'full';

type BackgroundTaskStatus = 'completed' | 'failed' | 'skipped' | 'cancelled';

const PERF_PATH = 'system/perf_diagnostics.json';
const MAX_EVENTS = 400;
const PERF_MODE_STORAGE_KEY = 'amply.perf-mode';
const persistedDefault: PerfSnapshot = {
  startupAt: Date.now(),
  updatedAt: Date.now(),
  events: [],
  counters: {},
  lastMeasures: {},
};

const listeners = new Set<() => void>();
const measureStarts = new Map<string, number>();
const devWarningLastSeen = new Map<string, number>();
let nextEventId = 0;
let hydrated = false;
let snapshot: PerfSnapshot = { ...persistedDefault };
let perfMode: PerfMode =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV ? 'full' : 'sampled';

const notify = (): void => {
  listeners.forEach((listener) => listener());
};

const resolvePerfMode = (): PerfMode => {
  if (typeof window === 'undefined') {
    return perfMode;
  }
  const explicit = window.localStorage.getItem(PERF_MODE_STORAGE_KEY);
  if (explicit === 'off' || explicit === 'sampled' || explicit === 'full') {
    return explicit;
  }
  return perfMode;
};

const shouldCapture = (mode = resolvePerfMode()): boolean => mode !== 'off';
const shouldPersist = (mode = resolvePerfMode()): boolean => mode === 'full';

const isDev = (): boolean => typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

const isPlaybackBusy = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return (window as unknown as { __AMP_IS_PLAYING__?: boolean }).__AMP_IS_PLAYING__ === true;
};

const warnDevBudget = (key: string, message: string, data?: Record<string, unknown>): void => {
  if (!isDev() || typeof console === 'undefined') {
    return;
  }
  const now = Date.now();
  const lastSeen = devWarningLastSeen.get(key) ?? 0;
  if (now - lastSeen < 5000) {
    return;
  }
  devWarningLastSeen.set(key, now);
  console.warn(`[Amply perf] ${message}`, data ?? {});
};

const persist = (): void => {
  if (!shouldPersist()) {
    return;
  }
  snapshot.updatedAt = Date.now();
  void writeStorageJsonDebounced(PERF_PATH, snapshot, 1200);
};

const pushEvent = (event: Omit<PerfEvent, 'id' | 'at'>): void => {
  const mode = resolvePerfMode();
  if (!shouldCapture(mode)) {
    return;
  }

  const counters = {
    ...snapshot.counters,
    [event.name]: (snapshot.counters[event.name] ?? 0) + 1,
  };
  const lastMeasures =
    typeof event.durationMs === 'number'
      ? {
          ...snapshot.lastMeasures,
          [event.name]: event.durationMs,
        }
      : snapshot.lastMeasures;

  snapshot = {
    ...snapshot,
    updatedAt: Date.now(),
    counters,
    lastMeasures,
    events:
      mode === 'full'
        ? [
            ...snapshot.events,
            {
              id: ++nextEventId,
              at: Date.now(),
              ...event,
            },
          ].slice(-MAX_EVENTS)
        : snapshot.events,
  };
  notify();
  if (mode === 'full') {
    persist();
  }
};

export const hydratePerfDiagnostics = async (): Promise<void> => {
  if (hydrated) {
    return;
  }
  hydrated = true;
  perfMode = resolvePerfMode();
  if (!shouldPersist(perfMode)) {
    snapshot = {
      ...persistedDefault,
      startupAt: Date.now(),
      updatedAt: Date.now(),
      events: [],
      counters: {},
      lastMeasures: {},
    };
    notify();
    return;
  }

  const persisted = await readStorageJson<PerfSnapshot>(PERF_PATH, persistedDefault);
  snapshot = {
    startupAt: persisted.startupAt || Date.now(),
    updatedAt: persisted.updatedAt || Date.now(),
    events: Array.isArray(persisted.events) ? persisted.events.slice(-MAX_EVENTS) : [],
    counters: persisted.counters ?? {},
    lastMeasures: persisted.lastMeasures ?? {},
  };
  nextEventId = snapshot.events[snapshot.events.length - 1]?.id ?? 0;
  notify();
};

export const markPerf = (name: string, data?: Record<string, unknown>): void => {
  if (!shouldCapture()) {
    return;
  }
  measureStarts.set(name, Date.now());
  pushEvent({ name, category: 'mark', data });
};

export const recordPerfEvent = (name: string, data?: Record<string, unknown>): void => {
  pushEvent({ name, category: 'event', data });
};

export const recordPlaybackLatency = (name: string, ms: number): void => {
  const budgetMs = name.includes('next') || name.includes('previous') ? 350 : 120;
  const overBudget = ms > budgetMs;
  if (overBudget) {
    warnDevBudget(`playback-latency:${name}`, `${name} exceeded ${budgetMs}ms budget`, {
      durationMs: Math.round(ms),
      budgetMs,
    });
  }
  pushEvent({
    name: `playback.latency.${name}`,
    category: 'measure',
    durationMs: ms,
    data: {
      budgetMs,
      overBudget,
    },
  });
};

export const recordBudgetLatency = (name: string, ms: number, budgetMs: number): void => {
  const overBudget = ms > budgetMs;
  if (overBudget) {
    warnDevBudget(`budget-latency:${name}`, `${name} exceeded ${budgetMs}ms budget`, {
      durationMs: Math.round(ms),
      budgetMs,
    });
  }
  pushEvent({
    name: `latency.${name}`,
    category: 'measure',
    durationMs: ms,
    data: {
      budgetMs,
      overBudget,
    },
  });
};

export const recordBackgroundTask = (name: string, status: BackgroundTaskStatus, durationMs: number): void => {
  pushEvent({
    name: `background.${name}`,
    category: typeof durationMs === 'number' && durationMs > 0 ? 'measure' : 'event',
    durationMs,
    data: { status },
  });
};

export const recordSelectorRebuild = (selector: string): void => {
  if (isPlaybackBusy()) {
    warnDevBudget(`selector-playback:${selector}`, `${selector} selector rebuilt during playback`, {
      selector,
    });
  }
  pushEvent({
    name: `selector.${selector}.rebuild`,
    category: 'event',
  });
};

export const recordSelectorCacheHit = (selector: string): void => {
  pushEvent({
    name: `selector.${selector}.cache-hit`,
    category: 'event',
  });
};

export const recordFullLibraryWrite = (reason: string, data?: Record<string, unknown>): void => {
  if (isPlaybackBusy()) {
    warnDevBudget('full-library-write-playback', 'Full library write happened while playback is active', {
      reason,
      ...(data ?? {}),
    });
  }
  pushEvent({
    name: 'storage.library.full-write',
    category: 'event',
    data: { reason, ...(data ?? {}) },
  });
};

export const recordSongArrayReplacement = (reason: string, data?: Record<string, unknown>): void => {
  pushEvent({
    name: 'library.songs.replaced',
    category: 'event',
    data: { reason, ...(data ?? {}) },
  });
};

export const getPerformanceSnapshot = (): PerfSnapshot => snapshot;

export const subscribePerformanceSnapshot = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const endPerfMeasure = (name: string, data?: Record<string, unknown>): void => {
  const started = measureStarts.get(name);
  if (!started || !shouldCapture()) {
    return;
  }
  measureStarts.delete(name);
  pushEvent({ name, category: 'measure', durationMs: Date.now() - started, data });
};

export const measurePerfAsync = async <T>(
  name: string,
  fn: () => Promise<T>,
  data?: Record<string, unknown>,
): Promise<T> => {
  const startedAt = Date.now();
  if (shouldCapture()) {
    pushEvent({ name, category: 'mark', data: { ...(data ?? {}), phase: 'start' } });
  }
  try {
    return await fn();
  } finally {
    if (shouldCapture()) {
      pushEvent({
        name,
        category: 'measure',
        durationMs: Date.now() - startedAt,
        data,
      });
    }
  }
};

type PerfInteractionHandle = {
  end: (data?: Record<string, unknown>) => void;
  cancel: (data?: Record<string, unknown>) => void;
};

export const beginPerfInteraction = (
  name: string,
  data?: Record<string, unknown>,
): PerfInteractionHandle => {
  const startedAt = Date.now();
  let finished = false;
  if (shouldCapture()) {
    pushEvent({
      name: `${name}.start`,
      category: 'event',
      data: {
        kind: 'interaction',
        ...(data ?? {}),
      },
    });
  }

  const complete = (phase: 'settled' | 'cancelled', extra?: Record<string, unknown>) => {
    if (finished || !shouldCapture()) {
      return;
    }
    finished = true;
    pushEvent({
      name,
      category: 'measure',
      durationMs: Date.now() - startedAt,
      data: {
        kind: 'interaction',
        phase,
        ...(data ?? {}),
        ...(extra ?? {}),
      },
    });
  };

  return {
    end: (extra) => complete('settled', extra),
    cancel: (extra) => complete('cancelled', extra),
  };
};
