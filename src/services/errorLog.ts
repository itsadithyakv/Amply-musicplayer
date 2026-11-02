/**
 * The last few errors the frontend hit, kept in memory only, so a bug report can say what went
 * wrong just before it was written. Nothing is stored or sent unless the user includes it in a
 * report.
 */

const MAX_ENTRIES = 15;
const MAX_ENTRY_CHARS = 400;

export interface ErrorEntry {
  at: number;
  message: string;
}

const entries: ErrorEntry[] = [];
let installed = false;

const PROFILE_PATH = /\b[a-z]:[\\/]+users[\\/]+(?:[^\\/\r\n"'<>|:*?]+([\\/])|[^\\/\s"'<>|:*?]+)/gi;

/** Replaces `C:\Users\<name>` with `~`, matching the Rust side's `scrub_user_paths`. */
export const scrubUserPaths = (text: string): string => text.replace(PROFILE_PATH, (_match, sep: string | undefined) => `~${sep ?? ''}`);

const describe = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack ? value.stack.split('\n').slice(0, 3).join(' | ') : `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export const recordError = (...parts: unknown[]): void => {
  const message = scrubUserPaths(parts.map(describe).join(' ')).slice(0, MAX_ENTRY_CHARS);
  if (!message.trim()) {
    return;
  }
  const last = entries[entries.length - 1];
  if (last?.message === message) {
    last.at = Date.now();
    return;
  }
  entries.push({ at: Date.now(), message });
  if (entries.length > MAX_ENTRIES) {
    entries.shift();
  }
};

export const recentErrors = (): readonly ErrorEntry[] => entries;

/** Mirrors `console.error`, uncaught errors and unhandled rejections into the log. */
export const installErrorCapture = (): void => {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    recordError(...args);
    original(...args);
  };
  window.addEventListener('error', (event) => recordError(event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => recordError('Unhandled rejection:', event.reason));
};

export const clearErrorLogForTests = (): void => {
  entries.length = 0;
};
