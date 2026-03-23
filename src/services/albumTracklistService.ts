import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';

const cachePath = 'metadata_cache/album_tracklist_cache.json';

export type AlbumTrack = {
  position: number;
  title: string;
};

export type AlbumTracklist = {
  key: string;
  album: string;
  artist: string;
  tracks: AlbumTrack[];
  source: 'musicbrainz';
  fetchedAt: number;
};

export type AlbumTracklistCache = Record<string, AlbumTracklist>;

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

export const normalizeTrackTitle = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

export const getAlbumTracklistKey = (artist: string, album: string): string => {
  return `${slugify(artist || 'unknown-artist')}--${slugify(album || 'unknown-album')}`;
};

const fetchJson = async <T>(endpoint: string): Promise<T> => {
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      // Browsers ignore User-Agent, but Tauri may pass it through.
      'User-Agent': 'AmplyMusicPlayer/1.4 (https://github.com/)',
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type MbReleaseSearch = {
  releases?: Array<{
    id: string;
    title?: string;
    status?: string;
    'artist-credit'?: Array<{ name?: string }>;
  }>;
};

type MbReleaseLookup = {
  media?: Array<{
    tracks?: Array<{
      position?: number;
      number?: string;
      title?: string;
      recording?: { title?: string };
    }>;
  }>;
};

const findBestReleaseId = (result: MbReleaseSearch, album: string): string | null => {
  const releases = result.releases ?? [];
  if (!releases.length) {
    return null;
  }
  const normalizedAlbum = normalizeTrackTitle(album);
  const exact = releases.find((release) => normalizeTrackTitle(release.title ?? '') === normalizedAlbum);
  if (exact?.id) {
    return exact.id;
  }
  const official = releases.find((release) => (release.status ?? '').toLowerCase() === 'official');
  return official?.id ?? releases[0]?.id ?? null;
};

const parseReleaseTracks = (payload: MbReleaseLookup): AlbumTrack[] => {
  const tracks: AlbumTrack[] = [];
  for (const medium of payload.media ?? []) {
    for (const track of medium.tracks ?? []) {
      const title = track.title ?? track.recording?.title ?? '';
      if (!title) {
        continue;
      }
      const position = track.position ?? Number(track.number ?? 0);
      tracks.push({ position: Number.isFinite(position) ? position : 0, title });
    }
  }
  return tracks
    .map((track, index) => ({
      position: track.position > 0 ? track.position : index + 1,
      title: track.title,
    }))
    .sort((a, b) => a.position - b.position);
};

export const loadAlbumTracklistCache = async (): Promise<AlbumTracklistCache> => {
  return readStorageJson<AlbumTracklistCache>(cachePath, {});
};

export const readCachedAlbumTracklist = async (
  artist: string,
  album: string,
): Promise<AlbumTracklist | null> => {
  if (!artist?.trim() || !album?.trim()) {
    return null;
  }
  const cache = await loadAlbumTracklistCache();
  const key = getAlbumTracklistKey(artist, album);
  return cache[key] ?? null;
};

export const loadAlbumTracklist = async (artist: string, album: string): Promise<AlbumTracklist | null> => {
  if (!artist?.trim() || !album?.trim()) {
    return null;
  }
  const cache = await loadAlbumTracklistCache();
  const key = getAlbumTracklistKey(artist, album);
  const cached = cache[key];
  if (cached?.tracks?.length) {
    return cached;
  }

  const query = encodeURIComponent(`artist:${artist} AND release:${album}`);
  const searchEndpoint = `https://musicbrainz.org/ws/2/release/?query=${query}&fmt=json&limit=5`;
  const searchResult = await fetchJson<MbReleaseSearch>(searchEndpoint);
  const releaseId = findBestReleaseId(searchResult, album);
  if (!releaseId) {
    return null;
  }

  await delay(1100);
  const lookupEndpoint = `https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings&fmt=json`;
  const lookupResult = await fetchJson<MbReleaseLookup>(lookupEndpoint);
  const tracks = parseReleaseTracks(lookupResult);
  if (!tracks.length) {
    return null;
  }

  const entry: AlbumTracklist = {
    key,
    album,
    artist,
    tracks,
    source: 'musicbrainz',
    fetchedAt: Math.floor(Date.now() / 1000),
  };
  cache[key] = entry;
  await writeStorageJsonDebounced(cachePath, cache);
  return entry;
};
