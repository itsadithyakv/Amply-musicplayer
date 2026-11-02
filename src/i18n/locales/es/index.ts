import type { Messages } from '@/i18n';
import common from '@/i18n/locales/es/common';
import settings from '@/i18n/locales/es/settings';
import library from '@/i18n/locales/es/library';
import playlists from '@/i18n/locales/es/playlists';
import player from '@/i18n/locales/es/player';
import stats from '@/i18n/locales/es/stats';
import messages from '@/i18n/locales/es/messages';
import pro from '@/i18n/locales/es/pro';
import report from '@/i18n/locales/es/report';

const catalog: Messages = { ...common, ...settings, ...library, ...playlists, ...player, ...stats, ...messages, ...pro, ...report };

export default catalog;
