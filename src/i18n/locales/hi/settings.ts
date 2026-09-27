import type source from '@/i18n/locales/en/settings';

const settings = {
  "settings.language.label": "भाषा",
  "settings.language.description": "Amply के मेनू और संदेशों की भाषा।",
  "settings.language.system": "Windows के अनुसार ({language})",
} satisfies Record<keyof typeof source, string>;

export default settings;
