import type source from '@/i18n/locales/en/settings';

const settings = {
  "settings.language.label": "语言",
  "settings.language.description": "Amply 菜单和提示使用的语言。",
  "settings.language.system": "跟随 Windows（{language}）",
} satisfies Record<keyof typeof source, string>;

export default settings;
