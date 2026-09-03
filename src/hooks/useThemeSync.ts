import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { writePreference } from '@/services/preferences';
import { isTauri } from '@/services/storageService';

export type AppTheme = 'light' | 'dark';

/** Preference key mirrored to localStorage and read by the inline boot script in index.html. */
export const THEME_PREFERENCE_KEY = 'theme';

const THEME_BACKGROUNDS: Record<AppTheme, [number, number, number, number]> = {
  light: [236, 232, 225, 255],
  dark: [28, 27, 25, 255],
};

export const applyTheme = (theme: AppTheme): void => {
  if (typeof document === 'undefined') {
    return;
  }
  document.documentElement.dataset.theme = theme;
  writePreference(THEME_PREFERENCE_KEY, theme);
  if (isTauri()) {
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setBackgroundColor(THEME_BACKGROUNDS[theme]))
      .catch(() => {
        // Window background is cosmetic (frame colour during resize); ignore failures.
      });
  }
};

/**
 * Keeps `<html data-theme>` in sync with the persisted setting. Waits for the player store to
 * hydrate so a dark-mode user never sees a flash of the default light theme after boot.
 */
export const useThemeSync = (): void => {
  const initialized = usePlayerStore((state) => state.initialized);
  const appTheme = usePlayerStore((state) => state.settings.appTheme);

  useEffect(() => {
    if (!initialized) {
      return;
    }
    applyTheme(appTheme === 'dark' ? 'dark' : 'light');
  }, [initialized, appTheme]);
};
