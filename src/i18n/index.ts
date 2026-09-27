import { useCallback } from 'react';
import { create } from 'zustand';
import en from '@/i18n/locales/en';

/**
 * Amply's translations. English is the source: its catalogue defines every key (`MessageKey`),
 * so a misspelt key is a type error, and each other language must translate every English key
 * (enforced per namespace file with `satisfies`). Other languages load on demand.
 *
 * Keys are flat and namespaced ("settings.playback.title"). Placeholders are `{name}`. Plurals use
 * `_one` / `_other` suffixes picked with Intl.PluralRules (`tp`).
 */

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh-CN', label: '简体中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]['code'];
export type LanguageSetting = 'system' | LanguageCode;
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;
/** Base keys of plural messages: "stats.plays" for "stats.plays_one" / "stats.plays_other". */
export type PluralKey = MessageKey extends infer K ? (K extends `${infer Base}_other` ? Base : never) : never;
type Params = Record<string, string | number>;

const loaders: Record<Exclude<LanguageCode, 'en'>, () => Promise<{ default: Messages }>> = {
  'zh-CN': () => import('@/i18n/locales/zh-CN'),
  hi: () => import('@/i18n/locales/hi'),
  es: () => import('@/i18n/locales/es'),
  fr: () => import('@/i18n/locales/fr'),
};

export const isLanguageCode = (value: unknown): value is LanguageCode =>
  LANGUAGES.some((language) => language.code === value);

/** The supported language closest to the system's preferences; English when none match. */
export const detectLanguage = (preferred: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): LanguageCode => {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    if (lower.startsWith('zh')) {
      return 'zh-CN';
    }
    const match = LANGUAGES.find((language) => lower === language.code.toLowerCase() || lower.startsWith(`${language.code}-`));
    if (match) {
      return match.code;
    }
  }
  return 'en';
};

export const resolveLanguage = (setting: LanguageSetting): LanguageCode => (setting === 'system' ? detectLanguage() : setting);

interface I18nState {
  language: LanguageCode;
  messages: Messages;
}

const useI18nStore = create<I18nState>(() => ({ language: 'en', messages: en }));

let pending: LanguageCode | null = null;

/** Switches the UI language, loading its catalogue first. Unknown or failed loads fall back to English. */
export const setLanguage = async (language: LanguageCode): Promise<void> => {
  pending = language;
  let messages: Messages = en;
  if (language !== 'en') {
    try {
      messages = (await loaders[language]()).default;
    } catch {
      messages = en;
    }
  }
  if (pending !== language) {
    return; // a newer switch won the race
  }
  useI18nStore.setState({ language, messages });
  if (typeof document !== 'undefined') {
    document.documentElement.lang = language;
  }
};

export const getLanguage = (): LanguageCode => useI18nStore.getState().language;

const interpolate = (template: string, params?: Params): string =>
  params ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match)) : template;

const lookup = (messages: Messages, key: MessageKey, params?: Params): string =>
  interpolate(messages[key] ?? en[key] ?? key, params);

const pluralKey = (language: LanguageCode, messages: Messages, base: PluralKey, count: number): MessageKey => {
  const category = new Intl.PluralRules(language).select(count);
  const candidate = `${base}_${category}` as MessageKey;
  return candidate in messages || candidate in en ? candidate : (`${base}_other` as MessageKey);
};

/** Translates `key` in the current language. For code outside React (stores, toasts). */
export const t = (key: MessageKey, params?: Params): string => lookup(useI18nStore.getState().messages, key, params);

/** Translates a plural message; `{count}` is available to the template. */
export const tp = (base: PluralKey, count: number, params?: Params): string => {
  const { language, messages } = useI18nStore.getState();
  return lookup(messages, pluralKey(language, messages, base, count), { count: formatNumber(count), ...params });
};

/** `t` and `tp` for components: using it re-renders the component when the language changes. */
export const useT = () => {
  const language = useI18nStore((state) => state.language);
  const messages = useI18nStore((state) => state.messages);
  const translate = useCallback((key: MessageKey, params?: Params) => lookup(messages, key, params), [messages]);
  const translatePlural = useCallback(
    (base: PluralKey, count: number, params?: Params) =>
      lookup(messages, pluralKey(language, messages, base, count), { count: new Intl.NumberFormat(language).format(count), ...params }),
    [language, messages],
  );
  return { t: translate, tp: translatePlural, language };
};

/** Numbers in the current language's style (grouping, digits). */
export const formatNumber = (value: number, options?: Intl.NumberFormatOptions): string =>
  new Intl.NumberFormat(getLanguage(), options).format(value);
