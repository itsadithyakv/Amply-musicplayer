import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';
import { markArtistCached } from '@/services/metadataCacheIndex';

const cacheFolder = 'artist_cache';

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const hashString = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return Math.abs(hash).toString(36);
};

const cacheKeyForArtist = (artistName: string): string => {
  const base = artistName || 'unknown-artist';
  const slug = slugify(base);
  const artistSlug = slug || `artist-${hashString(base)}`;
  return `${cacheFolder}/${artistSlug}.json`;
};

const normalizeText = (value: string): string => value.trim().toLowerCase();

const countWords = (value: string): number => {
  if (!value) {
    return 0;
  }
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean).length;
};

const isDisambiguationText = (value: string): boolean => {
  const text = normalizeText(value);
  return text.includes('may refer to') || text.includes('can refer to');
};

const musicKeywords = [
  'band',
  'musician',
  'singer',
  'rapper',
  'dj',
  'group',
  'music',
  'album',
  'song',
];

const isMusicRelatedText = (value: string): boolean => {
  const text = normalizeText(value);
  return musicKeywords.some((keyword) => text.includes(keyword));
};

const isLikelyArtistTitle = (title: string, artistName: string): boolean => {
  const normalizedTitle = normalizeText(title);
  const normalizedArtist = normalizeText(artistName);
  const hasQualifier =
    normalizedTitle.includes('(band)') ||
    normalizedTitle.includes('(musician)') ||
    normalizedTitle.includes('(singer)') ||
    normalizedTitle.includes('(rapper)') ||
    normalizedTitle.includes('(dj)') ||
    normalizedTitle.includes('(group)');

  return normalizedTitle === normalizedArtist || normalizedTitle.includes(normalizedArtist) || hasQualifier;
};

const toWordRange = (value: string, minWords = 100, maxWords = 200): string => {
  const words = value
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (!words.length) {
    return '';
  }

  if (words.length > maxWords) {
    return `${words.slice(0, maxWords).join(' ')}...`;
  }

  if (words.length < minWords) {
    return words.join(' ');
  }

  return words.join(' ');
};

interface WikipediaSummaryPayload {
  title?: string;
  type?: string;
  extract?: string;
  thumbnail?: {
    source?: string;
  };
  content_urls?: {
    desktop?: {
      page?: string;
    };
  };
}

interface WikipediaSearchPayload {
  query?: {
    search?: Array<{
      title?: string;
    }>;
  };
}

interface WikipediaExtractPayload {
  query?: {
    pages?: Record<
      string,
      {
        extract?: string;
      }
    >;
  };
}

export interface ArtistProfile {
  artistName: string;
  summary: string;
  imageUrl: string | null;
  sourceUrl: string | null;
  fetchedAt: number;
}

export type ArtistProfileLoadResult =
  | { status: 'ready'; profile: ArtistProfile; fromCache: boolean; cachePath: string }
  | { status: 'no-internet'; cachePath: string }
  | { status: 'missing'; cachePath: string };

const fetchWikipediaSummary = async (pageTitle: string): Promise<WikipediaSummaryPayload | null> => {
  const endpoint = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle)}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as WikipediaSummaryPayload;
};

const fetchWikipediaSearchTitles = async (artistName: string): Promise<string[]> => {
  const query = `"${artistName}" musician singer rapper band`;
  const endpoint = `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=8&format=json&origin=*&srsearch=${encodeURIComponent(query)}`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    return [];
  }

  const payload = (await response.json()) as WikipediaSearchPayload;
  const titles = (payload.query?.search ?? [])
    .map((entry) => entry.title?.trim())
    .filter((title): title is string => Boolean(title));

  return titles.sort((a, b) => {
    const score = (title: string): number => {
      let points = 0;
      if (isLikelyArtistTitle(title, artistName)) {
        points += 4;
      }
      if (normalizeText(title) === normalizeText(artistName)) {
        points += 3;
      }
      if (isMusicRelatedText(title)) {
        points += 2;
      }
      return points;
    };

    return score(b) - score(a);
  });
};

