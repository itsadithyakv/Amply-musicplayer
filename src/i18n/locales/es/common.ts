import type source from '@/i18n/locales/en/common';

const common = {
  "common.previous": "Anterior",
  "common.play": "Reproducir",
  "common.pause": "Pausar",
  "common.next": "Siguiente",
} satisfies Record<keyof typeof source, string>;

export default common;
