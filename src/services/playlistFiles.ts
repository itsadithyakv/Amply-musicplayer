import type { Song } from '@/types/music';

/**
 * Extended M3U (UTF-8, "#EXTM3U"): the playlist format every desktop player reads. Paths are
 * absolute, so the file works wherever it is saved.
 */
export const buildM3u = (name: string, songs: readonly Song[]): string => {
  const lines = ['#EXTM3U', `#PLAYLIST:${name.replace(/[\r\n]+/g, ' ')}`];
  for (const song of songs) {
    lines.push(`#EXTINF:${Math.round(song.duration || -1)},${song.artist} - ${song.title}`.replace(/[\r\n]+/g, ' '));
    lines.push(song.path);
  }
  return `${lines.join('\r\n')}\r\n`;
};

const isAbsolute = (path: string) => /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\') || path.startsWith('/');

const decodeFileUrl = (value: string): string => {
  const withoutScheme = value.replace(/^file:\/\/(localhost)?\/?/i, '');
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    return withoutScheme;
  }
};

/** Collapses "." and ".." segments; keeps a Windows drive or UNC prefix. */
const normalizePath = (path: string): string => {
  const unified = path.replace(/\//g, '\\');
  const prefix = unified.match(/^([a-z]:\\|\\\\[^\\]+\\[^\\]+\\)/i)?.[0] ?? '';
  const parts: string[] = [];
  for (const part of unified.slice(prefix.length).split('\\')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }
  return prefix + parts.join('\\');
};

export interface ParsedPlaylist {
  name: string | null;
  paths: string[];
}

/**
 * Reads .m3u / .m3u8 text: comments skipped, `file://` URLs decoded, and relative entries resolved
 * against the playlist's own folder (`playlistPath`), as players that save relative paths expect.
 */
export const parseM3u = (content: string, playlistPath: string): ParsedPlaylist => {
  const folder = playlistPath.replace(/[\\/][^\\/]*$/, '');
  let name: string | null = null;
  const paths: string[] = [];
  for (const raw of content.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('#')) {
      const playlistName = line.match(/^#PLAYLIST:(.+)$/i)?.[1]?.trim();
      if (playlistName) {
        name = playlistName;
      }
      continue;
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(line) && !/^file:/i.test(line)) {
      continue; // web streams cannot become library songs
    }
    const entry = /^file:/i.test(line) ? decodeFileUrl(line) : line;
    paths.push(normalizePath(isAbsolute(entry) ? entry : `${folder}\\${entry}`));
  }
  return { name, paths };
};

/** Key for comparing file paths on Windows: separators unified, case folded. */
export const pathKey = (path: string): string => normalizePath(path).toLowerCase();

/** The playlist's name from its file name: "D:\\Lists\\Road Trip.m3u8" -> "Road Trip". */
export const playlistNameFromPath = (path: string): string =>
  path.replace(/^.*[\\/]/, '').replace(/\.m3u8?$/i, '').trim() || 'Imported playlist';
