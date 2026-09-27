import type { AppSettings, Playlist, Song } from '@/types/music';
import { songFingerprint } from '@/services/songIdentity';
import { pathKey } from '@/services/playlistFiles';

const BACKUP_FORMAT = 'amply-backup';
const BACKUP_VERSION = 1;

/** Listening history for one song, keyed by where the file lives and what it is. */
interface BackupSong {
  path: string;
  fingerprint: string;
  playCount: number;
  favorite: boolean;
  lastPlayed?: number;
  skipCount?: number;
  lastSkipped?: number;
  totalPlaySeconds?: number;
}

interface BackupPlaylist {
  name: string;
  description: string;
  paths: string[];
}

export interface AmplyBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  songs: BackupSong[];
  playlists: BackupPlaylist[];
  settings: Partial<AppSettings>;
}

/** Settings that describe this machine (or a secret) rather than the user's taste. */
const MACHINE_SETTINGS: ReadonlyArray<keyof AppSettings> = ['libraryPath', 'outputDeviceName', 'launchOnStartup', 'lastFmApiKey'];

export const buildBackup = (input: {
  songs: readonly Song[];
  customPlaylists: readonly Playlist[];
  settings: AppSettings;
  appVersion: string;
  now?: Date;
}): AmplyBackup => {
  const pathById = new Map(input.songs.map((song) => [song.id, song.path]));
  const settings: Partial<AppSettings> = { ...input.settings };
  for (const key of MACHINE_SETTINGS) {
    delete settings[key];
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    appVersion: input.appVersion,
    songs: input.songs
      .filter((song) => song.playCount > 0 || song.favorite || (song.skipCount ?? 0) > 0 || song.lastPlayed)
      .map((song) => ({
        path: song.path,
        fingerprint: songFingerprint(song),
        playCount: song.playCount,
        favorite: song.favorite,
        lastPlayed: song.lastPlayed,
        skipCount: song.skipCount,
        lastSkipped: song.lastSkipped,
        totalPlaySeconds: song.totalPlaySeconds,
      })),
    playlists: input.customPlaylists.map((playlist) => ({
      name: playlist.name,
      description: playlist.description,
      paths: playlist.songIds.map((id) => pathById.get(id)).filter((path): path is string => Boolean(path)),
    })),
    settings,
  };
};

/** The backup in `text`, or null when it is not an Amply backup this version can read. */
export const parseBackup = (text: string): AmplyBackup | null => {
  try {
    const parsed = JSON.parse(text) as Partial<AmplyBackup>;
    if (parsed.format !== BACKUP_FORMAT || typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) {
      return null;
    }
    return {
      format: BACKUP_FORMAT,
      version: parsed.version,
      exportedAt: String(parsed.exportedAt ?? ''),
      appVersion: String(parsed.appVersion ?? ''),
      songs: Array.isArray(parsed.songs) ? parsed.songs.filter((song) => typeof song?.path === 'string') : [],
      playlists: Array.isArray(parsed.playlists)
        ? parsed.playlists.filter((playlist) => typeof playlist?.name === 'string' && Array.isArray(playlist.paths))
        : [],
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
    };
  } catch {
    return null;
  }
};

export type ActivityRestore = Pick<Song, 'playCount' | 'favorite' | 'lastPlayed' | 'skipCount' | 'lastSkipped' | 'totalPlaySeconds'>;

export interface RestorePlan {
  /** Merged history per library song id. */
  activity: Map<string, ActivityRestore>;
  /** Playlists to create (new name) or extend (existing name, missing songs appended). */
  playlists: Array<{ existingId: string | null; name: string; description: string; songIds: string[] }>;
  settings: Partial<AppSettings>;
  matchedSongs: number;
  unmatchedSongs: number;
}

const maxOf = (a?: number, b?: number) => (a === undefined ? b : b === undefined ? a : Math.max(a, b));

/**
 * Matches the backup to this library (by path, else by an unambiguous fingerprint, so a new drive
 * letter still restores) and merges instead of overwriting: the higher play count wins and a song
 * is a favourite if either side says so, so restoring an old backup never loses newer listening.
 */
export const planRestore = (backup: AmplyBackup, songs: readonly Song[], customPlaylists: readonly Playlist[]): RestorePlan => {
  const byPath = new Map(songs.map((song) => [pathKey(song.path), song]));
  const byPrint = new Map<string, Song | null>();
  for (const song of songs) {
    const print = songFingerprint(song);
    byPrint.set(print, byPrint.has(print) ? null : song); // null marks an ambiguous fingerprint
  }
  const resolve = (path: string, fingerprint?: string): Song | undefined =>
    byPath.get(pathKey(path)) ?? (fingerprint ? byPrint.get(fingerprint) ?? undefined : undefined);

  const activity = new Map<string, ActivityRestore>();
  let unmatchedSongs = 0;
  for (const entry of backup.songs) {
    const song = resolve(entry.path, entry.fingerprint);
    if (!song) {
      unmatchedSongs += 1;
      continue;
    }
    activity.set(song.id, {
      playCount: Math.max(song.playCount ?? 0, entry.playCount ?? 0),
      favorite: Boolean(song.favorite || entry.favorite),
      lastPlayed: maxOf(song.lastPlayed, entry.lastPlayed),
      skipCount: maxOf(song.skipCount, entry.skipCount),
      lastSkipped: maxOf(song.lastSkipped, entry.lastSkipped),
      totalPlaySeconds: maxOf(song.totalPlaySeconds, entry.totalPlaySeconds),
    });
  }

  const playlists = backup.playlists.map((playlist) => {
    const ids = playlist.paths.map((path) => resolve(path)?.id).filter((id): id is string => Boolean(id));
    const existing = customPlaylists.find((entry) => entry.name.trim().toLowerCase() === playlist.name.trim().toLowerCase());
    const songIds = existing ? [...existing.songIds, ...ids.filter((id) => !existing.songIds.includes(id))] : [...new Set(ids)];
    return { existingId: existing?.id ?? null, name: playlist.name, description: playlist.description ?? '', songIds };
  });

  return { activity, playlists, settings: backup.settings, matchedSongs: activity.size, unmatchedSongs };
};
