import type { Song } from '@/types/music';
import { getPrimaryArtistName } from '@/utils/artists';
import { normalizeToken } from '@/utils/text';

/**
 * The single genre taxonomy used by every mix. Order matters only for deterministic tie-breaks.
 */
export const GENRE_TAXONOMY = [
  'Pop',
  'Rock',
  'Metal',
  'Punk',
  'Hip-Hop',
  'R&B',
  'Electronic',
  'Ambient',
  'Indie',
  'Jazz',
  'Blues',
  'Classical',
  'Country',
  'Folk',
  'Latin',
  'Reggae',
  'Funk/Disco',
  'Soundtrack',
  'World',
  'Gospel',
] as const;

export type CanonicalGenre = (typeof GENRE_TAXONOMY)[number];

const TAXONOMY_INDEX = new Map<string, number>(GENRE_TAXONOMY.map((genre, index) => [genre, index]));

/**
 * How specific a bucket is. When a raw tag mentions several buckets ("folk rock", "ambient techno")
 * the most specific one wins; broad umbrellas (Pop, Rock) only win when nothing else matches.
 */
const SPECIFICITY: Record<CanonicalGenre, number> = {
  Pop: 2,
  Rock: 3,
  Indie: 5,
  Electronic: 6,
  'R&B': 7,
  Country: 7,
  Folk: 7,
  Latin: 7,
  World: 7,
  'Funk/Disco': 7,
  Jazz: 8,
  Blues: 8,
  Classical: 8,
  Reggae: 8,
  Ambient: 8,
  Soundtrack: 8,
  Gospel: 8,
  'Hip-Hop': 8,
  Metal: 9,
  Punk: 9,
};

/** Multi-token phrases, matched contiguously on normalised tokens, longest phrase first. */
const PHRASE_RULES: ReadonlyArray<readonly [string, CanonicalGenre]> = [
  ['rhythm and blues', 'R&B'],
  ['contemporary r and b', 'R&B'],
  ['r and b', 'R&B'],
  ['r n b', 'R&B'],
  ['new jack swing', 'R&B'],
  ['quiet storm', 'R&B'],
  ['neo soul', 'R&B'],
  ['drum and bass', 'Electronic'],
  ['drum n bass', 'Electronic'],
  ['d n b', 'Electronic'],
  ['trip hop', 'Electronic'],
  ['big beat', 'Electronic'],
  ['uk garage', 'Electronic'],
  ['future bass', 'Electronic'],
  ['dub techno', 'Electronic'],
  ['acid house', 'Electronic'],
  ['deep house', 'Electronic'],
  ['tech house', 'Electronic'],
  ['progressive house', 'Electronic'],
  ['big room', 'Electronic'],
  ['bass music', 'Electronic'],
  ['dark wave', 'Electronic'],
  ['hardcore techno', 'Electronic'],
  ['2 step', 'Electronic'],
  ['synth pop', 'Pop'],
  ['dance pop', 'Pop'],
  ['electro pop', 'Pop'],
  ['teen pop', 'Pop'],
  ['power pop', 'Pop'],
  ['k pop', 'Pop'],
  ['j pop', 'Pop'],
  ['c pop', 'Pop'],
  ['adult contemporary', 'Pop'],
  ['easy listening', 'Pop'],
  ['dream pop', 'Indie'],
  ['bedroom pop', 'Indie'],
  ['hip hop', 'Hip-Hop'],
  ['boom bap', 'Hip-Hop'],
  ['cloud rap', 'Hip-Hop'],
  ['g funk', 'Hip-Hop'],
  ['death metal', 'Metal'],
  ['black metal', 'Metal'],
  ['heavy metal', 'Metal'],
  ['nu metal', 'Metal'],
  ['post metal', 'Metal'],
  ['pop punk', 'Punk'],
  ['punk rock', 'Punk'],
  ['post punk', 'Punk'],
  ['post hardcore', 'Punk'],
  ['ska punk', 'Punk'],
  ['street punk', 'Punk'],
  ['skate punk', 'Punk'],
  ['garage punk', 'Punk'],
  ['garage rock', 'Rock'],
  ['new wave', 'Rock'],
  ['post rock', 'Rock'],
  ['math rock', 'Rock'],
  ['post grunge', 'Rock'],
  ['soul jazz', 'Jazz'],
  ['acid jazz', 'Jazz'],
  ['smooth jazz', 'Jazz'],
  ['big band', 'Jazz'],
  ['nu jazz', 'Jazz'],
  ['delta blues', 'Blues'],
  ['chicago blues', 'Blues'],
  ['film score', 'Soundtrack'],
  ['movie score', 'Soundtrack'],
  ['video game', 'Soundtrack'],
  ['game music', 'Soundtrack'],
  ['stage and screen', 'Soundtrack'],
  ['stage screen', 'Soundtrack'],
  ['new age', 'Ambient'],
  ['chill out', 'Ambient'],
  ['lo fi', 'Ambient'],
  ['nu disco', 'Funk/Disco'],
  ['italo disco', 'Funk/Disco'],
  ['p funk', 'Funk/Disco'],
  ['bossa nova', 'Latin'],
  ['roots reggae', 'Reggae'],
  ['honky tonk', 'Country'],
  ['singer songwriter', 'Folk'],
  ['world music', 'World'],
  ['contemporary christian', 'Gospel'],
];

