import type { Messages } from '@/i18n';
import common from '@/i18n/locales/zh-CN/common';
import settings from '@/i18n/locales/zh-CN/settings';
import library from '@/i18n/locales/zh-CN/library';
import playlists from '@/i18n/locales/zh-CN/playlists';
import player from '@/i18n/locales/zh-CN/player';
import stats from '@/i18n/locales/zh-CN/stats';
import messages from '@/i18n/locales/zh-CN/messages';

const catalog: Messages = { ...common, ...settings, ...library, ...playlists, ...player, ...stats, ...messages };

export default catalog;
