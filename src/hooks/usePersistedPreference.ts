import { useCallback, useState } from 'react';
import { readPreference, writePreference } from '@/services/preferences';

/**
 * `useState` whose value is mirrored to a validated per-device preference.
 * `isValid` guards the stored value so only members of `T` ever reach React state.
 */
export const usePersistedPreference = <T extends string>(
  key: string,
  isValid: (value: string) => value is T,
  fallback: T,
): [T, (next: T) => void] => {
  const [value, setValue] = useState<T>(() => readPreference(key, isValid, fallback));
  const update = useCallback(
    (next: T) => {
      setValue(next);
      writePreference(key, next);
    },
    [key],
  );
  return [value, update];
};