const fetchWikipediaIntroExtract = async (pageTitle: string): Promise<string | null> => {
  const endpoint = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&exintro=1&format=json&origin=*&titles=${encodeURIComponent(pageTitle)}`;
  const response = await fetch(endpoint);

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as WikipediaExtractPayload;
  const pages = payload.query?.pages ?? {};
  const extract = Object.values(pages)[0]?.extract?.trim();
  return extract || null;
};

const buildCandidateTitles = async (artistName: string): Promise<string[]> => {
  const trimmed = artistName.trim();
  const qualifiers = ['musician', 'band', 'singer', 'rapper', 'dj', 'group'];
  const qualified = qualifiers.map((qualifier) => `${trimmed} (${qualifier})`);
  const searched = await fetchWikipediaSearchTitles(trimmed);

  return [
    ...qualified,
    trimmed,
    ...searched,
  ].filter(Boolean);
};

const fetchArtistProfile = async (artistName: string): Promise<ArtistProfile | null> => {
  const candidateTitles = await buildCandidateTitles(artistName);
  const seen = new Set<string>();

  for (const title of candidateTitles) {
    const normalized = normalizeText(title);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);

    const summaryPayload = await fetchWikipediaSummary(title);
    if (!summaryPayload) {
      continue;
    }

    const summaryExtract = summaryPayload.extract?.trim() ?? '';
    const isDisambiguation = summaryPayload.type === 'disambiguation' || isDisambiguationText(summaryExtract);
    if (isDisambiguation) {
      continue;
    }

    const resolvedTitle = summaryPayload.title?.trim() || title;
    const introExtract = await fetchWikipediaIntroExtract(resolvedTitle);
    const mergedSummary = toWordRange(introExtract?.trim() || summaryExtract, 100, 200);

    if (!mergedSummary || isDisambiguationText(mergedSummary)) {
      continue;
    }

    const titleMatches = isLikelyArtistTitle(resolvedTitle, artistName);
    if (!isMusicRelatedText(mergedSummary) && !titleMatches) {
      continue;
    }

    return {
      artistName,
      summary: mergedSummary,
      imageUrl: summaryPayload.thumbnail?.source ?? null,
      sourceUrl: summaryPayload.content_urls?.desktop?.page ?? null,
      fetchedAt: Math.floor(Date.now() / 1000),
    };
  }

  return null;
};

const isValidCachedSummary = (summary: string | undefined): boolean => {
  if (!summary?.trim()) {
    return false;
  }

  if (isDisambiguationText(summary)) {
    return false;
  }

  return isMusicRelatedText(summary) || countWords(summary) >= 40;
};

export const hasCachedArtistProfile = async (artistNameRaw: string): Promise<boolean> => {
  const artistName = artistNameRaw.trim();
  if (!artistName || artistName.toLowerCase() === 'unknown artist') {
    return true;
  }

  const cacheKey = cacheKeyForArtist(artistName);
  const cached = await readStorageJson<ArtistProfile | null>(cacheKey, null);
  return Boolean(cached?.summary?.trim() && isValidCachedSummary(cached.summary));
};

export const readCachedArtistProfile = async (artistNameRaw: string): Promise<ArtistProfileLoadResult> => {
  const artistName = artistNameRaw.trim();
  const cacheKey = cacheKeyForArtist(artistName);
  const cachePath = `storage/${cacheKey}`;

  if (!artistName || artistName.toLowerCase() === 'unknown artist') {
    return { status: 'missing', cachePath };
  }

  const cached = await readStorageJson<ArtistProfile | null>(cacheKey, null);
  if (cached?.summary?.trim() && isValidCachedSummary(cached.summary)) {
    void markArtistCached(normalizeText(artistName));
    return {
      status: 'ready',
      profile: cached,
      fromCache: true,
      cachePath,
    };
  }

  return { status: 'missing', cachePath };
};

export const loadArtistProfile = async (artistNameRaw: string): Promise<ArtistProfileLoadResult> => {
  const artistName = artistNameRaw.trim();
  const cacheKey = cacheKeyForArtist(artistName);
  const cachePath = `storage/${cacheKey}`;

  if (!artistName || artistName.toLowerCase() === 'unknown artist') {
    return { status: 'missing', cachePath };
  }

  const cached = await readStorageJson<ArtistProfile | null>(cacheKey, null);
  if (cached?.summary?.trim() && isValidCachedSummary(cached.summary)) {
    void markArtistCached(normalizeText(artistName));
    return {
      status: 'ready',
      profile: cached,
      fromCache: true,
      cachePath,
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { status: 'no-internet', cachePath };
  }

  try {
    const fetched = await fetchArtistProfile(artistName);
    if (!fetched) {
      return { status: 'missing', cachePath };
    }

    await writeStorageJsonDebounced(cacheKey, fetched);
    void markArtistCached(normalizeText(artistName));
    return {
      status: 'ready',
      profile: fetched,
      fromCache: false,
      cachePath,
    };
  } catch {
    return { status: 'no-internet', cachePath };
  }
};
