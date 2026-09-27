import type { Playlist } from '@/types/music';
import { t } from '@/i18n';
import { probeAudioFiles } from '@/services/musicScanner';
import { openTextFile, safeFileName, saveTextFile } from '@/services/fileDialogs';
import { buildM3u, parseM3u, pathKey, playlistNameFromPath } from '@/services/playlistFiles';
import { useLibraryStore } from '@/store/libraryStore';

/** Saves `playlist` as an .m3u8 file. Resolves to the saved path, or null when cancelled. */
export const exportPlaylistFile = async (playlist: Pick<Playlist, 'name' | 'songIds'>): Promise<string | null> => {
  const library = useLibraryStore.getState();
  const byId = library.getSongsById();
  const songs = playlist.songIds.map((id) => byId.get(id)).filter((song) => song !== undefined);
  return saveTextFile({
    title: t('messages.playlistFile.exportTitle'),
    defaultName: `${safeFileName(playlist.name)}.m3u8`,
    filterName: t('messages.playlistFile.filterName'),
    extensions: ['m3u8', 'm3u'],
    content: buildM3u(playlist.name, songs),
  });
};

export interface PlaylistImportResult {
  playlistId: string;
  name: string;
  found: number;
  total: number;
}

/**
 * Asks for an .m3u / .m3u8 file and turns it into a custom playlist. Entries already in the library
 * are matched by path; files that exist but live elsewhere are added as loose files; entries whose
 * file is gone are skipped and counted.
 */
export const importPlaylistFile = async (): Promise<PlaylistImportResult | null> => {
  const file = await openTextFile({
    title: t('messages.playlistFile.importTitle'),
    filterName: t('messages.playlistFile.filterName'),
    extensions: ['m3u8', 'm3u'],
  });
  if (!file) {
    return null;
  }
  const parsed = parseM3u(file.content, file.path);
  const library = useLibraryStore.getState();
  const byPath = new Map(library.songs.map((song) => [pathKey(song.path), song.id]));

  const missing = parsed.paths.filter((path) => !byPath.has(pathKey(path)));
  if (missing.length) {
    const found = await probeAudioFiles(missing).catch(() => []);
    await library.addLooseSongs(found);
    for (const song of found) {
      byPath.set(pathKey(song.path), song.id);
    }
  }

  const songIds = [...new Set(parsed.paths.map((path) => byPath.get(pathKey(path))).filter((id): id is string => Boolean(id)))];
  const name = parsed.name ?? playlistNameFromPath(file.path);
  const playlist: Playlist = {
    id: `custom_${Date.now()}`,
    name,
    type: 'custom',
    description: '',
    songIds,
    updatedAt: Date.now(),
  };
  await useLibraryStore.getState().upsertCustomPlaylist(playlist);
  return { playlistId: playlist.id, name, found: songIds.length, total: parsed.paths.length };
};
