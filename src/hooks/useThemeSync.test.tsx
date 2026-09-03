import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { useThemeSync } from '@/hooks/useThemeSync';
import { PREFERENCE_PREFIX } from '@/services/preferences';
import { usePlayerStore } from '@/store/playerStore';

afterEach(() => {
  usePlayerStore.setState({ initialized: false });
  delete document.documentElement.dataset.theme;
  window.localStorage.clear();
});

describe('useThemeSync', () => {
  it('does nothing until the player store has hydrated', () => {
    document.documentElement.dataset.theme = 'dark';
    act(() => {
      usePlayerStore.setState({ initialized: false, settings: { ...usePlayerStore.getState().settings, appTheme: 'light' } });
    });
    renderHook(() => useThemeSync());
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('applies the persisted theme and mirrors it for the boot script', () => {
    renderHook(() => useThemeSync());
    act(() => {
      usePlayerStore.setState({ initialized: true, settings: { ...usePlayerStore.getState().settings, appTheme: 'dark' } });
    });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(PREFERENCE_PREFIX + 'theme')).toBe('dark');
    act(() => {
      usePlayerStore.setState({ settings: { ...usePlayerStore.getState().settings, appTheme: 'light' } });
    });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
