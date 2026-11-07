import { limitSettings } from '@/services/proFeatures';
import { usePlayerStore } from '@/store/playerStore';
import { useProStore } from '@/store/proStore';
import type { AppSettings } from '@/types/music';

/** Reads a setting as Amply actually runs it, re-rendering when the setting or Pro changes. */
export const useEffectiveSetting = <T,>(select: (settings: AppSettings) => T): T => {
  const isPro = useProStore((state) => state.isPro);
  return usePlayerStore((state) => select(isPro ? state.settings : limitSettings(state.settings)));
};
