import { useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';

/**
 * Process-wide, dependency-free runtime flags. Replaces the old `window.__AMP_*` globals.
 *
 * This module must not import from stores or other services: it is read by leaf modules
 * (playlist generation, safe-mode priming, schedulers) before the React stores exist.
 */
export interface RuntimeFlags {
  isPlaying: boolean;
  currentSongId: string | null;
  upNext: string[];
  lowPerf: boolean;
  gameMode: boolean;
  lowMemoryMode: boolean;
  safeMode: boolean;
  constrainedDevice: boolean;
  metadataPaused: boolean;
  mixRegenPaused: boolean;
  /** undefined until the player store has hydrated settings. */
  onlineRecsEnabled: boolean | undefined;
  discoveryIntensity: number | undefined;
  randomnessIntensity: number | undefined;
  lastInteractionAt: number;
}

const DEFAULTS: RuntimeFlags = {
  isPlaying: false,
  currentSongId: null,
  upNext: [],
  lowPerf: false,
  gameMode: false,
  lowMemoryMode: false,
  safeMode: false,
  constrainedDevice: false,
  metadataPaused: false,
  mixRegenPaused: false,
  onlineRecsEnabled: undefined,
  discoveryIntensity: undefined,
  randomnessIntensity: undefined,
  lastInteractionAt: 0,
};

export const runtimeFlags = createStore<RuntimeFlags>(() => ({ ...DEFAULTS }));

export const getFlag = <K extends keyof RuntimeFlags>(key: K): RuntimeFlags[K] => runtimeFlags.getState()[key];

export const getFlags = (): RuntimeFlags => runtimeFlags.getState();

export const setFlags = (patch: Partial<RuntimeFlags>): void => {
  const current = runtimeFlags.getState();
  for (const key of Object.keys(patch) as Array<keyof RuntimeFlags>) {
    if (!Object.is(current[key], patch[key])) {
      runtimeFlags.setState(patch);
      return;
    }
  }
};

/** Subscribe to one flag; the callback fires only when that flag's value changes. */
export const subscribeFlag = <K extends keyof RuntimeFlags>(
  key: K,
  callback: (value: RuntimeFlags[K], previous: RuntimeFlags[K]) => void,
): (() => void) =>
  runtimeFlags.subscribe((state, previous) => {
    if (!Object.is(state[key], previous[key])) {
      callback(state[key], previous[key]);
    }
  });

/** React hook: re-renders when the given flag changes. */
export const useFlag = <K extends keyof RuntimeFlags>(key: K): RuntimeFlags[K] =>
  useSyncExternalStore(
    (onChange) => subscribeFlag(key, onChange),
    () => runtimeFlags.getState()[key],
    () => runtimeFlags.getState()[key],
  );

/** Test helper. */
export const resetFlags = (): void => {
  runtimeFlags.setState({ ...DEFAULTS });
};
