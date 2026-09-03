import { memo, useEffect, useMemo, useRef, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import type { Song } from '@/types/music';
import { formatDuration } from '@/utils/time';
import { usePlayerStore } from '@/store/playerStore';
import { libraryActions, useLibraryStore } from '@/store/libraryStore';
import addIcon from '@/assets/icons/add.svg';
import queueIcon from '@/assets/icons/queue.svg';
import { isUnknownGenre } from '@/services/songMetadataService';

interface SongListProps {
  songs: Song[];
  persistKey?: string;
  initialSort?: SongSort;
  hideSort?: boolean;
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

const SortMenu = memo(({
  value,
  onChange,
}: {
  value: SongSort;
  onChange: (value: SongSort) => void;
}) => {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const selectedLabel = sortOptions.find((option) => option.value === value)?.label ?? 'Recently Added';

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePress);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex min-h-9 items-center gap-3 rounded-[14px] bg-[var(--control-surface)] px-3.5 text-left shadow-[inset_0_0_0_1px_var(--control-border)] transition-colors hover:bg-amply-hover"
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amply-textMuted">Sort</span>
        <span className="min-w-[110px] text-[12px] font-medium text-amply-textPrimary">{selectedLabel}</span>
        <svg viewBox="0 0 20 20" className={`h-4 w-4 text-amply-textMuted transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <path d="m6 8 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label="Sort songs"
          className="absolute right-0 top-full z-30 mt-2 w-[190px] rounded-[16px] border border-amply-border/60 bg-amply-bgPrimary p-1.5"
        >
          {sortOptions.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-[11px] px-3 py-2 text-left text-[12px] transition-colors ${selected ? 'bg-amply-accent/10 font-medium text-amply-textPrimary' : 'text-amply-textSecondary hover:bg-amply-hover hover:text-amply-textPrimary'}`}
              >
                <span>{option.label}</span>
                {selected ? <span className="h-1.5 w-1.5 rounded-full bg-amply-accent" aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});

const baseGenreOptions = [
  'Pop',
  'Rock',
  'Hip-Hop',
  'R&B',
  'Electronic',
  'Indie',
  'Country',
  'Jazz',
  'Classical',
  'Metal',
  'Folk',
  'Latin',
  'Reggae',
  'Blues',
  'Other',
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

interface SongRowData {
  songs: Song[];
  queueIds: string[];
  currentSongId: string | null;
  playSongById: (songId: string, fromQueue?: boolean) => Promise<void>;
  setQueue: (queue: string[], startId: string) => void;
  enqueueSong: (songId: string) => void;
  toggleFavorite: (songId: string) => Promise<void> | void;
  customPlaylists: Array<{ id: string; name: string }>;
  addSongToCustomPlaylist: (playlistId: string, songId: string) => Promise<void> | void;
  updateSongGenre: (songId: string, genre: string) => Promise<void> | void;
  genreOptions: string[];
  genreListId: string;
  editingSongId: string | null;
  setEditingSongId: (songId: string | null) => void;
}

const SongRow = memo(({ index, style, data }: ListChildComponentProps<SongRowData>) => {
  const {
    songs,
    queueIds,
    currentSongId,
    playSongById,
    setQueue,
    enqueueSong,
    toggleFavorite,
    customPlaylists,
    addSongToCustomPlaylist,
    updateSongGenre,
    genreOptions,
    genreListId,
    editingSongId,
    setEditingSongId,
  } = data;
  const song = songs[index];
  const isCurrent = song?.id === currentSongId;
  const [favoritePulse, setFavoritePulse] = useState(false);
  const pulseRef = useRef<number | null>(null);
  const [genreDraft, setGenreDraft] = useState('');
  const genreInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      if (pulseRef.current) {
        window.clearTimeout(pulseRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!song) {
      return;
    }
    const currentGenre = song.genre?.trim() ?? '';
    setGenreDraft(currentGenre);
  }, [song?.id, song?.genre]);

  useEffect(() => {
    if (editingSongId === song?.id) {
      genreInputRef.current?.focus();
      genreInputRef.current?.select();
    }
  }, [editingSongId, song?.id]);


  if (!song) {
    return null;
  }

  const isUnknown = isUnknownGenre(song.genre);
  const isEditing = editingSongId === song.id;

  return (
    <div style={style} className="px-3 py-1">
      <div
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
        className={`song-row-card grid h-12 grid-cols-[40px_minmax(0,2.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(56px,0.6fr)_48px_120px_56px] items-center rounded-2xl px-3 text-[13px] text-amply-textSecondary transition-all duration-150 ease-smooth ${
          isCurrent ? 'song-row-card--current text-amply-textPrimary' : ''
        }`}
      >
      <span className="text-center text-xs text-amply-textMuted">{index + 1}</span>

      <div className="flex min-w-0 items-center gap-3">
        <ArtworkImage
          src={song.albumArt}
          alt={song.album}
          className="h-10 w-10 shrink-0 overflow-hidden rounded-md bg-zinc-800"
          placeholderContent={null}
        />
        <div className="min-w-0">
          <p className={`truncate text-[18px] font-bold ${isCurrent ? 'text-amply-accent' : 'text-amply-textPrimary'}`}>
            {song.title}
          </p>
          <p className="truncate text-[14px] font-medium text-amply-textSecondary">{song.artist}</p>
        </div>
      </div>

      <p className="truncate text-[13px] text-amply-textSecondary">{song.album}</p>

      <div className="flex items-center justify-between gap-2 pr-2">
        {isEditing ? (
          <input
            ref={genreInputRef}
            list={genreListId}
            value={genreDraft}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setGenreDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.stopPropagation();
                const nextGenre = genreDraft.trim();
                if (nextGenre) {
                  void updateSongGenre(song.id, nextGenre);
                }
                if (editingSongId === song.id) {
                  setEditingSongId(null);
                }
              }
              if (event.key === 'Escape') {
                event.stopPropagation();
                setGenreDraft(song.genre?.trim() ?? '');
                if (editingSongId === song.id) {
                  setEditingSongId(null);
                }
              }
            }}
            onBlur={() => {
              const nextGenre = genreDraft.trim();
              if (nextGenre) {
                void updateSongGenre(song.id, nextGenre);
              }
              if (editingSongId === song.id) {
                setEditingSongId(null);
              }
            }}
            placeholder="Set genre..."
            className="w-full rounded-md border border-amply-border bg-amply-bgSecondary px-2 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          />
        ) : isUnknown ? (
          <select
            defaultValue=""
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              const nextGenre = event.target.value;
              if (!nextGenre) {
                return;
              }
              if (nextGenre === '__edit__') {
                setEditingSongId(song.id);
                event.currentTarget.value = '';
                return;
              }
              void updateSongGenre(song.id, nextGenre);
              event.currentTarget.value = '';
            }}
            className="h-7 w-full rounded-md border border-amply-border bg-amply-bgSecondary px-2 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover"
          >
            <option value="">Set genre...</option>
            {genreOptions.map((genre) => (
              <option key={genre} value={genre}>
                {genre}
              </option>
            ))}
            <option value="__edit__">Custom...</option>
          </select>
        ) : (
          <>
            <p className="flex-1 truncate text-[12px] text-amply-textMuted">{song.genre}</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setEditingSongId(song.id);
              }}
              className="rounded-full border border-amply-border/60 p-1 text-amply-textMuted transition-colors hover:bg-amply-hover hover:text-amply-textSecondary"
              title="Edit genre"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M12 20h9" strokeLinecap="round" />
                <path
                  d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        )}
      </div>

      <p className="justify-self-center text-[12px] text-amply-textMuted">{formatDuration(song.duration)}</p>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          const willFavorite = !song.favorite;
          void toggleFavorite(song.id);
          if (willFavorite) {
            setFavoritePulse(true);
            if (pulseRef.current) {
              window.clearTimeout(pulseRef.current);
            }
            pulseRef.current = window.setTimeout(() => {
              setFavoritePulse(false);
            }, 450);
          }
        }}
        className={`inline-flex items-center justify-center rounded-full p-2 transition-colors ${
          song.favorite
            ? 'text-amply-accent'
            : 'text-amply-textMuted hover:bg-amply-hover hover:text-amply-textSecondary'
        }`}
        title={song.favorite ? 'Remove from favorites' : 'Add to favorites'}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill={song.favorite ? 'currentColor' : 'none'}
          className={`h-4 w-4 ${favoritePulse ? 'favorite-pulse' : ''}`}
          aria-hidden="true"
        >
          <path
            d="M12 20.4L10.3 18.9C6.6 15.5 4.2 13.2 4.2 10.2C4.2 8.1 5.8 6.5 7.9 6.5C9.2 6.5 10.4 7.1 11.2 8.1C12 7.1 13.2 6.5 14.5 6.5C16.6 6.5 18.2 8.1 18.2 10.2C18.2 13.2 15.8 15.5 12.1 18.9L12 19L12 20.4Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <div className="flex items-center gap-2">
        <img src={addIcon} alt="" className="ui-icon ui-icon--muted h-4 w-4" />
        <select
          defaultValue=""
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            event.stopPropagation();
            const playlistId = event.target.value;
            if (!playlistId) {
              return;
            }
            void addSongToCustomPlaylist(playlistId, song.id);
            event.currentTarget.value = '';
          }}
          disabled={!customPlaylists.length}
          className="w-full rounded-md border border-amply-border bg-amply-bgSecondary px-2 py-1 text-[12px] text-amply-textSecondary transition-colors hover:bg-amply-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">{customPlaylists.length ? 'Add to...' : 'No playlists'}</option>
          {customPlaylists.map((playlist) => (
            <option key={playlist.id} value={playlist.id}>
              {playlist.name}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          enqueueSong(song.id);
        }}
        className="inline-flex items-center justify-center rounded-full p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
        title="Add to queue"
      >
        <img src={queueIcon} alt="" className="ui-icon h-4 w-4" />
      </button>
      </div>
    </div>
  );
});

