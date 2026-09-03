import { useSyncExternalStore } from 'react';

type InteractionFeedbackSnapshot = {
  visible: boolean;
  message: string | null;
};

type InteractionFeedbackOptions = {
  delayMs?: number;
  minVisibleMs?: number;
  message?: string;
};

type PendingInteraction = {
  id: number;
  message: string;
  delayHandle: number | null;
  hideHandle: number | null;
  visibleSince: number | null;
  minVisibleMs: number;
};

const listeners = new Set<() => void>();
const pendingInteractions = new Map<number, PendingInteraction>();
let nextInteractionId = 0;
let snapshot: InteractionFeedbackSnapshot = {
  visible: false,
  message: null,
};

const notify = (): void => {
  listeners.forEach((listener) => listener());
};

const recomputeSnapshot = (): void => {
  const visibleInteractions = [...pendingInteractions.values()].filter((entry) => entry.visibleSince !== null);
  const current = visibleInteractions[visibleInteractions.length - 1] ?? null;
  snapshot = {
    visible: Boolean(current),
    message: current?.message ?? null,
  };
  notify();
};

const clearInteractionTimers = (entry: PendingInteraction): void => {
  if (entry.delayHandle !== null) {
    window.clearTimeout(entry.delayHandle);
    entry.delayHandle = null;
  }
  if (entry.hideHandle !== null) {
    window.clearTimeout(entry.hideHandle);
    entry.hideHandle = null;
  }
};

export const beginInteractionFeedback = (options: InteractionFeedbackOptions = {}): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const interaction: PendingInteraction = {
    id: ++nextInteractionId,
    message: options.message ?? 'Loading...',
    delayHandle: null,
    hideHandle: null,
    visibleSince: null,
    minVisibleMs: options.minVisibleMs ?? 180,
  };

  const show = () => {
    interaction.delayHandle = null;
    interaction.visibleSince = Date.now();
    recomputeSnapshot();
  };

  pendingInteractions.set(interaction.id, interaction);
  const delayMs = Math.max(0, options.delayMs ?? 120);
  if (delayMs === 0) {
    show();
  } else {
    interaction.delayHandle = window.setTimeout(show, delayMs);
  }

  return () => {
    const current = pendingInteractions.get(interaction.id);
    if (!current) {
      return;
    }
    if (current.visibleSince === null) {
      clearInteractionTimers(current);
      pendingInteractions.delete(interaction.id);
      recomputeSnapshot();
      return;
    }

    const visibleFor = Date.now() - current.visibleSince;
    const remaining = Math.max(0, current.minVisibleMs - visibleFor);
    clearInteractionTimers(current);
    current.hideHandle = window.setTimeout(() => {
      const latest = pendingInteractions.get(interaction.id);
      if (!latest) {
        return;
      }
      clearInteractionTimers(latest);
      pendingInteractions.delete(interaction.id);
      recomputeSnapshot();
    }, remaining);
  };
};

const getInteractionFeedbackSnapshot = (): InteractionFeedbackSnapshot => snapshot;

const subscribeInteractionFeedback = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useInteractionFeedback = (): InteractionFeedbackSnapshot =>
  useSyncExternalStore(subscribeInteractionFeedback, getInteractionFeedbackSnapshot, getInteractionFeedbackSnapshot);
