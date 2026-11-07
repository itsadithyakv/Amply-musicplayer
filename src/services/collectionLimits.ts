import { FREE_FOLDER_LIMIT, FREE_PLAYLIST_LIMIT } from '@/services/proFeatures';
import { requirePro, useProStore } from '@/store/proStore';
import type { Playlist } from '@/types/music';

/**
 * The free plan keeps 5 playlists and 1 library folder. Nothing already there is ever taken away:
 * a library with more keeps them, it just can't add another without Pro.
 */

const isFolder = (path: string): boolean => /^([a-z]:[\\/]|\\\\|\/)/i.test(path.trim());

/** Playlists the user made or imported. Rule playlists are Pro already, and mixes are Amply's own. */
export const ownPlaylistCount = (playlists: readonly Playlist[]): number =>
  playlists.filter((playlist) => playlist.type === 'custom' && !playlist.rules).length;

export const hasPlaylistRoom = (playlists: readonly Playlist[], isPro: boolean): boolean =>
  isPro || ownPlaylistCount(playlists) < FREE_PLAYLIST_LIMIT;

/** True when one more playlist fits; otherwise opens the upgrade dialog and returns false. */
export const requirePlaylistRoom = (playlists: readonly Playlist[]): boolean =>
  hasPlaylistRoom(playlists, useProStore.getState().isPro) || requirePro('unlimitedPlaylists');

export const folderCount = (paths: readonly string[]): number => paths.filter(isFolder).length;

/** True when one more folder fits; otherwise opens the upgrade dialog and returns false. */
export const requireFolderRoom = (paths: readonly string[]): boolean =>
  useProStore.getState().isPro || folderCount(paths) < FREE_FOLDER_LIMIT || requirePro('libraryFolders');

/**
 * The library folders a change may keep, in the order given: all of them with Pro; otherwise the
 * folders already there, plus new ones until the free limit. `dropped` counts the new ones left out.
 */
export const allowedLibraryPaths = (
  current: readonly string[],
  next: readonly string[],
  isPro: boolean,
): { paths: string[]; dropped: number } => {
  if (isPro) {
    return { paths: [...next], dropped: 0 };
  }
  const existing = new Set(current);
  let room = Math.max(FREE_FOLDER_LIMIT, folderCount(current)) - next.filter((path) => isFolder(path) && existing.has(path)).length;
  let dropped = 0;
  const paths = next.filter((path) => {
    if (!isFolder(path) || existing.has(path)) {
      return true;
    }
    if (room > 0) {
      room -= 1;
      return true;
    }
    dropped += 1;
    return false;
  });
  return { paths, dropped };
};
