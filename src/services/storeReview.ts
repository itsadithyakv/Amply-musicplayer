import { invoke } from '@tauri-apps/api/core';
import { readPreference, writePreference } from '@/services/preferences';
import { isTauri } from '@/services/storageService';

/** What happened when the user was asked to rate Amply. Mirrors `StoreReviewOutcome` in Rust. */
export type StoreReviewOutcome = 'rated' | 'dismissed' | 'store-opened' | 'failed';

const STORE_LISTING_URL = 'https://apps.microsoft.com/detail/9n20zr8ddp8l';

/**
 * Opens the rating flow: Windows' in-app rating dialog for Store installs, the Store listing's
 * review section otherwise.
 */
export const requestStoreReview = async (): Promise<StoreReviewOutcome> => {
  if (!isTauri()) {
    window.open(STORE_LISTING_URL, '_blank', 'noopener,noreferrer');
    return 'store-opened';
  }
  try {
    return await invoke<StoreReviewOutcome>('request_store_review_rust');
  } catch {
    return 'failed';
  }
};

/** True when Amply was installed from the Microsoft Store (an MSIX package). */
export const isStoreInstall = async (): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  try {
    return await invoke<boolean>('is_store_install_rust');
  } catch {
    return false;
  }
};

/** Per-device memory of the review prompt. */
export interface ReviewPromptState {
  /** When this device first ran a version that knows about the prompt (ms). */
  firstSeenAt: number;
  /** No prompt before this time (ms). */
  snoozedUntil: number;
  /** How many times the prompt has been shown. */
  prompts: number;
  /** The user rated, went to the Store, or asked never to be asked again. */
  done: boolean;
}

const DAY_MS = 86_400_000;
const MIN_DAYS_IN_USE = 7;
const MIN_PLAYS = 30;
const SNOOZE_DAYS = 30;
const FAILURE_RETRY_DAYS = 7;
const MAX_PROMPTS = 3;

/**
 * Whether to ask for a rating now: only after a week of real use (and 30 counted plays), never
 * while snoozed, never more than three times, and never again once the user has answered for good.
 */
export const shouldPromptForReview = (state: ReviewPromptState, totalPlays: number, now: number): boolean =>
  !state.done &&
  state.prompts < MAX_PROMPTS &&
  now >= state.snoozedUntil &&
  now - state.firstSeenAt >= MIN_DAYS_IN_USE * DAY_MS &&
  totalPlays >= MIN_PLAYS;

export type ReviewPromptEvent = 'shown' | 'later' | 'never' | StoreReviewOutcome;

/** The prompt state after `event`. A rating flow the user saw through ends the prompt for good. */
export const nextReviewPromptState = (state: ReviewPromptState, event: ReviewPromptEvent, now: number): ReviewPromptState => {
  switch (event) {
    case 'shown':
      return { ...state, prompts: state.prompts + 1 };
    case 'later':
    case 'dismissed':
      return { ...state, snoozedUntil: now + SNOOZE_DAYS * DAY_MS };
    case 'failed':
      return { ...state, snoozedUntil: now + FAILURE_RETRY_DAYS * DAY_MS };
    case 'never':
    case 'rated':
    case 'store-opened':
      return { ...state, done: true };
  }
};

const PROMPT_STATE_KEY = 'storeReviewPrompt';

const isPromptStateJson = (value: string): value is string => {
  try {
    const parsed = JSON.parse(value) as Partial<ReviewPromptState>;
    return (
      typeof parsed.firstSeenAt === 'number' &&
      typeof parsed.snoozedUntil === 'number' &&
      typeof parsed.prompts === 'number' &&
      typeof parsed.done === 'boolean'
    );
  } catch {
    return false;
  }
};

/** Reads the prompt state, starting the one-week clock on first read. */
export const readReviewPromptState = (now: number = Date.now()): ReviewPromptState => {
  const raw = readPreference(PROMPT_STATE_KEY, isPromptStateJson, '');
  if (raw) {
    return JSON.parse(raw) as ReviewPromptState;
  }
  const fresh: ReviewPromptState = { firstSeenAt: now, snoozedUntil: 0, prompts: 0, done: false };
  writePreference(PROMPT_STATE_KEY, JSON.stringify(fresh));
  return fresh;
};

/** Records `event` against the stored prompt state. */
export const recordReviewPromptEvent = (event: ReviewPromptEvent, now: number = Date.now()): void => {
  const next = nextReviewPromptState(readReviewPromptState(now), event, now);
  writePreference(PROMPT_STATE_KEY, JSON.stringify(next));
};
