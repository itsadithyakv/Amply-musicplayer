import { useEffect } from 'react';
import { resolveLanguage, setLanguage } from '@/i18n';
import { usePlayerStore } from '@/store/playerStore';

/** Applies the language setting ('system' resolves to Windows' language when Amply has it). */
export const useLanguageSync = (): void => {
  const setting = usePlayerStore((state) => state.settings.language);
  useEffect(() => {
    void setLanguage(resolveLanguage(setting));
  }, [setting]);
};
