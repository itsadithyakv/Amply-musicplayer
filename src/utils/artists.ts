import { isUploadNoise, isVersionQualifier, stripForLookup, stripUploadNoise } from '@/utils/titles';

const UNKNOWN_ARTIST = 'Unknown Artist';

/** Acts whose names contain separators. Mirrors KNOWN_GROUP_NAMES in src-tauri/src/metadata/normalize.rs. */
const KNOWN_GROUP_NAMES = [
  'ac/dc', 'simon & garfunkel', 'earth, wind & fire', 'crosby, stills, nash & young', 'crosby, stills & nash',
  'tyler, the creator', 'mumford & sons', 'hall & oates', 'daryl hall & john oates', 'blood, sweat & tears',
  'peter, paul and mary', 'emerson, lake & palmer', 'brooks & dunn', 'big & rich', 'chase & status',
  'above & beyond', 'years & years', 'iron & wine', 'she & him', 'matt & kim', 'belle & sebastian',
  'of monsters and men', 'sam & dave', 'sonny & cher', 'ike & tina turner', 'tegan and sara',
  'macklemore & ryan lewis', 'zach & cody', 'black country, new road',
];

const isWordChar = (char: string | undefined): boolean => Boolean(char && /[\p{L}\p{N}]/u.test(char));

/**
 * Replaces a known group name with an indexed placeholder, and hides the separator in
 * "X & The Y" / "X + The Y" acts, so splitting leaves them whole.
 */
const protectGroupNames = (raw: string): { value: string; saved: string[] } => {
  let value = raw;
  const saved: string[] = [];
  const lower = raw.toLowerCase();
  for (const name of KNOWN_GROUP_NAMES) {
    const start = lower.indexOf(name);
    const end = start + name.length;
    if (start >= 0 && !isWordChar(lower[start - 1]) && !isWordChar(lower[end])) {
      saved.push(raw.slice(start, end));
      value = `${raw.slice(0, start)}${saved.length - 1}${raw.slice(end)}`;
      break;
    }
  }
  value = value.replace(/\s*([&+])\s*(the\s)/gi, (_match, separator: string, the: string) =>
    ` ${separator === '&' ? '' : ''} ${the}`,
  );
  return { value, saved };
};

