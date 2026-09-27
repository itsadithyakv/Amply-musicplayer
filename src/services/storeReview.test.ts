import { beforeEach, describe, expect, it } from 'vitest';
import { clearPreferences } from '@/services/preferences';
import {
  nextReviewPromptState,
  readReviewPromptState,
  recordReviewPromptEvent,
  shouldPromptForReview,
  type ReviewPromptState,
} from '@/services/storeReview';

const DAY = 86_400_000;
const start = Date.UTC(2026, 8, 1);
const fresh: ReviewPromptState = { firstSeenAt: start, snoozedUntil: 0, prompts: 0, done: false };

describe('shouldPromptForReview', () => {
  it('waits for a week of use and 30 plays', () => {
    expect(shouldPromptForReview(fresh, 500, start + 6 * DAY)).toBe(false);
    expect(shouldPromptForReview(fresh, 29, start + 30 * DAY)).toBe(false);
    expect(shouldPromptForReview(fresh, 30, start + 7 * DAY)).toBe(true);
  });

  it('respects snoozes, the prompt cap and a final answer', () => {
    const later = start + 10 * DAY;
    expect(shouldPromptForReview({ ...fresh, snoozedUntil: later + 1 }, 100, later)).toBe(false);
    expect(shouldPromptForReview({ ...fresh, prompts: 3 }, 100, later)).toBe(false);
    expect(shouldPromptForReview({ ...fresh, done: true }, 100, later)).toBe(false);
  });
});

describe('nextReviewPromptState', () => {
  const now = start + 10 * DAY;

  it('snoozes for a month on "Not now" or a closed dialog, a week on failure', () => {
    expect(nextReviewPromptState(fresh, 'later', now).snoozedUntil).toBe(now + 30 * DAY);
    expect(nextReviewPromptState(fresh, 'dismissed', now).snoozedUntil).toBe(now + 30 * DAY);
    expect(nextReviewPromptState(fresh, 'failed', now).snoozedUntil).toBe(now + 7 * DAY);
  });

  it('ends for good once the user rated, went to the Store or declined', () => {
    for (const event of ['rated', 'store-opened', 'never'] as const) {
      expect(nextReviewPromptState(fresh, event, now).done).toBe(true);
    }
  });

  it('counts each time the prompt is shown', () => {
    expect(nextReviewPromptState(fresh, 'shown', now).prompts).toBe(1);
  });
});

describe('stored prompt state', () => {
  beforeEach(() => clearPreferences());

  it('starts the clock on first read and keeps it', () => {
    expect(readReviewPromptState(start).firstSeenAt).toBe(start);
    expect(readReviewPromptState(start + DAY).firstSeenAt).toBe(start);
  });

  it('persists recorded events', () => {
    readReviewPromptState(start);
    recordReviewPromptEvent('shown', start + 8 * DAY);
    recordReviewPromptEvent('later', start + 8 * DAY);
    const state = readReviewPromptState(start + 9 * DAY);
    expect(state.prompts).toBe(1);
    expect(state.snoozedUntil).toBe(start + 38 * DAY);
  });
});
