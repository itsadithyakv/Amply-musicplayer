import type source from '@/i18n/locales/en/settings';

const settings = {
  "settings.language.label": "Idioma",
  "settings.language.description": "El idioma de los menús y mensajes de Amply.",
  "settings.language.system": "Igual que Windows ({language})",
} satisfies Record<keyof typeof source, string>;

export default settings;