const SongList = ({ songs, persistKey, initialSort = 'recently_added', hideSort = false }: SongListProps) => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const enqueueSong = usePlayerStore((state) => state.enqueueSong);
  const customPlaylists = useLibraryStore((state) => state.customPlaylists);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const genreListId = useMemo(() => `amply-genre-options-${persistKey ?? 'library'}`, [persistKey]);
  const storageKey = !hideSort && persistKey ? `amply-songlist-sort:${persistKey}` : null;
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

  const sortedSongs = useMemo(() => {
    if (hideSort) {
      return songs;
    }
    return sortSongs(songs, sortBy);
  }, [songs, sortBy, hideSort]);
  const queueIds = useMemo(() => sortedSongs.map((song) => song.id), [sortedSongs]);
  const genreOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const genre of baseGenreOptions) {
      map.set(genre.toLowerCase(), genre);
    }
    for (const song of songs) {
      const genre = song.genre?.trim();
      if (!genre || isUnknownGenre(genre)) {
        continue;
      }
      const key = genre.toLowerCase();
      if (!map.has(key)) {
        map.set(key, genre);
      }
    }
    return [...map.values()].sort((a, b) => a.localeCompare(b));
  }, [songs]);
  const rowData = useMemo<SongRowData>(
    () => ({
      songs: sortedSongs,
      queueIds,
      currentSongId,
      playSongById,
      setQueue,
      enqueueSong,
      toggleFavorite: libraryActions.toggleFavorite,
      customPlaylists,
      addSongToCustomPlaylist: libraryActions.addSongToCustomPlaylist,
      updateSongGenre: libraryActions.updateGenre,
      genreOptions,
      genreListId,
      editingSongId,
      setEditingSongId,
    }),
    [
      sortedSongs,
      queueIds,
      currentSongId,
      playSongById,
      setQueue,
      enqueueSong,
      customPlaylists,
      genreOptions,
      genreListId,
      editingSongId,
      setEditingSongId,
    ],
  );

  return (
    <div className="ui-soft-card render-contained overflow-hidden rounded-[30px]">
      <div className="flex items-center justify-between border-b border-amply-border px-4 py-3">
        <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Songs</p>
        {!hideSort ? <SortMenu value={sortBy} onChange={setSortBy} /> : null}
      </div>

      <div className="grid h-12 grid-cols-[40px_minmax(0,2.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_minmax(56px,0.6fr)_48px_120px_56px] items-center border-b border-amply-border px-4 text-[12px] uppercase tracking-wide text-amply-textMuted">
        <span>#</span>
        <span>Title</span>
        <span>Album</span>
        <span>Genre</span>
        <span className="justify-self-start">Time</span>
        <span>Fav</span>
        <span>Playlist</span>
        <span>Queue</span>
      </div>

      <datalist id={genreListId}>
        {genreOptions.map((genre) => (
          <option key={genre} value={genre} />
        ))}
      </datalist>

      <div className="render-contained h-[62vh]">
        <AutoSizer>
          {({ height, width }) => (
            <List
              height={height}
              width={width}
              itemCount={sortedSongs.length}
              itemSize={60}
              itemData={rowData}
              itemKey={(index, data) => data.songs[index]?.id ?? index}
              overscanCount={8}
            >
              {SongRow}
            </List>
          )}
        </AutoSizer>
      </div>
    </div>
  );
};

export default SongList;
