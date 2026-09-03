import { cancelIdle, requestIdle, type IdleHandle } from '@/utils/idle';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

const LOCAL_PREFIX = 'amply-storage:';
const SORT_PREFIX = 'amply-songlist-sort:';

const inMemoryTextCache = new Map<string, string>();
const browserWriteQueue = new Map<string, IdleHandle>();

const getBrowserStorageKey = (relativePath: string): string => `${LOCAL_PREFIX}${relativePath}`;

const cancelBrowserWrite = (relativePath: string): void => {
  const entry = browserWriteQueue.get(relativePath);
  if (!entry) {
    return;
  }
  browserWriteQueue.delete(relativePath);
  cancelIdle(entry);
};

const scheduleBrowserWrite = (relativePath: string): void => {
  cancelBrowserWrite(relativePath);
  if (typeof window === 'undefined') {
    return;
  }

  const flush = (): void => {
    browserWriteQueue.delete(relativePath);
    const content = inMemoryTextCache.get(relativePath);
    if (content === undefined) {
      return;
    }
    try {
      window.localStorage.setItem(getBrowserStorageKey(relativePath), content);
    } catch {
      // Ignore quota or storage failures.
    }
  };

  browserWriteQueue.set(relativePath, requestIdle(flush, { timeout: 500, fallbackDelayMs: 200 }));
};

const flushBrowserWrites = (): void => {
  Array.from(browserWriteQueue.keys()).forEach((relativePath) => {
    cancelBrowserWrite(relativePath);
    const content = inMemoryTextCache.get(relativePath);
    if (typeof window === 'undefined' || content === undefined) {
      return;
    }
    try {
      window.localStorage.setItem(getBrowserStorageKey(relativePath), content);
    } catch {
      // Ignore failure.
    }
  });
};

export const isTauri = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  return '__TAURI_INTERNALS__' in window;
};

export const toPlayableSrc = (filePath: string): string => {
  if (!isTauri()) {
    return filePath;
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  return convertFileSrc(normalizedPath);
};

export const ensureStorageDirs = async (): Promise<string> => {
  if (isTauri()) {
    return invoke<string>('ensure_storage_dirs');
  }

  return 'storage';
};

export const openStorageDir = async (): Promise<void> => {
  if (isTauri()) {
    await invoke('open_storage_dir');
  }
};

export const deleteSongFile = async (path: string): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  return invoke<boolean>('delete_song_file', { path });
};

export const pickMusicFolders = async (): Promise<string[]> => {
  if (isTauri()) {
    return invoke<string[]>('pick_music_folders');
  }

  return [];
};

export const readStorageText = async (relativePath: string): Promise<string | null> => {
  if (isTauri()) {
    const content = await invoke<string | null>('read_storage_file', { relativePath });
    if (content !== null) {
      inMemoryTextCache.set(relativePath, content);
    }
    return content;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  const cached = inMemoryTextCache.get(relativePath);
  if (cached !== undefined) {
    return cached;
  }

  const content = window.localStorage.getItem(getBrowserStorageKey(relativePath));
  if (content !== null) {
    inMemoryTextCache.set(relativePath, content);
  }
  return content;
};

export const writeStorageText = async (relativePath: string, content: string): Promise<void> => {
  inMemoryTextCache.set(relativePath, content);

  if (isTauri()) {
    await invoke('write_storage_file', { relativePath, content });
    return;
  }

  scheduleBrowserWrite(relativePath);
};

const quarantineCorruptJson = async <T>(
  relativePath: string,
  content: string,
  fallback: T,
): Promise<void> => {
  const backupPath = `${relativePath}.corrupt.${Date.now()}`;
  try {
    await writeStorageText(backupPath, content);
    await writeStorageText(relativePath, JSON.stringify(fallback, null, 2));
  } catch {
    inMemoryTextCache.delete(relativePath);
  }
};

export const readStorageJson = async <T>(relativePath: string, fallback: T): Promise<T> => {
  try {
    const content = await readStorageText(relativePath);
    if (!content) {
      return fallback;
    }
    try {
      return JSON.parse(content) as T;
    } catch {
      await quarantineCorruptJson(relativePath, content, fallback);
      return fallback;
    }
  } catch {
    return fallback;
  }
};

const lastWrittenJson = new Map<string, string>();

export const writeStorageJson = async <T>(relativePath: string, value: T): Promise<void> => {
  const serialized = JSON.stringify(value, null, 2);
  const last = lastWrittenJson.get(relativePath);
  if (last === serialized) {
    return;
  }
  lastWrittenJson.set(relativePath, serialized);
  await writeStorageText(relativePath, serialized);
};

const debouncedJsonWrites = new Map<
  string,
  {
    timeout: number;
    value: unknown;
  }
>();

export const writeStorageJsonDebounced = async <T>(
  relativePath: string,
  value: T,
  delayMs = 1200,
): Promise<void> => {
  if (typeof window === 'undefined') {
    await writeStorageJson(relativePath, value);
    return;
  }

  const existing = debouncedJsonWrites.get(relativePath);
  if (existing) {
    window.clearTimeout(existing.timeout);
  }

  const timeout = window.setTimeout(() => {
    debouncedJsonWrites.delete(relativePath);
    void writeStorageJson(relativePath, value as T);
  }, delayMs);

  debouncedJsonWrites.set(relativePath, { timeout, value });
};

const flushDebouncedWrites = async (): Promise<void> => {
  const entries = Array.from(debouncedJsonWrites.entries());
  debouncedJsonWrites.clear();

  await Promise.all(
    entries.map(async ([path, entry]) => {
      window.clearTimeout(entry.timeout);
      await writeStorageJson(path, entry.value);
    }),
  );
};

export const flushPendingWrites = async (): Promise<void> => {
  flushBrowserWrites();
  await flushDebouncedWrites();
};

export const hasPendingDebouncedWrites = (): boolean => debouncedJsonWrites.size > 0;

export const clearStorageCache = async (): Promise<void> => {
  if (isTauri()) {
    await invoke('clear_storage_cache');
    inMemoryTextCache.clear();
    browserWriteQueue.clear();
    lastWrittenJson.clear();
    debouncedJsonWrites.forEach((entry) => window.clearTimeout(entry.timeout));
    debouncedJsonWrites.clear();
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

  flushBrowserWrites();
  inMemoryTextCache.clear();
  lastWrittenJson.clear();

  const keys: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key) {
      continue;
    }
    if (key.startsWith(LOCAL_PREFIX) || key.startsWith(SORT_PREFIX)) {
      keys.push(key);
    }
  }

  keys.forEach((key) => window.localStorage.removeItem(key));
};