const TOKEN_RULES: ReadonlyArray<readonly [string, CanonicalGenre]> = [
  // Pop
  ['pop', 'Pop'],
  ['kpop', 'Pop'],
  ['jpop', 'Pop'],
  ['cpop', 'Pop'],
  ['synthpop', 'Pop'],
  ['electropop', 'Pop'],
  ['europop', 'Pop'],
  ['schlager', 'Pop'],
  ['bubblegum', 'Pop'],
  // Rock
  ['rock', 'Rock'],
  ['alternative', 'Rock'],
  ['alt', 'Rock'],
  ['grunge', 'Rock'],
  ['prog', 'Rock'],
  ['progressive', 'Rock'],
  ['psychedelic', 'Rock'],
  ['psych', 'Rock'],
  ['britpop', 'Rock'],
  ['rockabilly', 'Rock'],
  ['krautrock', 'Rock'],
  ['stoner', 'Rock'],
  ['surf', 'Rock'],
  ['glam', 'Rock'],
  // Metal
  ['metal', 'Metal'],
  ['metalcore', 'Metal'],
  ['deathcore', 'Metal'],
  ['grindcore', 'Metal'],
  ['thrash', 'Metal'],
  ['doom', 'Metal'],
  ['sludge', 'Metal'],
  ['djent', 'Metal'],
  // Punk
  ['punk', 'Punk'],
  ['hardcore', 'Punk'],
  ['emo', 'Punk'],
  ['screamo', 'Punk'],
  ['crust', 'Punk'],
  ['oi', 'Punk'],
  // Hip-Hop
  ['hiphop', 'Hip-Hop'],
  ['rap', 'Hip-Hop'],
  ['trap', 'Hip-Hop'],
  ['drill', 'Hip-Hop'],
  ['grime', 'Hip-Hop'],
  ['crunk', 'Hip-Hop'],
  ['phonk', 'Hip-Hop'],
  ['gangsta', 'Hip-Hop'],
  // R&B
  ['rnb', 'R&B'],
  ['soul', 'R&B'],
  ['motown', 'R&B'],
  ['urban', 'R&B'],
  // Electronic
  ['electronic', 'Electronic'],
  ['electronica', 'Electronic'],
  ['electro', 'Electronic'],
  ['edm', 'Electronic'],
  ['dance', 'Electronic'],
  ['house', 'Electronic'],
  ['techno', 'Electronic'],
  ['trance', 'Electronic'],
  ['dubstep', 'Electronic'],
  ['dnb', 'Electronic'],
  ['jungle', 'Electronic'],
  ['breakbeat', 'Electronic'],
  ['breaks', 'Electronic'],
  ['idm', 'Electronic'],
  ['garage', 'Electronic'],
  ['synthwave', 'Electronic'],
  ['vaporwave', 'Electronic'],
  ['eurodance', 'Electronic'],
  ['eurobeat', 'Electronic'],
  ['hardstyle', 'Electronic'],
  ['gabber', 'Electronic'],
  ['industrial', 'Electronic'],
  ['glitch', 'Electronic'],
  ['darkwave', 'Electronic'],
  ['ebm', 'Electronic'],
  ['synth', 'Electronic'],
  ['club', 'Electronic'],
  // Ambient
  ['ambient', 'Ambient'],
  ['chillout', 'Ambient'],
  ['chillwave', 'Ambient'],
  ['chill', 'Ambient'],
  ['chillhop', 'Ambient'],
  ['downtempo', 'Ambient'],
  ['lofi', 'Ambient'],
  ['drone', 'Ambient'],
  ['meditation', 'Ambient'],
  ['relaxation', 'Ambient'],
  // Indie
  ['indie', 'Indie'],
  ['shoegaze', 'Indie'],
  ['twee', 'Indie'],
  ['jangle', 'Indie'],
  ['indietronica', 'Indie'],
  // Jazz
  ['jazz', 'Jazz'],
  ['swing', 'Jazz'],
  ['bebop', 'Jazz'],
  ['bop', 'Jazz'],
  ['dixieland', 'Jazz'],
  ['ragtime', 'Jazz'],
  // Blues
  ['blues', 'Blues'],
  // Classical
  ['classical', 'Classical'],
  ['orchestral', 'Classical'],
  ['orchestra', 'Classical'],
  ['symphony', 'Classical'],
  ['symphonic', 'Classical'],
  ['baroque', 'Classical'],
  ['opera', 'Classical'],
  ['chamber', 'Classical'],
  ['concerto', 'Classical'],
  ['sonata', 'Classical'],
  ['choral', 'Classical'],
  ['neoclassical', 'Classical'],
  // Country
  ['country', 'Country'],
  ['americana', 'Country'],
  ['bluegrass', 'Country'],
  ['outlaw', 'Country'],
  // Folk
  ['folk', 'Folk'],
  ['celtic', 'Folk'],
  ['traditional', 'Folk'],
  ['trad', 'Folk'],
  // Latin
  ['latin', 'Latin'],
  ['latino', 'Latin'],
  ['latina', 'Latin'],
  ['reggaeton', 'Latin'],
  ['salsa', 'Latin'],
  ['bachata', 'Latin'],
  ['cumbia', 'Latin'],
  ['merengue', 'Latin'],
  ['tango', 'Latin'],
  ['samba', 'Latin'],
  ['mariachi', 'Latin'],
  ['banda', 'Latin'],
  ['corrido', 'Latin'],
  ['ranchera', 'Latin'],
  ['norteno', 'Latin'],
  ['flamenco', 'Latin'],
  ['dembow', 'Latin'],
  ['urbano', 'Latin'],
  ['mpb', 'Latin'],
  // Reggae
  ['reggae', 'Reggae'],
  ['dancehall', 'Reggae'],
  ['ska', 'Reggae'],
  ['dub', 'Reggae'],
  ['rocksteady', 'Reggae'],
  // Funk/Disco
  ['funk', 'Funk/Disco'],
  ['funky', 'Funk/Disco'],
  ['disco', 'Funk/Disco'],
  ['boogie', 'Funk/Disco'],
  // Soundtrack
  ['soundtrack', 'Soundtrack'],
  ['soundtracks', 'Soundtrack'],
  ['ost', 'Soundtrack'],
  ['cinematic', 'Soundtrack'],
  ['musical', 'Soundtrack'],
  ['musicals', 'Soundtrack'],
  ['broadway', 'Soundtrack'],
  ['videogame', 'Soundtrack'],
  // World
  ['world', 'World'],
  ['bollywood', 'World'],
  ['hindi', 'World'],
  ['indian', 'World'],
  ['desi', 'World'],
  ['bhangra', 'World'],
  ['punjabi', 'World'],
  ['carnatic', 'World'],
  ['hindustani', 'World'],
  ['ghazal', 'World'],
  ['sufi', 'World'],
  ['qawwali', 'World'],
  ['filmi', 'World'],
  ['afro', 'World'],
  ['afrobeat', 'World'],
  ['afrobeats', 'World'],
  ['afropop', 'World'],
  ['highlife', 'World'],
  ['african', 'World'],
  ['arabic', 'World'],
  ['klezmer', 'World'],
  ['balkan', 'World'],
  // Gospel
  ['gospel', 'Gospel'],
  ['christian', 'Gospel'],
  ['worship', 'Gospel'],
  ['praise', 'Gospel'],
  ['ccm', 'Gospel'],
  ['hymn', 'Gospel'],
  ['hymns', 'Gospel'],
  ['spiritual', 'Gospel'],
];

