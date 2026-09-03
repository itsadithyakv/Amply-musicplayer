/**
 * Small, synchronous, per-device UI preferences (sort orders, active tabs, theme mirror).
 * Backed by localStorage with an in-memory mirror; values are validated on read so a stale or
 * hand-edited entry can never flow into a union-typed state slot.
 */

export const PREFERENCE_PREFIX = 'amply:pref:';

const memory = new Map<string, string>();

const storage = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const rawRead = (key: string): string | null => {
  const cached = memory.get(key);
  if (cached !== undefined) {
    return cached;
  }
  try {
    const value = storage()?.getItem(PREFERENCE_PREFIX + key) ?? null;
    if (value !== null) {
      memory.set(key, value);
    }
    return value;
  } catch {
    return null;
  }
};

export const readPreference = <T extends string>(key: string, isValid: (value: string) => value is T, fallback: T): T => {
  const raw = rawRead(key);
  return raw !== null && isValid(raw) ? raw : fallback;
};

export const writePreference = (key: string, value: string): void => {
  memory.set(key, value);
  try {
    storage()?.setItem(PREFERENCE_PREFIX + key, value);
  } catch {
    // Quota or privacy-mode failures are non-fatal; the in-memory mirror still holds the value.
  }
};

export const clearPreferences = (): void => {
  memory.clear();
  const store = storage();
  if (!store) {
    return;
  }
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(PREFERENCE_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // ignore
  }
};

/** Build a validator from a fixed list of allowed string values. */
export const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: string): value is T =>
    (values as readonly string[]).includes(value);
