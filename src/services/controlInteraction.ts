import { beginInteractionFeedback } from '@/services/interactionFeedback';
import { beginPerfInteraction } from '@/services/perfDiagnostics';
import { scheduleAfterPaint } from '@/services/interactionTrace';

/**
 * Wraps a user-initiated transport/control action with perf measurement and the global
 * "working" feedback overlay. Call the returned function when the action has settled;
 * the perf sample and overlay are closed after the next paint.
 */
export const beginControlInteraction = (name: string, message: string): (() => void) => {
  const perf = beginPerfInteraction(name);
  const endFeedback = beginInteractionFeedback({
    delayMs: 140,
    minVisibleMs: 150,
    message,
  });
  return () => {
    scheduleAfterPaint(() => {
      perf.end();
      endFeedback();
    });
  };
};
