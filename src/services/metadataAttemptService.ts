import { readStorageJson, writeStorageJsonDebounced } from '@/services/storageService';

const cachePath = 'metadata_cache/metadata_attempts.json';
const MAX_ATTEMPTS = 3;
const NOT_FOUND_COOLDOWN_DAYS = 30;
const NOT_FOUND_COOLDOWN_SEC = NOT_FOUND_COOLDOWN_DAYS * 24 * 60 * 60;
const MIN_DIRTY_BEFORE_FLUSH = 12;
const MAX_DIRTY_FLUSH_DELAY_MS = 15000;
let dirtyCount = 0;
let lastPersistAt = 0;

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
  const now = Date.now();
  if (dirtyCount < MIN_DIRTY_BEFORE_FLUSH && now - lastPersistAt < MAX_DIRTY_FLUSH_DELAY_MS) {
    return;
  }
  dirtyCount = 0;
  lastPersistAt = now;
  await writeStorageJsonDebounced(cachePath, cache);
};

export const shouldSkipMetadata = (
  cache: MetadataAttempts,
  type: 'lyrics' | 'genre' | 'loudness' | 'artist' | 'album' | 'album_tracklist',
  id: string,
): boolean => {
  const now = Math.floor(Date.now() / 1000);
  const shouldSkipEntry = (entry?: AttemptState): boolean => {
    if (!entry) {
      return false;
    }
    const elapsed = now - entry.lastAttemptAt;
    const inCooldown = elapsed >= 0 && elapsed < NOT_FOUND_COOLDOWN_SEC;
    if (entry.status === 'not_found') {
      return inCooldown;
    }
    if ((entry.attempts ?? 0) >= MAX_ATTEMPTS) {
      return inCooldown;
    }
    return false;
  };
  if (type === 'artist') {
    return shouldSkipEntry(cache.artists[id]);
  }
  if (type === 'album') {
    return shouldSkipEntry(cache.albums[id]);
  }
  if (type === 'album_tracklist') {
    return shouldSkipEntry(cache.albumTracklists[id]);
  }
  return shouldSkipEntry(cache.songs[id]?.[type]);
};

export const noteMetadataSuccess = (
  cache: MetadataAttempts,
  type: 'lyrics' | 'genre' | 'loudness' | 'artist' | 'album' | 'album_tracklist',
  id: string,
): void => {
  if (type === 'artist') {
    if (cache.artists[id]) {
      delete cache.artists[id];
      dirtyCount += 1;
    }
    return;
  }
  if (type === 'album') {
    if (cache.albums[id]) {
      delete cache.albums[id];
      dirtyCount += 1;
    }
    return;
  }
  if (type === 'album_tracklist') {
    if (cache.albumTracklists[id]) {
      delete cache.albumTracklists[id];
      dirtyCount += 1;
    }
    return;
  }
  const songEntry = cache.songs[id];
  if (!songEntry) {
    return;
  }
  if (songEntry[type]) {
    dirtyCount += 1;
  }
  delete songEntry[type];
  if (!songEntry.lyrics && !songEntry.genre && !songEntry.loudness) {
    delete cache.songs[id];
    dirtyCount += 1;
  }
};

export const noteMetadataFailure = (
  cache: MetadataAttempts,
  type: 'lyrics' | 'genre' | 'loudness' | 'artist' | 'album' | 'album_tracklist',
  id: string,
): void => {
  if (type === 'artist') {
    dirtyCount += 1;
    cache.artists[id] = nextFailureState(cache.artists[id]);
    return;
  }
  if (type === 'album') {
    dirtyCount += 1;
    cache.albums[id] = nextFailureState(cache.albums[id]);
    return;
  }
  if (type === 'album_tracklist') {
    dirtyCount += 1;
    cache.albumTracklists[id] = nextFailureState(cache.albumTracklists[id]);
    return;
  }
  const songEntry = cache.songs[id] ?? {};
  dirtyCount += 1;
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