const PHRASES_BY_LENGTH = [...PHRASE_RULES].sort((a, b) => b[0].split(' ').length - a[0].split(' ').length);
const TOKEN_MAP = new Map<string, CanonicalGenre>(TOKEN_RULES);

const UNKNOWN_LABELS = new Set([
  '',
  'unknown genre',
  'unknown',
  'n a',
  'na',
  'none',
  'unspecified',
  'various',
  'other',
  'misc',
  'miscellaneous',
  'genre',
  'default',
  'undefined',
  'null',
]);

/** Lowercase ASCII tokens joined by single spaces. `&` becomes "and" so "R&B" survives as "r and b". */
export const normalizeGenreText = (raw: string | null | undefined): string =>
  (raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export const isUnknownGenreLabel = (raw: string | null | undefined): boolean =>
  UNKNOWN_LABELS.has(normalizeGenreText(raw));

const matchTokens = (normalized: string): CanonicalGenre | null => {
  if (!normalized) {
    return null;
  }
  const padded = ` ${normalized} `;
  for (const [phrase, genre] of PHRASES_BY_LENGTH) {
    if (padded.includes(` ${phrase} `)) {
      return genre;
    }
  }
  const tokens = normalized.split(' ');
  let best: CanonicalGenre | null = null;
  let bestSpecificity = -1;
  for (const token of tokens) {
    const genre = TOKEN_MAP.get(token);
    if (!genre) {
      continue;
    }
    const specificity = SPECIFICITY[genre];
    // Ties go to the later token (the head noun of the tag).
    if (specificity >= bestSpecificity) {
      best = genre;
      bestSpecificity = specificity;
    }
  }
  return best;
};

const CACHE_LIMIT = 4096;
const cache = new Map<string, CanonicalGenre | null>();

/**
 * Map a raw genre tag to one of `GENRE_TAXONOMY`, or null when the tag is empty, a placeholder
 * ("Unknown Genre") or matches no bucket. Matching is token/phrase based, so "Waltz" never
 * matches "alt" and "Warehouse" never matches "house".
 */
export const canonicalGenre = (raw: string | null | undefined): CanonicalGenre | null => {
  const key = raw ?? '';
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = normalizeGenreText(key);
  const result = UNKNOWN_LABELS.has(normalized) ? null : matchTokens(normalized);
  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
  }
  cache.set(key, result);
  return result;
};

