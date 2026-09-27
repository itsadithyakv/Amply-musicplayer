import { t, type MessageKey } from '@/i18n';
import type { Playlist } from '@/types/music';

/**
 * Display names for playlists. The mix engine runs in a worker without i18n, so smart playlists
 * are persisted with English `name` / `description`; their ids are stable, so the UI translates
 * by id here. Custom playlists are user data and are shown exactly as stored.
 */

interface SmartKeys {
  name: MessageKey;
  description: MessageKey;
}

const smart = (base: string): SmartKeys => ({
  name: `playlists.smart.${base}.name` as MessageKey,
  description: `playlists.smart.${base}.description` as MessageKey,
});

/** Core mixes (score.ts `CORE_MIXES`) and mood mixes (`moodMixId` = `smart_<moodId>_mix`). */
const SMART_KEYS: Readonly<Record<string, SmartKeys>> = {
  smart_daily_mix: smart('daily'),
  smart_on_repeat: smart('onRepeat'),
  smart_recently_played: smart('recentlyPlayed'),
  smart_recently_added: smart('recentlyAdded'),
  smart_most_played: smart('mostPlayed'),
  smart_rediscover: smart('rediscover'),
  smart_favorites: smart('favorites'),
  smart_loved_played: smart('lovedPlayed'),
  smart_quick_hits: smart('quickHits'),
  smart_long_sessions: smart('longSessions'),
  smart_deep_cuts: smart('deepCuts'),
  smart_explore: smart('explore'),
  smart_happy_mix: smart('mood.happy'),
  smart_sad_mix: smart('mood.sad'),
  smart_party_mix: smart('mood.party'),
  smart_main_character_mix: smart('mood.mainCharacter'),
  smart_chill_mix: smart('mood.chill'),
  smart_focus_mix: smart('mood.focus'),
  smart_workout_mix: smart('mood.workout'),
  smart_late_night_mix: smart('mood.lateNight'),
  smart_road_trip_mix: smart('mood.roadTrip'),
  smart_morning_boost_mix: smart('mood.morningBoost'),
  smart_acoustic_mix: smart('mood.acoustic'),
  smart_instrumental_mix: smart('mood.instrumental'),
};

/** Genre mixes: id `smart_genre_mix_<slug>`, name "<Genre> Mix", description "Mix based on your <Genre> tracks." */
const GENRE_MIX_PREFIX = 'smart_genre_mix_';
const GENRE_NAME = /^(.+) Mix$/;
const GENRE_DESCRIPTION = /^Mix based on your (.+) tracks\.$/;

/**
 * Placeholder descriptions older builds stored for custom playlists ("Custom playlist" from the
 * composer, "User playlist" from quick create). They were never typed by the user, so they read
 * as no description.
 */
const LEGACY_CUSTOM_DESCRIPTIONS = new Set(['Custom playlist', 'User playlist']);

const isGenerated = (playlist: Pick<Playlist, 'type'>): boolean => playlist.type !== 'custom';

/** The playlist's name in the current language. Custom playlists and unknown ids keep the stored name. */
export const localizedPlaylistName = (playlist: Pick<Playlist, 'id' | 'name' | 'type'>): string => {
  if (!isGenerated(playlist)) {
    return playlist.name;
  }
  const keys = SMART_KEYS[playlist.id];
  if (keys) {
    return t(keys.name);
  }
  if (playlist.id.startsWith(GENRE_MIX_PREFIX)) {
    const genre = GENRE_NAME.exec(playlist.name)?.[1];
    if (genre) {
      return t('playlists.smart.genre.name', { genre });
    }
  }
  return playlist.name;
};

/**
 * The playlist's description in the current language. Custom playlists keep what the user wrote
 * (empty when they wrote nothing); unknown smart ids keep the stored text.
 */
export const localizedPlaylistDescription = (playlist: Pick<Playlist, 'id' | 'description' | 'type'>): string => {
  if (!isGenerated(playlist)) {
    return LEGACY_CUSTOM_DESCRIPTIONS.has(playlist.description) ? '' : playlist.description;
  }
  const keys = SMART_KEYS[playlist.id];
  if (keys) {
    return t(keys.description);
  }
  if (playlist.id.startsWith(GENRE_MIX_PREFIX)) {
    const genre = GENRE_DESCRIPTION.exec(playlist.description)?.[1];
    if (genre) {
      return t('playlists.smart.genre.description', { genre });
    }
  }
  return playlist.description;
};
