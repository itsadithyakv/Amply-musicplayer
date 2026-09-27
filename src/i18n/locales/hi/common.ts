import type source from '@/i18n/locales/en/common';

const common = {
  "common.previous": "पिछला",
  "common.play": "चलाएँ",
  "common.pause": "रोकें",
  "common.next": "अगला",
} satisfies Record<keyof typeof source, string>;

export default common;
