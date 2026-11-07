import { pathKey } from '@/services/playlistFiles';
import type { Song } from '@/types/music';

/** FNV-1a over the UTF-8 bytes, as `path_hash` in library.rs, so both sides suffix alike. */
const pathHash = (path: string): string => {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(path)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/**
 * Song ids come from the path with every character outside a-z0-9 folded to '_', so "Track 1.mp3"
 * and "Track_1.mp3", or the same file name in two folders "a b" and "a_b", share an id. Rust already
 * separates collisions inside one folder scan; this does the same across folders and loose files.
 *
 * A song keeps the id `taken` already has for its path, so ids (and the plays and playlists tied to
 * them) stay stable; any other song on a taken id gets a path-hash suffix.
 */
export const withUniqueIds = (songs: readonly Song[], taken: ReadonlyMap<string, string>): Song[] => {
  const owners = new Map<string, string>();
  for (const [id, path] of taken) {
    owners.set(id, pathKey(path));
  }
  return songs.map((song) => {
    const key = pathKey(song.path);
    const owner = owners.get(song.id);
    if (owner === undefined || owner === key) {
      owners.set(song.id, key);
      return song;
    }
    let id = `${song.id}_${pathHash(song.path)}`;
    for (let attempt = 2; owners.has(id) && owners.get(id) !== key; attempt += 1) {
      id = `${song.id}_${pathHash(song.path)}_${attempt}`;
    }
    owners.set(id, key);
    return { ...song, id };
  });
};
