import { invoke, convertFileSrc } from '@tauri-apps/api/core';

const LOCAL_PREFIX = 'amply-storage:';

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
