import { scheduleNonCriticalTask, shouldThrottleNonCriticalWork } from '@/services/appScheduler';
import { recordBackgroundTask } from '@/services/perfDiagnostics';

type ScheduledTask = () => void | Promise<void>;

type ScheduleOptions = {
  delayMs?: number;
  timeoutMs?: number;
  groupKey?: string;
  reason?: string;
};

const backgroundPauseReasons = new Set<string>();
const groupedCancels = new Map<string, Set<() => void>>();

const rememberCancel = (groupKey: string | undefined, cancel: () => void): (() => void) => {
  if (!groupKey) {
    return cancel;
  }
  const group = groupedCancels.get(groupKey) ?? new Set<() => void>();
  group.add(cancel);
  groupedCancels.set(groupKey, group);
  return () => {
    cancel();
    group.delete(cancel);
    if (group.size === 0) {
      groupedCancels.delete(groupKey);
    }
  };
};

const runMeasured = (name: string, task: ScheduledTask): void => {
  const startedAt = Date.now();
  void Promise.resolve()
    .then(task)
    .then(
      () => recordBackgroundTask(name, 'completed', Date.now() - startedAt),
      () => recordBackgroundTask(name, 'failed', Date.now() - startedAt),
    );
};

const scheduleImmediate = (name: string, task: ScheduledTask, groupKey?: string): (() => void) => {
  let cancelled = false;
  const run = () => {
    if (!cancelled) {
      runMeasured(name, task);
    }
  };
  if (typeof window === 'undefined') {
    run();
    return () => {
      cancelled = true;
    };
  }
  const handle = window.setTimeout(run, 0);
  return rememberCancel(groupKey, () => {
    cancelled = true;
    window.clearTimeout(handle);
  });
};

export const schedulePlaybackCritical = (task: ScheduledTask, options: ScheduleOptions = {}): (() => void) => {
  return scheduleImmediate(options.reason ?? 'playback-critical', task, options.groupKey);
};

export const scheduleInteraction = (task: ScheduledTask, options: ScheduleOptions = {}): (() => void) => {
  return scheduleImmediate(options.reason ?? 'interaction', task, options.groupKey);
};

export const scheduleVisibleRoute = (
  task: ScheduledTask,
  routeKey: string,
  options: ScheduleOptions = {},
): (() => void) => {
  return scheduleImmediate(options.reason ?? `visible-route:${routeKey}`, task, options.groupKey ?? `route:${routeKey}`);
};

export const scheduleIdle = (task: ScheduledTask, options: ScheduleOptions = {}): (() => void) => {
  if (backgroundPauseReasons.size > 0 || shouldThrottleNonCriticalWork()) {
    recordBackgroundTask(options.reason ?? 'idle', 'skipped', 0);
    return () => {};
  }

  const cancel = scheduleNonCriticalTask(
    () => runMeasured(options.reason ?? 'idle', task),
    {
      delayMs: options.delayMs,
      timeoutMs: options.timeoutMs,
      reason: options.reason,
    },
  );
  return rememberCancel(options.groupKey, cancel);
};

export const cancelGroup = (groupKey: string): void => {
  const group = groupedCancels.get(groupKey);
  if (!group) {
    return;
  }
  recordBackgroundTask(`group:${groupKey}`, 'cancelled', 0);
  for (const cancel of [...group]) {
    cancel();
  }
  groupedCancels.delete(groupKey);
};

export const pauseBackground = (reason: string): void => {
  backgroundPauseReasons.add(reason);
};

export const resumeBackground = (reason: string): void => {
  backgroundPauseReasons.delete(reason);
};
