import type { Song } from '@/types/music';
import { getPrimaryArtistName, normalizeArtistLookupText } from '@/utils/artists';

/**
 * What stays the same when a file is moved or renamed: its tags, its length and (when known) its
 * size. A song's id is derived from its path, so without this a moved file would start over with
 * no plays, no favourite and no playlists.
 */
export const songFingerprint = (song: Pick<Song, 'title' | 'artist' | 'album' | 'duration'>): string =>
  [
    normalizeArtistLookupText(song.title ?? ''),
    normalizeArtistLookupText(getPrimaryArtistName(song.artist)),
    normalizeArtistLookupText(song.album ?? ''),
    Math.round(song.duration || 0),
  ].join('|');

/**
 * Pairs songs that disappeared since the last scan with songs that appeared in it, when both sides
 * agree on the fingerprint (and on the file size when both know it) and the pairing is unambiguous:
 * two identical rips moved at once are left alone rather than guessed at. Returns old id -> new id.
 */
export const findMovedSongs = (disappeared: readonly Song[], appeared: readonly Song[]): Map<string, string> => {
  const index = (songs: readonly Song[]) => {
    const byPrint = new Map<string, Song[]>();
    for (const song of songs) {
      if (!song.duration) {
        continue; // unreadable files have no fingerprint worth trusting
      }
      const print = songFingerprint(song);
      byPrint.set(print, [...(byPrint.get(print) ?? []), song]);
    }
    return byPrint;
  };
  const gone = index(disappeared);
  const arrived = index(appeared);
  const moved = new Map<string, string>();
  for (const [print, [old, ...otherOld]] of gone) {
    const candidates = arrived.get(print);
    if (otherOld.length || !candidates || candidates.length !== 1) {
      continue;
    }
    const [fresh] = candidates;
    if (old.size && fresh.size && old.size !== fresh.size) {
      continue;
    }
    moved.set(old.id, fresh.id);
  }
  return moved;
};

/** `ids` with every moved id replaced, keeping order and dropping duplicates. */
export const remapSongIdList = (ids: readonly string[], moved: ReadonlyMap<string, string>): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const next = moved.get(id) ?? id;
    if (!seen.has(next)) {
      seen.add(next);
      out.push(next);
    }
  }
  return out;
};
