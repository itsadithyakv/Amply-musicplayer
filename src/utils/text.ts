/**
 * Text normalisation helpers shared by search, recommendations and cache keys.
 * Artist-name specific canonicalisation lives in `@/utils/artists` (normalizeArtistLookupText).
 */

/**
 * Folds Latin accents ("Beyoncé" -> "beyonce", "JAŸ-Z" -> "jay-z") by dropping the combining
 * diacritics block only. Marks from other scripts (Devanagari, Tamil, Malayalam vowel signs) are
 * part of the letters and must stay.
 */
const foldLatinAccents = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '');

/** Lowercase, accent-folded, punctuation to spaces, whitespace collapsed; any script. Used by search. */
export const normalizeSearchText = (value: string): string =>
  foldLatinAccents(value.toLowerCase())
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const tokenizeSearchText = (value: string): string[] =>
  normalizeSearchText(value).split(' ').filter(Boolean);

/**
 * Token form: lowercase, accent-folded, `&` -> and, everything but letters and digits (any
 * script) to single spaces. ASCII input gives the same result as before; non-Latin names no longer
 * collapse to "" and collide with each other in keys, groupings and mix diversity rules.
 */
export const normalizeToken = (value: string | undefined | null): string =>
  foldLatinAccents((value ?? '').trim().toLowerCase())
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** normalizeToken joined with dashes; suitable as a stable map key or slug. */
export const normalizeSlug = (value: string | undefined | null): string => normalizeToken(value).replace(/\s+/g, '-');

/** Minimal key: trimmed + lowercased (no punctuation changes). */
export const normalizeLooseKey = (value: string): string => value.trim().toLowerCase();
