import type source from '@/i18n/locales/en/common';

const common = {
  "common.previous": "上一首",
  "common.play": "播放",
  "common.pause": "暂停",
  "common.next": "下一首",
} satisfies Record<keyof typeof source, string>;

export default common;
