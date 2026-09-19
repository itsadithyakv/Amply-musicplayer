/**
 * Title cleaning for messy real-world tags. Kept in step with the Rust side in
 * src-tauri/src/metadata/normalize.rs (`is_upload_noise`, `is_version_qualifier`,
 * `strip_title_segments`), which cleans titles for lyrics lookups.
 *
 * Two jobs, deliberately kept apart:
 * - display repair removes only upload junk ("(Official Video)", "[HD]", "(prod. X)") and never
 *   touches what the artist named the song, so "Hotel California - 2013 Remaster" stays as tagged;
 * - lookup cleaning also drops version qualifiers ("- 2013 Remaster", "(Radio Edit)",
 *   "- From "Hridayam"") so lyrics and metadata services find the song.
 *
 * Both judge a bracketed group or a " - " suffix as a whole segment. The old cleaner cut at the
 * first substring match, which turned "29 Intro" into "29" and "Happy Birthday" into "Happy Birt".
 */

/** Markers that make a whole segment upload junk wherever they appear in it. */
const UPLOAD_NOISE =
  /\b(official|visuali[sz]er|lyrics?\s+video|music\s+video|free\s+(dl|download)|out\s+now|prod(\.|uced)?\b|high\s+quality|thefloridaman)/i;
/** Words that are junk only when they are the entire segment: "(Clean)", "[HD]", "- Lyrics". */
const UPLOAD_NOISE_ALONE = /^(clean|explicit|dirty|audio|video|hd|hq|4k|lyrics?|full\s+(song|version))$/i;
/**
 * A version of the song rather than the song: a bare year, a credit ("from …", "with …", "feat. …"),
 * or any segment containing a version word as a whole word ("Mixtape" is not "mix"). Remixes and live
 * cuts count, so lookups find the original's lyrics; "Interlude", "Reprise" and "Pt. 2" are names.
 * Identical to VERSION_QUALIFIER_RE in src-tauri/src/metadata/normalize.rs.
 */
const VERSION_QUALIFIER =
  /^((19|20)\d{2}|(from|with|feat\.?|ft\.?|featuring)\b.*|.*\b(remaster(ed)?|version|edit(ed)?|mix|remix|live|acoustic|demo|instrumental|mono|stereo|bonus\s+track|deluxe|edition|anniversary|single|soundtrack|motion\s+picture|ost|sped\s+up|slowed|reverb|nightcore|8d|session|show|take\s+\d+)\b.*)$/i;
/** A bracketed group with no brackets inside it. */
const BRACKET_GROUP = /\s*[([{]([^()[\]{}]*)[)\]}]/g;
/** Inline credit at the end of a title: "Song feat. X", "Song ft X". */
const INLINE_FEAT = /\s+(feat\.?|ft\.?|featuring)\s+.*$/i;
const DASH_SEPARATORS = [' - ', ' – ', ' — ', ' | '];

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Whether a bracketed group or " - " suffix is upload junk ("Official Audio", "prod. X", "HD"). */
export const isUploadNoise = (segment: string): boolean => {
  const trimmed = segment.trim();
  return Boolean(trimmed) && (UPLOAD_NOISE.test(trimmed) || UPLOAD_NOISE_ALONE.test(trimmed));
};

/**
 * Whether a bracketed group or " - " suffix names a *version* of the song rather than the song
 * itself. Only used for lookups (lyrics, genre, artwork), never for what the library displays.
 *
 * `segment` is the text inside the brackets or after the dash, e.g. "2009 Remaster",
 * "Radio Edit", `From "Bangalore Days"`, "feat. Pitbull", "Pt. 2", "Choir Outro".
 */
export const isVersionQualifier = (segment: string): boolean => {
  const trimmed = segment.trim();
  return Boolean(trimmed) && VERSION_QUALIFIER.test(trimmed);
};

/** Rightmost " - " style separator, as [left, right]. */
const splitLastDash = (title: string): [string, string] | null => {
  let best: [number, number] | null = null;
  for (const separator of DASH_SEPARATORS) {
    const index = title.lastIndexOf(separator);
    if (index > 0 && (!best || index > best[0])) {
      best = [index, separator.length];
    }
  }
  return best ? [title.slice(0, best[0]), title.slice(best[0] + best[1])] : null;
};

/**
 * Removes bracketed groups anywhere, and trailing " - X" segments, whose content `isRemovable`
 * accepts. Never returns an empty string for a non-empty title.
 */
export const stripTitleSegments = (title: string, isRemovable: (segment: string) => boolean): string => {
  const withoutGroups = collapseWhitespace(
    title.replace(BRACKET_GROUP, (group: string, inner: string) => (isRemovable(inner) ? ' ' : group)),
  );
  let result = withoutGroups;
  for (let split = splitLastDash(result); split; split = splitLastDash(result)) {
    const [left, right] = split;
    if (!left.trim() || !isRemovable(right)) {
      break;
    }
    result = left.trim();
  }
  const cleaned = collapseWhitespace(result.replace(/[\s([{\-–—|]+$/u, ''));
  return cleaned || collapseWhitespace(title);
};

/** Upload junk removed; everything the artist named the song kept. */
export const stripUploadNoise = (title: string): string => stripTitleSegments(title, isUploadNoise);

/** Upload junk, version qualifiers and trailing credits removed: the name to look a song up by. */
export const stripForLookup = (title: string): string => {
  const stripped = stripTitleSegments(title, (segment) => isUploadNoise(segment) || isVersionQualifier(segment));
  const withoutCredit = collapseWhitespace(stripped.replace(INLINE_FEAT, ''));
  return withoutCredit || collapseWhitespace(title);
};
