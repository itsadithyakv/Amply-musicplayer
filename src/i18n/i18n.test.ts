import { afterEach, describe, expect, it } from 'vitest';
import { detectLanguage, getLanguage, isLanguageCode, setLanguage, t } from '@/i18n';
import en from '@/i18n/locales/en';
import zh from '@/i18n/locales/zh-CN';
import hi from '@/i18n/locales/hi';
import es from '@/i18n/locales/es';
import fr from '@/i18n/locales/fr';

afterEach(async () => {
  await setLanguage('en');
});

describe('language detection', () => {
  it('matches the closest supported language', () => {
    expect(detectLanguage(['zh-TW'])).toBe('zh-CN');
    expect(detectLanguage(['hi-IN'])).toBe('hi');
    expect(detectLanguage(['es-419', 'en-US'])).toBe('es');
    expect(detectLanguage(['fr-CA'])).toBe('fr');
    expect(detectLanguage(['de-DE', 'fr-FR'])).toBe('fr');
    expect(detectLanguage(['de-DE'])).toBe('en');
    expect(isLanguageCode('hi')).toBe(true);
    expect(isLanguageCode('de')).toBe(false);
  });
});

describe('t', () => {
  it('switches catalogues and interpolates placeholders', async () => {
    expect(t('common.play')).toBe('Play');
    await setLanguage('hi');
    expect(getLanguage()).toBe('hi');
    expect(t('common.play')).toBe('चलाएँ');
    expect(t('settings.language.system', { language: 'हिन्दी' })).toBe('Windows के अनुसार (हिन्दी)');
  });

  it('leaves unknown placeholders visible rather than blank', () => {
    expect(t('settings.language.system')).toContain('{language}');
  });
});

describe('catalogues', () => {
  it('translate every English key into every language', () => {
    const keys = Object.keys(en).sort();
    for (const catalog of [zh, hi, es, fr]) {
      expect(Object.keys(catalog).sort()).toEqual(keys);
      for (const key of keys) {
        expect((catalog as Record<string, string>)[key].trim()).not.toBe('');
      }
    }
  });

  it('keep every placeholder of the English message', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
    for (const catalog of [zh, hi, es, fr] as Array<Record<string, string>>) {
      for (const [key, text] of Object.entries(en)) {
        expect([key, placeholders(catalog[key])]).toEqual([key, placeholders(text)]);
      }
    }
  });
});
