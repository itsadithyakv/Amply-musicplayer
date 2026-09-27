import type { Messages } from '@/i18n';
import common from '@/i18n/locales/hi/common';
import settings from '@/i18n/locales/hi/settings';
import library from '@/i18n/locales/hi/library';
import playlists from '@/i18n/locales/hi/playlists';
import player from '@/i18n/locales/hi/player';
import stats from '@/i18n/locales/hi/stats';
import messages from '@/i18n/locales/hi/messages';

const catalog: Messages = { ...common, ...settings, ...library, ...playlists, ...player, ...stats, ...messages };

export default catalog;
