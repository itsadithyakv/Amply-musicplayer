import type source from '@/i18n/locales/en/settings';

const settings = {
  "settings.language.label": "Langue",
  "settings.language.description": "La langue des menus et des messages d'Amply.",
  "settings.language.system": "Comme Windows ({language})",
} satisfies Record<keyof typeof source, string>;

export default settings;
