import { normalizeGenreText } from './genres';
import type { MoodDefinition } from './types';

const hints = (values: string[]): string[] => values.map((value) => normalizeGenreText(value)).filter(Boolean);

/**
 * The twelve mood mixes of the previous generator (ids are part of the UI contract:
 * `smart_<id>_mix`). Hints are normalised genre/title tokens; `prefs` give siblings that share
 * hints (Happy / Morning Boost, Chill / Late Night / Sad) a different centre of gravity.
 */
export const MOODS: readonly MoodDefinition[] = [
  {
    id: 'happy',
    name: 'Happy Mix',
    description: 'Upbeat songs to lift the mood.',
    genreHints: hints(['pop', 'dance', 'disco', 'funk', 'edm', 'electronic']),
    titleHints: hints(['happy', 'joy', 'smile', 'sun', 'bright', 'good']),
    prefs: { maxDuration: 260, daypart: 2 },
  },
  {
    id: 'sad',
    name: 'Sad Mix',
    description: 'Slower, mellow tracks for quieter moments.',
    genreHints: hints(['acoustic', 'ballad', 'ambient', 'lofi', 'lo-fi', 'piano', 'blues']),
    titleHints: hints(['sad', 'cry', 'alone', 'lonely', 'tears', 'heart']),
    prefs: { minDuration: 240, daypart: 3 },
  },
  {
    id: 'party',
    name: 'Party Mix',
    description: 'High-energy tracks for late-night sessions.',
    genreHints: hints(['dance', 'edm', 'club', 'house', 'hip hop', 'hip-hop', 'rap', 'reggaeton', 'latin']),
    titleHints: hints(['party', 'club', 'dance', 'night', 'mix']),
    prefs: { maxDuration: 300, daypart: 3 },
  },
  {
    id: 'main_character',
    name: 'Main Character Vibes',
    description: 'Big energy and cinematic feel-good tracks.',
    genreHints: hints(['pop', 'indie', 'electronic', 'rock', 'soundtrack']),
    titleHints: hints(['vibes', 'glow', 'shine', 'star', 'dream', 'hero']),
    prefs: { favoriteBoost: 0.4, minDuration: 200 },
  },
  {
    id: 'chill',
    name: 'Chill Mix',
    description: 'Laid-back tracks for winding down.',
    genreHints: hints(['chill', 'ambient', 'lofi', 'lo-fi', 'acoustic', 'indie', 'jazz']),
    titleHints: hints(['chill', 'slow', 'late', 'night', 'blue']),
    prefs: { daypart: 2 },
  },
  {
    id: 'focus',
    name: 'Focus Mix',
    description: 'Steady, low-distraction tracks for deep work.',
    genreHints: hints(['instrumental', 'ambient', 'piano', 'classical', 'lofi', 'lo-fi']),
    titleHints: hints(['focus', 'study', 'work', 'concentration', 'calm']),
    prefs: { minDuration: 240, daypart: 1 },
  },
  {
    id: 'workout',
    name: 'Workout Mix',
    description: 'High-intensity tracks to keep you moving.',
    genreHints: hints(['edm', 'electronic', 'rock', 'hip hop', 'hip-hop', 'metal', 'punk']),
    titleHints: hints(['run', 'burn', 'power', 'move', 'energy']),
    prefs: { maxDuration: 240, daypart: 1 },
  },
  {
    id: 'late_night',
    name: 'Late Night Mix',
    description: 'Low-light listening for winding down.',
    genreHints: hints(['ambient', 'lofi', 'lo-fi', 'chill', 'soul', 'r&b', 'jazz']),
    titleHints: hints(['night', 'midnight', 'moon', 'late', 'after dark', 'dream']),
    prefs: { daypart: 0, minDuration: 200 },
  },
  {
    id: 'road_trip',
    name: 'Road Trip Mix',
    description: 'Open-road anthems and sing-alongs.',
    genreHints: hints(['rock', 'pop', 'country', 'indie', 'folk']),
    titleHints: hints(['road', 'drive', 'highway', 'trip', 'ride']),
    prefs: { olderYearsBoost: true, favoriteBoost: 0.2 },
  },
  {
    id: 'morning_boost',
    name: 'Morning Boost',
    description: 'Bright, upbeat tracks to start the day.',
    genreHints: hints(['pop', 'dance', 'funk', 'disco', 'electronic', 'indie']),
    titleHints: hints(['morning', 'sun', 'rise', 'wake', 'bright', 'good']),
    prefs: { daypart: 1, maxDuration: 240 },
  },
  {
    id: 'acoustic',
    name: 'Acoustic Mix',
    description: 'Unplugged and mellow acoustic tracks.',
    genreHints: hints(['acoustic', 'folk', 'singer-songwriter', 'indie', 'country', 'blues']),
    titleHints: hints(['acoustic', 'unplugged', 'stripped']),
    prefs: { olderYearsBoost: true },
  },
  {
    id: 'instrumental',
    name: 'Instrumental Focus',
    description: 'Instrumental picks for focus and flow.',
    genreHints: hints(['instrumental', 'classical', 'piano', 'ambient', 'lofi', 'lo-fi', 'soundtrack', 'jazz']),
    titleHints: hints(['instrumental', 'piano', 'study', 'focus']),
    prefs: { minDuration: 300, daypart: 2 },
  },
];

export const moodMixId = (moodId: string): string => `smart_${moodId}_mix`;

const collectVocabulary = (pick: (mood: MoodDefinition) => readonly string[]) => {
  const single: string[] = [];
  const phrases: string[] = [];
  const seen = new Set<string>();
  for (const mood of MOODS) {
    for (const hint of pick(mood)) {
      if (seen.has(hint)) {
        continue;
      }
      seen.add(hint);
      if (hint.includes(' ')) {
        phrases.push(hint);
      } else {
        single.push(hint);
      }
    }
  }
  return { single, phrases };
};

/** Every hint used by any mood, split into single tokens (Set lookups) and phrases (substring). */
export const GENRE_HINT_VOCAB = collectVocabulary((mood) => mood.genreHints);
export const TITLE_HINT_VOCAB = collectVocabulary((mood) => mood.titleHints);

/** Hints from a vocabulary that occur in a normalised, space-joined token string. */
export const matchHints = (
  normalizedText: string,
  vocab: { single: string[]; phrases: string[] },
): Set<string> => {
  const matched = new Set<string>();
  if (!normalizedText) {
    return matched;
  }
  const tokens = new Set(normalizedText.split(' '));
  for (const hint of vocab.single) {
    if (tokens.has(hint)) {
      matched.add(hint);
    }
  }
  if (vocab.phrases.length) {
    const padded = ` ${normalizedText} `;
    for (const phrase of vocab.phrases) {
      if (padded.includes(` ${phrase} `)) {
        matched.add(phrase);
      }
    }
  }
  return matched;
};
