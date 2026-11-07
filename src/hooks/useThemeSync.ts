import type { AccentColor } from '@/types/music';
import { useEffectiveSetting } from '@/hooks/useEffectiveSettings';
import { useEffect } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { writePreference } from '@/services/preferences';
import { isTauri } from '@/services/storageService';

export type AppTheme = 'light' | 'dark';

/** Preference key mirrored to localStorage and read by the inline boot script in index.html. */
export const THEME_PREFERENCE_KEY = 'theme';

/** Mirrors for the boot script, so the first paint already has the right accent and black. */
const ACCENT_PREFERENCE_KEY = 'accent';
const BLACK_PREFERENCE_KEY = 'black';

const THEME_BACKGROUNDS: Record<AppTheme | 'black', [number, number, number, number]> = {
  light: [236, 232, 225, 255],
  dark: [28, 27, 25, 255],
  black: [4, 4, 5, 255],
};

export const applyTheme = (theme: AppTheme, accent: AccentColor = 'amber', trueBlack = false): void => {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  const black = theme === 'dark' && trueBlack;
  root.dataset.theme = theme;
  if (accent === 'amber') {
    delete root.dataset.accent;
  } else {
    root.dataset.accent = accent;
  }
  if (black) {
    root.dataset.black = 'true';
  } else {
    delete root.dataset.black;
  }
  writePreference(THEME_PREFERENCE_KEY, theme);
  writePreference(ACCENT_PREFERENCE_KEY, accent);
  writePreference(BLACK_PREFERENCE_KEY, black ? '1' : '0');
  if (isTauri()) {
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setBackgroundColor(THEME_BACKGROUNDS[black ? 'black' : theme]))
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
  const accent = useEffectiveSetting((settings) => settings.accentColor);
  const trueBlack = useEffectiveSetting((settings) => settings.trueBlack);

  useEffect(() => {
    if (!initialized) {
      return;
    }
    applyTheme(appTheme === 'dark' ? 'dark' : 'light', accent, trueBlack);
  }, [initialized, appTheme, accent, trueBlack]);
};