const restoreGroupNames = (value: string, saved: string[]): string =>
  value
    .replace(/(\d+)/g, (_match, index: string) => saved[Number(index)] ?? '')
    .replace(//g, '&')
    .replace(//g, '+');

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const normalizePart = (value: string): string => {
  return normalizeWhitespace(value.replace(/^[\s,.;/|\-]+|[\s,.;/|\-]+$/g, ''));
};

const splitSimpleAnd = (value: string): string[] => {
  const andPattern = /\s+and\s+/i;
  if (!andPattern.test(value)) {
    return [value];
  }

  const parts = value.split(andPattern).map(normalizePart).filter(Boolean);
  if (parts.length !== 2) {
    return [value];
  }

  const leftWords = parts[0].split(' ').length;
  const rightWords = parts[1].split(' ').length;
  const rightStartsWithThe = parts[1].toLowerCase().startsWith('the ');
  const leftLower = parts[0].toLowerCase();
  const rightLower = parts[1].toLowerCase();

  if (leftWords === 1 && rightWords === 1 && !rightStartsWithThe && leftLower !== 'of' && rightLower !== 'of') {
    return parts;
  }

  return [value];
};

const splitArtistNamesUncached = (artist: string | null | undefined): string[] => {
  const raw = normalizeWhitespace(artist ?? '');
  if (!raw) {
    return [UNKNOWN_ARTIST];
  }

  const { value: protectedRaw, saved } = protectGroupNames(raw);
  const normalizedSeparators = protectedRaw
    .replace(/\s+feat(?:uring)?\.?\s+/gi, ',')
    .replace(/\s+ft\.?\s+/gi, ',')
    .replace(/\s+with\s+/gi, ',')
    .replace(/\s*\+\s*/g, ',')
    .replace(/\s*×\s*/g, ',')
    .replace(/\s+x\s+/gi, ',')
    .replace(/\s*&\s*/g, ',')
    // "/" only with spaces around it, so "AC/DC"-style names survive.
    .replace(/\s+\/\s+/g, ',')
    .replace(/[;,|]+/g, ',');

  const parts = normalizedSeparators
    .split(',')
    // A protected group name is one artist: the "A and B" splitter must not run on it.
    .flatMap((part) => (part.includes('') ? [restoreGroupNames(part, saved)] : splitSimpleAnd(restoreGroupNames(part, saved))))
    .map(normalizePart)
    .filter(Boolean);

  if (!parts.length) {
    return [raw];
  }

  const seen = new Set<string>();
  const unique: string[] = [];

  for (const part of parts) {
    const key = part.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(part);
  }

  return unique.length ? unique : [raw];
};

/**
 * Bounded memo for `splitArtistNames`. The split runs ~8 regex passes and is called inside
 * whole-library loops, but a 10k-song library only has a few thousand distinct artist strings.
 * When the cache fills it is cleared wholesale rather than evicted per entry; the next pass
 * simply re-warms it.
 */
const SPLIT_ARTIST_CACHE_LIMIT = 4000;
const splitArtistCache = new Map<string, string[]>();

/**
 * Splits a raw artist credit ("A feat. B & C") into its individual names.
 * The returned array is shared via a module cache: treat it as read-only and copy before mutating.
 */
export const splitArtistNames = (artist: string | null | undefined): string[] => {
  const key = artist ?? '';
  const cached = splitArtistCache.get(key);
  if (cached) {
    return cached;
  }
  const result = splitArtistNamesUncached(artist);
  if (splitArtistCache.size >= SPLIT_ARTIST_CACHE_LIMIT) {
    splitArtistCache.clear();
  }
  splitArtistCache.set(key, result);
  return result;
};

export const getPrimaryArtistName = (artist: string | null | undefined): string => {
  const parts = splitArtistNames(artist);
  return parts[0] ?? UNKNOWN_ARTIST;
};

export const normalizeArtistLookupText = (value: string): string =>
  normalizeWhitespace(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\$/g, 's')
    .replace(/!/g, 'i')
    .replace(/@/g, 'a')
    .replace(/æ/g, 'ae')
    .replace(/œ/g, 'oe')
    .replace(/ß/g, 'ss')
    .replace(/&/g, ' and ')
    // Any script: letters, digits and combining marks (Indic vowel signs are marks).
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeLookupText = normalizeArtistLookupText;

const PLACEHOLDER_ARTISTS = new Set(['unknown artist', 'unknown', 'various artists', 'various', 'va', 'soundcloud', 'youtube']);
const CHANNEL_WORDS = new Set(['topic', 'vevo', 'records', 'recordings', 'youtube', 'lyrics', 'thefloridaman', 'uploads']);

/**
 * Whether an artist field is an uploader handle or channel rather than an artist. Whole words and
 * suffixes only, so real acts containing the letters ("Musical Youth", "The Music") are not
 * flagged, and a name in a non-Latin script is a real name. Mirrors the Rust check.
 */
const isLowConfidenceArtistName = (artist: string): boolean => {
  if (!artist.trim()) {
    return true;
  }
  const normalized = normalizeLookupText(artist);
  if (!normalized || PLACEHOLDER_ARTISTS.has(normalized)) {
    return true;
  }
  const words = normalized.split(' ');
  const compact = words.join('');
  const last = words[words.length - 1];
  if (words[0] === 'user' && /^\d+$/.test(words[1] ?? '')) {
    return true;
  }
  return (
    words.some((word) => CHANNEL_WORDS.has(word)) ||
    compact.endsWith('vevo') ||
    compact.endsWith('topic') ||
    (words.length > 1 && last === 'music' && words[0] !== 'the') ||
    (words.length > 1 && (last === 'official' || last === 'channel'))
  );
};

const splitArtistTitleHint = (title: string | null | undefined): { artist: string; title: string } | null => {
  const raw = normalizeWhitespace(title ?? '');
  const separators = [' - ', ' – ', ' — ', ' | '];
  for (const separator of separators) {
    const index = raw.indexOf(separator);
    if (index <= 0) {
      continue;
    }
    const artist = normalizePart(raw.slice(0, index));
    // Only separators are trimmed from the title side: "Kendrick Lamar - HUMBLE." keeps its period.
    const trackTitle = normalizeWhitespace(raw.slice(index + separator.length).replace(/^[\s\-–—|]+|[\s\-–—|]+$/g, ''));
    if (artist && trackTitle) {
      return { artist, title: trackTitle };
    }
  }
  return null;
};

export const getMetadataArtistName = (
  artist: string | null | undefined,
  title: string | null | undefined,
): string => {
  const primaryArtist = getPrimaryArtistName(artist);
  const parsed = splitArtistTitleHint(title);
  if (!parsed) {
    return primaryArtist;
  }

  // A real artist tag always wins; the "Artist - Title" hint only fills in a missing or junk tag,
  // so "Blackbird - 2018 Mix" by The Beatles never becomes artist "Blackbird".
  if (!isLowConfidenceArtistName(primaryArtist)) {
    return primaryArtist;
  }
  // "War Pigs - 2009 Remaster": the right side is a version, so the left side is the title.
  if (isVersionQualifier(parsed.title) || isUploadNoise(parsed.title)) {
    return primaryArtist;
  }
  return normalizeLookupText(parsed.artist) ? parsed.artist : primaryArtist;
};

/** Drops an "Artist - " prefix when it names the song's own artist. */
const stripArtistPrefix = (title: string, artistHint: string | null | undefined): string => {
  const parsed = splitArtistTitleHint(title);
  const parsedKey = parsed ? normalizeLookupText(parsed.artist) : '';
  if (parsed && parsedKey && artistHint && parsedKey === normalizeLookupText(artistHint)) {
    return parsed.title;
  }
  return title;
};

/** The name to look a song up by: artist prefix, upload junk, versions and credits removed. */
const cleanMetadataTrackTitle = (
  title: string | null | undefined,
  artistHint?: string | null,
): string => normalizePart(stripForLookup(stripArtistPrefix(normalizeWhitespace(title ?? ''), artistHint)));

export const getMetadataLookupParts = (
  artist: string | null | undefined,
  title: string | null | undefined,
): { artist: string; title: string } => {
  const lookupArtist = getMetadataArtistName(artist, title);
  const lookupTitle = cleanMetadataTrackTitle(title, lookupArtist) || normalizeWhitespace(title ?? '');
  return { artist: lookupArtist, title: lookupTitle };
};

/** Songs and albums the library files under an artist, sent with artist lookups to tell namesakes apart. */
export interface ArtistLookupContext {
  titles: string[];
  albums: string[];
}

const MAX_CONTEXT_TITLES = 4;
const MAX_CONTEXT_ALBUMS = 3;

/**
 * Collects lookup titles and albums of songs credited to `artistName`. Songs where the artist is
 * the lookup artist come first; features ("50 Cent, Olivia") fill in when that is all there is.
 */
export const getArtistLookupContext = (
  songs: ReadonlyArray<{ artist: string; title: string; album?: string | null }>,
  artistName: string,
): ArtistLookupContext => {
  const key = normalizeLookupText(artistName);
  const context: ArtistLookupContext = { titles: [], albums: [] };
  if (!key) {
    return context;
  }
  const add = (list: string[], value: string | null | undefined, limit: number) => {
    const trimmed = normalizeWhitespace(value ?? '');
    const valueKey = normalizeLookupText(trimmed);
    if (list.length < limit && valueKey && !['unknown album', 'unknown title'].includes(valueKey)
      && !list.some((entry) => normalizeLookupText(entry) === valueKey)) {
      list.push(trimmed);
    }
  };
  const featured: typeof songs[number][] = [];
  for (const song of songs) {
    if (context.titles.length >= MAX_CONTEXT_TITLES && context.albums.length >= MAX_CONTEXT_ALBUMS) {
      break;
    }
    if (normalizeLookupText(getMetadataArtistName(song.artist, song.title)) === key) {
      add(context.titles, getMetadataLookupParts(song.artist, song.title).title, MAX_CONTEXT_TITLES);
      add(context.albums, song.album, MAX_CONTEXT_ALBUMS);
    } else if (featured.length < MAX_CONTEXT_TITLES && splitArtistNames(song.artist).some((name) => normalizeLookupText(name) === key)) {
      featured.push(song);
    }
  }
  for (const song of featured) {
    add(context.titles, getMetadataLookupParts(song.artist, song.title).title, MAX_CONTEXT_TITLES);
    add(context.albums, song.album, MAX_CONTEXT_ALBUMS);
  }
  return context;
};

const titleHasArtistPrefix =(artist: string | null | undefined, title: string | null | undefined): boolean => {
  const parsed = splitArtistTitleHint(title);
  if (!parsed) {
    return false;
  }
  const artistKey = normalizeLookupText(getPrimaryArtistName(artist));
  const parsedKey = normalizeLookupText(parsed.artist);
  return Boolean(artistKey && parsedKey && (artistKey === parsedKey || artistKey.includes(parsedKey) || parsedKey.includes(artistKey)));
};

/**
 * The title to show, when the tag needs repair: an uploader's "Artist - " prefix and upload junk
 * ("(Official Audio)", "[HD]", "(prod. X)") are removed. Version information the artist put in the
 * name ("- 2013 Remaster", "(with Tems)") is kept. Returns null when the tag is fine as it is.
 */
export const getDisplayTitleRepair = (
  artist: string | null | undefined,
  title: string | null | undefined,
): string | null => {
  const raw = normalizeWhitespace(title ?? '');
  if (!raw) {
    return null;
  }
  const withoutPrefix = titleHasArtistPrefix(artist, raw) ? splitArtistTitleHint(raw)?.title ?? raw : raw;
  // Not normalizePart: its trim eats trailing periods, which belong to "HUMBLE.", "DNA.", "T.N.T.".
  const repaired = normalizeWhitespace(stripUploadNoise(withoutPrefix));
  if (!repaired || repaired === raw) {
    return null;
  }
  if (normalizeLookupText(repaired) === normalizeLookupText(getPrimaryArtistName(artist))) {
    return null;
  }
  return repaired;
};
