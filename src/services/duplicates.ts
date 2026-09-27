import type { Song } from '@/types/music';
import { getDisplayTitleRepair, getPrimaryArtistName, normalizeArtistLookupText } from '@/utils/artists';

/** Two copies of one recording differ by encoder padding, never by more than this. */
const DURATION_TOLERANCE_SEC = 2;

export interface DuplicateGroup {
  key: string;
  title: string;
  artist: string;
  /** Best copy first: most played, then favourite, then largest file (usually the best encode). */
  songs: Song[];
}

const rank = (a: Song, b: Song) =>
  (b.playCount ?? 0) - (a.playCount ?? 0) ||
  Number(b.favorite) - Number(a.favorite) ||
  (b.size ?? 0) - (a.size ?? 0) ||
  a.path.localeCompare(b.path);

/**
 * Songs that are the same recording stored more than once: same title (upload junk such as
 * "(Official Audio)" ignored, but versions like "(Live)" or "- Remix" kept apart), same primary
 * artist, and lengths within two seconds. "X.mp3" and "X (1).mp3" land here; a live cut does not.
 */
export const findDuplicateGroups = (songs: readonly Song[]): DuplicateGroup[] => {
  const byName = new Map<string, Song[]>();
  for (const song of songs) {
    const title = normalizeArtistLookupText(getDisplayTitleRepair(song.artist, song.title) ?? song.title);
    const artist = normalizeArtistLookupText(getPrimaryArtistName(song.artist));
    if (!title || !song.duration) {
      continue;
    }
    const key = `${artist}|${title}`;
    byName.set(key, [...(byName.get(key) ?? []), song]);
  }

  const groups: DuplicateGroup[] = [];
  for (const [key, candidates] of byName) {
    if (candidates.length < 2) {
      continue;
    }
    // Cluster by length so two different recordings sharing a title stay apart.
    const sorted = [...candidates].sort((a, b) => a.duration - b.duration);
    let cluster: Song[] = [sorted[0]];
    const flush = () => {
      if (cluster.length > 1) {
        const songsInGroup = [...cluster].sort(rank);
        groups.push({ key: `${key}|${Math.round(cluster[0].duration)}`, title: songsInGroup[0].title, artist: songsInGroup[0].artist, songs: songsInGroup });
      }
    };
    for (const song of sorted.slice(1)) {
      if (song.duration - cluster[cluster.length - 1].duration <= DURATION_TOLERANCE_SEC) {
        cluster.push(song);
      } else {
        flush();
        cluster = [song];
      }
    }
    flush();
  }
  return groups.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
};
