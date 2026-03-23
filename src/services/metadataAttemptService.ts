import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';

const cachePath = 'metadata_cache/metadata_attempts.json';
const MAX_ATTEMPTS = 3;

type AttemptState = {
  attempts: number;
  status: 'pending' | 'not_found';
  lastAttemptAt: number;
};

export type MetadataAttempts = {
  songs: Record<string, Partial<Record<'lyrics' | 'genre' | 'loudness', AttemptState>>>;
  artists: Record<string, AttemptState>;
  albums: Record<string, AttemptState>;
  albumTracklists: Record<string, AttemptState>;
};

const inFlight = new Set<string>();

const buildKey = (type: string, id: string) => `${type}:${id}`;

const nextFailureState = (current?: AttemptState): AttemptState => {
  const attempts = (current?.attempts ?? 0) + 1;
  return {
    attempts,
    status: attempts >= MAX_ATTEMPTS ? 'not_found' : 'pending',
    lastAttemptAt: Math.floor(Date.now() / 1000),
  };
};

export const loadMetadataAttempts = async (): Promise<MetadataAttempts> => {
  const loaded = await readStorageJson<MetadataAttempts>(cachePath, { songs: {}, artists: {}, albums: {}, albumTracklists: {} });
  return {
    songs: loaded.songs ?? {},
    artists: loaded.artists ?? {},
    albums: loaded.albums ?? {},
    albumTracklists: loaded.albumTracklists ?? {},
  };
};

export const saveMetadataAttempts = async (cache: MetadataAttempts): Promise<void> => {
  await writeStorageJsonDebounced(cachePath, cache);
};

export const shouldSkipMetadata = (
  cache: MetadataAttempts,
  type: 'lyrics' | 'genre' | 'loudness' | 'artist' | 'album' | 'album_tracklist',
  id: string,
): boolean => {
  if (type === 'artist') {
    const entry = cache.artists[id];
    return entry?.status === 'not_found' || (entry?.attempts ?? 0) >= MAX_ATTEMPTS;
  }
  if (type === 'album') {
    const entry = cache.albums[id];
    return entry?.status === 'not_found' || (entry?.attempts ?? 0) >= MAX_ATTEMPTS;
  }
  if (type === 'album_tracklist') {
    const entry = cache.albumTracklists[id];
    return entry?.status === 'not_found' || (entry?.attempts ?? 0) >= MAX_ATTEMPTS;
  }
  const entry = cache.songs[id]?.[type];
  return entry?.status === 'not_found' || (entry?.attempts ?? 0) >= MAX_ATTEMPTS;
};

export const noteMetadataSuccess = (
  cache: MetadataAttempts,
  type: 'lyrics' | 'genre' | 'loudness' | 'artist' | 'album' | 'album_tracklist',
  id: string,
): void => {
  if (type === 'artist') {
    if (cache.artists[id]) {
      delete cache.artists[id];
    }
    return;
  }
  if (type === 'album') {
    if (cache.albums[id]) {
      delete cache.albums[id];
    }
    return;
  }
  if (type === 'album_tracklist') {
    if (cache.albumTracklists[id]) {
      delete cache.albumTracklists[id];
    }
    return;
  }
  const songEntry = cache.songs[id];
  if (!songEntry) {
    return;
  }
  delete songEntry[type];
  if (!songEntry.lyrics && !songEntry.genre && !songEntry.loudness) {
    delete cache.songs[id];
  }
};

export const noteMetadataFailure = (
  cache: MetadataAttempts,
  type: 'lyrics' | 'genre' | 'loudness' | 'artist' | 'album' | 'album_tracklist',
  id: string,
): void => {
  if (type === 'artist') {
    cache.artists[id] = nextFailureState(cache.artists[id]);
    return;
  }
  if (type === 'album') {
    cache.albums[id] = nextFailureState(cache.albums[id]);
    return;
  }
  if (type === 'album_tracklist') {
    cache.albumTracklists[id] = nextFailureState(cache.albumTracklists[id]);
    return;
  }
  const songEntry = cache.songs[id] ?? {};
  songEntry[type] = nextFailureState(songEntry[type]);
  cache.songs[id] = songEntry;
};

export const tryAcquireMetadata = (
  type: 'lyrics' | 'genre' | 'loudness' | 'artist' | 'album' | 'album_tracklist',
  id: string,
): boolean => {
  const key = buildKey(type, id);
  if (inFlight.has(key)) {
    return false;
  }
  inFlight.add(key);
  return true;
};

export const releaseMetadata = (
  type: 'lyrics' | 'genre' | 'loudness' | 'artist' | 'album' | 'album_tracklist',
  id: string,
): void => {
  inFlight.delete(buildKey(type, id));
};
