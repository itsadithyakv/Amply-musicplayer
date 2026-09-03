import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { getFlag } from '@/services/runtimeFlags';

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
const PERSIST_DELAY_MS = 1200;
const persistedDefault: PerfSnapshot = {
  startupAt: 0,
  updatedAt: 0,
  events: [],
  counters: {},
  lastMeasures: {},
};

const listeners = new Set<() => void>();
const measureStarts = new Map<string, number>();
const devWarningLastSeen = new Map<string, number>();
let nextEventId = 0;
let hydrated = false;

// Snapshot state is kept as mutable primitives plus a fixed-capacity ring buffer so that recording an
// event never rebuilds arrays or objects. `getPerformanceSnapshot()` materialises (and caches) a
// PerfSnapshot on demand; `version` tells it when that cache is stale.
const eventRing: Array<PerfEvent | undefined> = new Array(MAX_EVENTS);
let ringHead = 0; // slot the next event is written to
let ringSize = 0;
let startupAt = Date.now();
let updatedAt = startupAt;
let counters: Record<string, number> = {};
let lastMeasures: Record<string, number> = {};
let version = 0;
let cachedSnapshot: PerfSnapshot | null = null;
let cachedSnapshotVersion = -1;
let persistTimer: number | null = null;

const defaultPerfMode: PerfMode =
  typeof import.meta !== 'undefined' && import.meta.env?.DEV ? 'full' : 'sampled';
// `undefined` = localStorage not consulted yet; `null` = consulted, nothing stored.
let storedPerfMode: PerfMode | null | undefined;

const isPerfMode = (value: unknown): value is PerfMode =>
  value === 'off' || value === 'sampled' || value === 'full';

const readStoredPerfMode = (): PerfMode | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const explicit = window.localStorage.getItem(PERF_MODE_STORAGE_KEY);
    return isPerfMode(explicit) ? explicit : null;
  } catch {
    return null;
  }
};

const resolvePerfMode = (): PerfMode => {
  if (storedPerfMode === undefined) {
    storedPerfMode = readStoredPerfMode();
  }
  return storedPerfMode ?? defaultPerfMode;
};

/** Override the perf mode (persisted in localStorage). Pass `null` to fall back to the build default. */
export const setPerfMode = (mode: PerfMode | null): void => {
  storedPerfMode = mode;
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (mode) {
      window.localStorage.setItem(PERF_MODE_STORAGE_KEY, mode);
    } else {
      window.localStorage.removeItem(PERF_MODE_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable; the in-memory override still applies for this session.
  }
};

const shouldCapture = (mode = resolvePerfMode()): boolean => mode !== 'off';
const shouldPersist = (mode = resolvePerfMode()): boolean => mode === 'full';

const isDev = (): boolean => typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV);

const isPlaybackBusy = (): boolean => getFlag('isPlaying');

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

const notify = (): void => {
  listeners.forEach((listener) => listener());
};

const resetEvents = (): void => {
  eventRing.fill(undefined);
  ringHead = 0;
  ringSize = 0;
};

const appendEvent = (event: PerfEvent): void => {
  eventRing[ringHead] = event;
  ringHead = (ringHead + 1) % MAX_EVENTS;
  if (ringSize < MAX_EVENTS) {
    ringSize += 1;
  }
};

const materialiseEvents = (): PerfEvent[] => {
  const events: PerfEvent[] = new Array(ringSize);
  const start = (ringHead - ringSize + MAX_EVENTS) % MAX_EVENTS;
  for (let index = 0; index < ringSize; index += 1) {
    events[index] = eventRing[(start + index) % MAX_EVENTS] as PerfEvent;
  }
  return events;
};

export const getPerformanceSnapshot = (): PerfSnapshot => {
  if (cachedSnapshot && cachedSnapshotVersion === version) {
    return cachedSnapshot;
  }
  cachedSnapshot = {
    startupAt,
    updatedAt,
    events: materialiseEvents(),
    counters: { ...counters },
    lastMeasures: { ...lastMeasures },
  };
  cachedSnapshotVersion = version;
  return cachedSnapshot;
};

// Coalesce persistence so a burst of events materialises the snapshot once, not once per event.
const schedulePersist = (): void => {
  if (typeof window === 'undefined' || persistTimer !== null) {
    return;
  }
  persistTimer = window.setTimeout(() => {
    persistTimer = null;
    void writeStorageJsonDebounced(PERF_PATH, getPerformanceSnapshot(), 200);
  }, PERSIST_DELAY_MS);
};

const pushEvent = (event: Omit<PerfEvent, 'id' | 'at'>): void => {
  const mode = resolvePerfMode();
  if (!shouldCapture(mode)) {
    return;
  }

  const now = Date.now();
  updatedAt = now;
  counters[event.name] = (counters[event.name] ?? 0) + 1;
  if (typeof event.durationMs === 'number') {
    lastMeasures[event.name] = event.durationMs;
  }
  if (mode === 'full') {
    appendEvent({ id: ++nextEventId, at: now, ...event });
  }
  version += 1;
  notify();
  if (mode === 'full') {
    schedulePersist();
  }
};

export const hydratePerfDiagnostics = async (): Promise<void> => {
  if (hydrated) {
    return;
  }
  hydrated = true;
  const mode = resolvePerfMode();
  if (!shouldPersist(mode)) {
    startupAt = Date.now();
    updatedAt = startupAt;
    resetEvents();
    counters = {};
    lastMeasures = {};
    version += 1;
    notify();
    return;
  }

  const persisted = await readStorageJson<PerfSnapshot>(PERF_PATH, persistedDefault);
  startupAt = persisted.startupAt || Date.now();
  updatedAt = persisted.updatedAt || Date.now();
  resetEvents();
  const events = Array.isArray(persisted.events) ? persisted.events.slice(-MAX_EVENTS) : [];
  events.forEach(appendEvent);
  counters = persisted.counters ?? {};
  lastMeasures = persisted.lastMeasures ?? {};
  nextEventId = events[events.length - 1]?.id ?? 0;
  version += 1;
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
