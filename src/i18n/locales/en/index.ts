import common from '@/i18n/locales/en/common';
import settings from '@/i18n/locales/en/settings';
import library from '@/i18n/locales/en/library';
import playlists from '@/i18n/locales/en/playlists';
import player from '@/i18n/locales/en/player';
import stats from '@/i18n/locales/en/stats';
import messages from '@/i18n/locales/en/messages';
import pro from '@/i18n/locales/en/pro';
import report from '@/i18n/locales/en/report';

/** Every English message, flat. The key set defines `MessageKey`. */
const en = { ...common, ...settings, ...library, ...playlists, ...player, ...stats, ...messages, ...pro, ...report };

export default en;
