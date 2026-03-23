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

  if (leftWords <= 2 && rightWords <= 2 && !rightStartsWithThe) {
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
