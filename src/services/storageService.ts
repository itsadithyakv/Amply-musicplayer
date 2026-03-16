import { invoke, convertFileSrc } from '@tauri-apps/api/core';

const LOCAL_PREFIX = 'amply-storage:';
const SORT_PREFIX = 'amply-songlist-sort:';

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

export const pickMusicFolder = async (): Promise<string | null> => {
  if (isTauri()) {
    return invoke<string | null>('pick_music_folder');
  }

  return null;
};

export const pickMusicFolders = async (): Promise<string[]> => {
  if (isTauri()) {
    return invoke<string[]>('pick_music_folders');
  }

  return [];
};

export const readStorageText = async (relativePath: string): Promise<string | null> => {
  if (isTauri()) {
    return invoke<string | null>('read_storage_file', { relativePath });
  }

  return localStorage.getItem(`${LOCAL_PREFIX}${relativePath}`);
};

export const writeStorageText = async (relativePath: string, content: string): Promise<void> => {
  if (isTauri()) {
    await invoke('write_storage_file', { relativePath, content });
    return;
  }

  localStorage.setItem(`${LOCAL_PREFIX}${relativePath}`, content);
};

export const readStorageJson = async <T>(relativePath: string, fallback: T): Promise<T> => {
  try {
    const content = await readStorageText(relativePath);
    if (!content) {
      return fallback;
    }
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
};

export const writeStorageJson = async <T>(relativePath: string, value: T): Promise<void> => {
  await writeStorageText(relativePath, JSON.stringify(value, null, 2));
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

export const flushDebouncedWrites = async (): Promise<void> => {
  const entries = Array.from(debouncedJsonWrites.entries());
  debouncedJsonWrites.clear();

  await Promise.all(
    entries.map(async ([path, entry]) => {
      window.clearTimeout(entry.timeout);
      await writeStorageJson(path, entry.value);
    }),
  );
};

export const clearStorageCache = async (): Promise<void> => {
  if (isTauri()) {
    await invoke('clear_storage_cache');
    return;
  }

  if (typeof window === 'undefined') {
    return;
  }

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
