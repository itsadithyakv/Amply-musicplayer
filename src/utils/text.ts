/**
 * Text normalisation helpers shared by search, recommendations and cache keys.
 * Artist-name specific canonicalisation lives in `@/utils/artists` (normalizeArtistLookupText).
 */

/** Lowercase, NFKD, strip punctuation to spaces, collapse whitespace. Used by the search index. */
export const normalizeSearchText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const tokenizeSearchText = (value: string): string[] =>
  normalizeSearchText(value).split(' ').filter(Boolean);

/** ASCII-only token form: lowercase, `&` -> and, non-alphanumerics to single spaces. */
export const normalizeToken = (value: string | undefined | null): string =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** normalizeToken joined with dashes; suitable as a stable map key or slug. */
export const normalizeSlug = (value: string | undefined | null): string => normalizeToken(value).replace(/\s+/g, '-');

/** Minimal key: trimmed + lowercased (no punctuation changes). */
export const normalizeLooseKey = (value: string): string => value.trim().toLowerCase();
