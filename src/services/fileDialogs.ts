import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/services/storageService';

interface DialogOptions {
  title: string;
  filterName: string;
  extensions: string[];
}

/** Asks where to save `content`; resolves to the saved path, or null when cancelled. */
export const saveTextFile = async (options: DialogOptions & { defaultName: string; content: string }): Promise<string | null> => {
  if (!isTauri()) {
    return null;
  }
  return invoke<string | null>('save_text_file', { ...options });
};

/** Asks for a file and returns its path and text, or null when cancelled. */
export const openTextFile = async (options: DialogOptions): Promise<{ path: string; content: string } | null> => {
  if (!isTauri()) {
    return null;
  }
  return invoke<{ path: string; content: string } | null>('open_text_file', { ...options });
};

/** A file-name-safe version of `name`. */
export const safeFileName = (name: string): string => name.replace(/[<>:"/\|?*\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Amply';