/** Slug used in `smart_genre_mix_<slug>` (same rules as the previous generator). */
export const genreSlug = (genre: string): string =>
  genre
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Tokens a canonical genre contributes to mood-hint matching ("Hip-Hop" -> "hip hop"). */
export const genreHintText = (genre: CanonicalGenre): string => normalizeGenreText(genre);

export const compareGenres = (a: string, b: string): number =>
  (TAXONOMY_INDEX.get(a) ?? Number.MAX_SAFE_INTEGER) - (TAXONOMY_INDEX.get(b) ?? Number.MAX_SAFE_INTEGER);

/**
 * Dominant genre of a set of counts: the highest count wins; ties resolve by taxonomy order so the
 * result never depends on Map insertion order. Requires a strict majority of the tagged songs.
 */
export const dominantGenre = (counts: ReadonlyMap<string, number>): CanonicalGenre | null => {
  let total = 0;
  let best: string | null = null;
  let bestCount = 0;
  for (const [genre, count] of counts) {
    total += count;
    if (count > bestCount || (count === bestCount && best !== null && compareGenres(genre, best) < 0)) {
      best = genre;
      bestCount = count;
    }
  }
  if (!best || total === 0 || bestCount * 2 <= total) {
    return null;
  }
  return best as CanonicalGenre;
};

export const artistKeyForSong = (song: Song): string =>
  normalizeToken(getPrimaryArtistName(song.artist)) || 'unknown artist';

/**
 * A song's canonical genre, falling back to the dominant canonical genre of the artist's other
 * songs when its own tag is missing or unknown. `songsByArtist` is keyed by `artistKeyForSong`.
 */
export const inferGenreForSong = (
  song: Song,
  songsByArtist: ReadonlyMap<string, readonly Song[]>,
): CanonicalGenre | null => {
  const own = canonicalGenre(song.genre);
  if (own) {
    return own;
  }
  const siblings = songsByArtist.get(artistKeyForSong(song));
  if (!siblings?.length) {
    return null;
  }
  const counts = new Map<string, number>();
  for (const sibling of siblings) {
    if (sibling.id === song.id) {
      continue;
    }
    const genre = canonicalGenre(sibling.genre);
    if (genre) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }
  return dominantGenre(counts);
};
