import { setFlags } from '@/services/runtimeFlags';
import { readStorageJson, writeStorageJson } from '@/services/storageService';

const SAFE_MODE_PATH = 'system/startup_state.json';
const STARTUP_STALE_MS = 90_000;

type StartupState = {
  status: 'starting' | 'ready';
  startedAt: number;
  readyAt?: number;
  safeModeNextStart?: boolean;
  lastSafeModeReason?: string;
  lastDeviceMemoryGb?: number | null;
  lastHardwareConcurrency?: number | null;
};

let safeMode = false;
let constrainedDevice = false;
let lowMemoryMode = false;

type StartupSafetyState = {
  safeMode: boolean;
  constrainedDevice: boolean;
  lowMemoryMode: boolean;
  reason: string | null;
  deviceMemoryGb: number | null;
  hardwareConcurrency: number | null;
};

const readDeviceMemoryGb = (): number | null => {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const value = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const readHardwareConcurrency = (): number | null => {
  if (typeof navigator === 'undefined') {
    return null;
  }
  const value = navigator.hardwareConcurrency;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const detectConstrainedDevice = (): boolean => {
  const deviceMemoryGb = readDeviceMemoryGb();
  const hardwareConcurrency = readHardwareConcurrency();
  if (deviceMemoryGb !== null && deviceMemoryGb <= 2) {
    return true;
  }
  return Boolean(deviceMemoryGb !== null && deviceMemoryGb <= 4 && hardwareConcurrency !== null && hardwareConcurrency <= 2);
};

const resolveReason = (previous: StartupState | null): string | null => {
  if (previous?.safeModeNextStart) {
    return previous.lastSafeModeReason ?? 'requested';
  }
  if (previous?.status === 'starting' && Date.now() - previous.startedAt > STARTUP_STALE_MS) {
    return 'previous-startup-incomplete';
  }
  if (constrainedDevice) {
    return 'constrained-device';
  }
  return null;
};

const publishStartupSafetyFlags = (): void => {
  if (typeof window === 'undefined') {
    return;
  }
  setFlags({ safeMode, constrainedDevice, lowMemoryMode });
};

export const primeStartupSafetyFlags = (): StartupSafetyState => {
  constrainedDevice = detectConstrainedDevice();
  lowMemoryMode = safeMode || constrainedDevice;
  publishStartupSafetyFlags();
  return getStartupSafetyState();
};

export const initializeSafeMode = async (): Promise<boolean> => {
  const now = Date.now();
  const previous = await readStorageJson<StartupState | null>(SAFE_MODE_PATH, null);
  constrainedDevice = detectConstrainedDevice();
  safeMode = Boolean(
    previous?.safeModeNextStart ||
      (previous?.status === 'starting' && now - previous.startedAt > STARTUP_STALE_MS),
  );
  lowMemoryMode = safeMode || constrainedDevice;
  const reason = resolveReason(previous);
  publishStartupSafetyFlags();
  await writeStorageJson(SAFE_MODE_PATH, {
    status: 'starting',
    startedAt: now,
    safeModeNextStart: false,
    lastSafeModeReason: reason ?? undefined,
    lastDeviceMemoryGb: readDeviceMemoryGb(),
    lastHardwareConcurrency: readHardwareConcurrency(),
  } satisfies StartupState);
  return safeMode;
};

export const markStartupReady = async (): Promise<void> => {
  await writeStorageJson(SAFE_MODE_PATH, {
    status: 'ready',
    startedAt: Date.now(),
    readyAt: Date.now(),
    safeModeNextStart: false,
    lastDeviceMemoryGb: readDeviceMemoryGb(),
    lastHardwareConcurrency: readHardwareConcurrency(),
  } satisfies StartupState);
};

export const requestSafeModeNextStart = async (reason = 'ui-error'): Promise<void> => {
  await writeStorageJson(SAFE_MODE_PATH, {
    status: 'ready',
    startedAt: Date.now(),
    readyAt: Date.now(),
    safeModeNextStart: true,
    lastSafeModeReason: reason,
    lastDeviceMemoryGb: readDeviceMemoryGb(),
    lastHardwareConcurrency: readHardwareConcurrency(),
  } satisfies StartupState);
};

export const getStartupSafetyState = (): StartupSafetyState => ({
  safeMode,
  constrainedDevice,
  lowMemoryMode,
  reason: safeMode ? 'safe-mode' : constrainedDevice ? 'constrained-device' : null,
  deviceMemoryGb: readDeviceMemoryGb(),
  hardwareConcurrency: readHardwareConcurrency(),
});
