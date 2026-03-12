import { useEffect, useMemo, useState } from 'react';
import type { Song } from '@/types/music';
import { formatDuration } from '@/utils/time';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryStore } from '@/store/libraryStore';

interface SongListProps {
  songs: Song[];
  persistKey?: string;
  initialSort?: SongSort;
}

type SongSort =
  | 'recently_added'
  | 'title_asc'
  | 'title_desc'
  | 'artist_asc'
  | 'album_asc'
  | 'duration_desc'
  | 'most_played';

const sortOptions: Array<{ label: string; value: SongSort }> = [
  { label: 'Recently Added', value: 'recently_added' },
  { label: 'Title (A-Z)', value: 'title_asc' },
  { label: 'Title (Z-A)', value: 'title_desc' },
  { label: 'Artist (A-Z)', value: 'artist_asc' },
  { label: 'Album (A-Z)', value: 'album_asc' },
  { label: 'Longest First', value: 'duration_desc' },
  { label: 'Most Played', value: 'most_played' },
];

const sortSongs = (items: Song[], sortBy: SongSort): Song[] => {
  const sorted = [...items];

  switch (sortBy) {
    case 'title_asc':
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case 'title_desc':
      return sorted.sort((a, b) => b.title.localeCompare(a.title));
    case 'artist_asc':
      return sorted.sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
    case 'album_asc':
      return sorted.sort((a, b) => a.album.localeCompare(b.album) || a.title.localeCompare(b.title));
    case 'duration_desc':
      return sorted.sort((a, b) => b.duration - a.duration || a.title.localeCompare(b.title));
    case 'most_played':
      return sorted.sort((a, b) => b.playCount - a.playCount || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
    case 'recently_added':
    default:
      return sorted.sort((a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title));
  }
};

const SongList = ({ songs, persistKey, initialSort = 'recently_added' }: SongListProps) => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const enqueueSong = usePlayerStore((state) => state.enqueueSong);
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const storageKey = persistKey ? `amply-songlist-sort:${persistKey}` : null;
  const [sortBy, setSortBy] = useState<SongSort>(() => {
    if (!storageKey || typeof window === 'undefined') {
      return initialSort;
    }

    const stored = window.localStorage.getItem(storageKey) as SongSort | null;
    return stored ?? initialSort;
  });

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(storageKey, sortBy);
  }, [storageKey, sortBy]);

  const sortedSongs = useMemo(() => sortSongs(songs, sortBy), [songs, sortBy]);
  const queueIds = useMemo(() => sortedSongs.map((song) => song.id), [sortedSongs]);

  return (
    <div className="overflow-hidden rounded-card border border-amply-border bg-amply-card">
      <div className="flex items-center justify-between border-b border-amply-border px-4 py-3">
        <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Songs</p>
        <label className="flex items-center gap-2 text-[12px] text-amply-textSecondary">
          Sort
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SongSort)}
            className="rounded-md border border-amply-border bg-amply-bgSecondary px-2 py-1 text-[12px] text-amply-textPrimary outline-none focus:border-amply-accent"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid h-12 grid-cols-[48px_1.8fr_1fr_90px_64px_64px] items-center border-b border-amply-border px-4 text-[12px] uppercase tracking-wide text-amply-textMuted">
        <span>#</span>
        <span>Title</span>
        <span>Album</span>
        <span>Time</span>
        <span>Fav</span>
        <span>Queue</span>
      </div>

      <div className="max-h-[62vh] overflow-y-auto">
        {sortedSongs.map((song, index) => {
          const isCurrent = song.id === currentSongId;

          return (
            <div
              key={song.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                setQueue(queueIds, song.id);
                void playSongById(song.id, false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  setQueue(queueIds, song.id);
                  void playSongById(song.id, false);
                }
              }}
              className="grid h-14 grid-cols-[48px_1.8fr_1fr_90px_64px_64px] items-center px-4 text-[13px] text-amply-textSecondary transition-colors hover:bg-[#1A1A1A]"
            >
              <span className="text-center text-xs text-amply-textMuted">{index + 1}</span>

              <div className="flex min-w-0 items-center gap-3">
                <div className="h-10 w-10 overflow-hidden rounded-md bg-zinc-800">
                  {song.albumArt ? (
                    <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" loading="lazy" />
                  ) : null}
                </div>
                <div className="min-w-0">
                  <p className={`truncate text-[18px] font-bold ${isCurrent ? 'text-amply-accent' : 'text-amply-textPrimary'}`}>
                    {song.title}
                  </p>
                  <p className="truncate text-[14px] font-medium text-amply-textSecondary">{song.artist}</p>
                </div>
              </div>

              <p className="truncate text-[13px] text-amply-textSecondary">{song.album}</p>
              <p className="text-[12px] text-amply-textMuted">{formatDuration(song.duration)}</p>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleFavorite(song.id);
                }}
                className={`rounded-md border border-amply-border px-2 py-1 text-[11px] transition-colors ${song.favorite ? 'border-amply-accent text-amply-accent' : 'text-amply-textMuted hover:bg-amply-hover hover:text-amply-textSecondary'}`}
              >
                {song.favorite ? 'Fav' : 'Mark'}
              </button>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  enqueueSong(song.id);
                }}
                className="rounded-md border border-amply-border px-2 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
              >
                +
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SongList;
