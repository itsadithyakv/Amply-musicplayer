import type source from '@/i18n/locales/en/common';

const common = {
  "common.previous": "Précédent",
  "common.play": "Lecture",
  "common.pause": "Pause",
  "common.next": "Suivant",
} satisfies Record<keyof typeof source, string>;

export default common;
