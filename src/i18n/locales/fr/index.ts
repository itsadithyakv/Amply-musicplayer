import type { Messages } from '@/i18n';
import common from '@/i18n/locales/fr/common';
import settings from '@/i18n/locales/fr/settings';
import library from '@/i18n/locales/fr/library';
import playlists from '@/i18n/locales/fr/playlists';
import player from '@/i18n/locales/fr/player';
import stats from '@/i18n/locales/fr/stats';
import messages from '@/i18n/locales/fr/messages';
import pro from '@/i18n/locales/fr/pro';

const catalog: Messages = { ...common, ...settings, ...library, ...playlists, ...player, ...stats, ...messages, ...pro };

export default catalog;
