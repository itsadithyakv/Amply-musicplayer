const UNKNOWN_ARTIST = 'Unknown Artist';

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

export const splitArtistNames = (artist: string | null | undefined): string[] => {
  const raw = normalizeWhitespace(artist ?? '');
  if (!raw) {
    return [UNKNOWN_ARTIST];
  }

  const normalizedSeparators = raw
    .replace(/\s+feat(?:uring)?\.?\s+/gi, ',')
    .replace(/\s+ft\.?\s+/gi, ',')
    .replace(/\s+with\s+/gi, ',')
    .replace(/\s*\+\s*/g, ',')
    .replace(/\s*×\s*/g, ',')
    .replace(/\s+x\s+/gi, ',')
    .replace(/\s*&\s*/g, ',')
    .replace(/[;,/|]+/g, ',');

  const parts = normalizedSeparators
    .split(',')
    .flatMap((part) => splitSimpleAnd(part))
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
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeLookupText = normalizeArtistLookupText;

const isLowConfidenceArtistName = (artist: string): boolean => {
  const normalized = normalizeLookupText(artist);
  if (!normalized || normalized === UNKNOWN_ARTIST.toLowerCase()) {
    return true;
  }
  const compact = normalized.replace(/\s+/g, '');
  return [
    'topic',
    'vevo',
    'official',
    'channel',
    'records',
    'recordings',
    'music',
    'thefloridaman',
    'youtube',
    'lyrics',
    'archive',
  ].some((term) => compact.includes(term));
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
    const trackTitle = normalizePart(raw.slice(index + separator.length));
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

  const parsedKey = normalizeLookupText(parsed.artist);
  const primaryKey = normalizeLookupText(primaryArtist);
  if (!parsedKey || parsedKey === primaryKey) {
    return primaryArtist;
  }

  if (isLowConfidenceArtistName(primaryArtist) || !primaryKey.includes(parsedKey)) {
    return parsed.artist;
  }

  return primaryArtist;
};

const cleanMetadataTrackTitle = (
  title: string | null | undefined,
  artistHint?: string | null,
): string => {
  let cleaned = normalizeWhitespace(title ?? '');
  const parsed = splitArtistTitleHint(cleaned);
  if (parsed && artistHint && normalizeLookupText(parsed.artist) === normalizeLookupText(artistHint)) {
    cleaned = parsed.title;
  }

  const lower = cleaned.toLowerCase();
  const cutTokens = [' feat.', ' ft.', ' featuring ', ' prod.', ' produced by '];
  const cutIndex = cutTokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (cutIndex !== undefined) {
    cleaned = cleaned.slice(0, cutIndex);
  }

  const noiseTokens = [
    'official',
    'audio',
    'video',
    'lyrics',
    'lyric',
    'visualizer',
    'hq',
    'hd',
    'high quality',
    'remaster',
    'remastered',
    'instrumental',
    'acapella',
    'slowed',
    'reverb',
    'sped up',
    'speed up',
    'clean',
    'explicit',
    'vocals',
    'orchestral',
    'intro',
    'outro',
    'thefloridaman',
  ];
  const noisyLower = cleaned.toLowerCase();
  const noiseIndex = noiseTokens
    .map((token) => noisyLower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  if (noiseIndex !== undefined) {
    cleaned = cleaned.slice(0, noiseIndex);
  }

  return normalizePart(
    normalizeWhitespace(
      cleaned
        .replace(/\s*[\(\[].*?[\)\]]/g, ' ')
        .replace(/\b(remaster(?:ed)?|mono|stereo|bonus track|explicit|clean)\b/gi, ' '),
    ),
  );
};

export const getMetadataLookupParts = (
  artist: string | null | undefined,
  title: string | null | undefined,
): { artist: string; title: string } => {
  const lookupArtist = getMetadataArtistName(artist, title);
  const lookupTitle = cleanMetadataTrackTitle(title, lookupArtist) || normalizeWhitespace(title ?? '');
  return { artist: lookupArtist, title: lookupTitle };
};

const titleHasArtistPrefix = (artist: string | null | undefined, title: string | null | undefined): boolean => {
  const parsed = splitArtistTitleHint(title);
  if (!parsed) {
    return false;
  }
  const artistKey = normalizeLookupText(getPrimaryArtistName(artist));
  const parsedKey = normalizeLookupText(parsed.artist);
  return Boolean(artistKey && parsedKey && (artistKey === parsedKey || artistKey.includes(parsedKey) || parsedKey.includes(artistKey)));
};

const titleHasUploadNoise = (title: string | null | undefined): boolean => {
  const normalized = normalizeLookupText(title ?? '');
  if (!normalized) {
    return false;
  }
  return [
    'official',
    'audio',
    'video',
    'lyrics',
    'lyric',
    'visualizer',
    'hq',
    'hd',
    'high quality',
    'remaster',
    'remastered',
    'instrumental',
    'acapella',
    'slowed',
    'reverb',
    'sped up',
    'speed up',
    'vocals',
    'orchestral',
    'intro',
    'outro',
    'thefloridaman',
  ].some((token) => normalized.includes(token));
};

export const getDisplayTitleRepair = (
  artist: string | null | undefined,
  title: string | null | undefined,
): string | null => {
  const raw = normalizeWhitespace(title ?? '');
  if (!raw || (!titleHasArtistPrefix(artist, raw) && !titleHasUploadNoise(raw))) {
    return null;
  }

  const repaired = normalizePart(getMetadataLookupParts(artist, raw).title);
  if (!repaired || normalizeLookupText(repaired) === normalizeLookupText(raw)) {
    return null;
  }
  if (normalizeLookupText(repaired) === normalizeLookupText(getPrimaryArtistName(artist))) {
    return null;
  }
  return repaired;
};
