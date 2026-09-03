import { usePersistedPreference } from "@/hooks/usePersistedPreference";
import { oneOf } from "@/services/preferences";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import AutoSizer from "react-virtualized-auto-sizer";
import {
  FixedSizeList as List,
  type ListChildComponentProps,
} from "react-window";
import { ArtworkImage } from "@/components/ArtworkImage/ArtworkImage";
import {
  Card,
  Divider,
  IconButton,
  Kicker,
  Select,
  Surface,
  TextInput,
} from "@/components/ui";
import type { Song } from "@/types/music";
import { formatDuration } from "@/utils/time";
import { usePlayerStore } from "@/store/playerStore";
import { libraryActions, useLibraryStore } from "@/store/libraryStore";
import { isUnknownGenre } from "@/services/songMetadataService";

interface SongListProps {
  songs: Song[];
  persistKey?: string;
  initialSort?: SongSort;
  hideSort?: boolean;
}

type SongSort =
  | "recently_added"
  | "title_asc"
  | "title_desc"
  | "artist_asc"
  | "album_asc"
  | "duration_desc"
  | "most_played";

const isSongSort = oneOf<SongSort>([
  "recently_added",
  "title_asc",
  "title_desc",
  "artist_asc",
  "album_asc",
  "duration_desc",
  "most_played",
]);

const sortOptions: Array<{ label: string; value: SongSort }> = [
  { label: "Recently Added", value: "recently_added" },
  { label: "Title (A-Z)", value: "title_asc" },
  { label: "Title (Z-A)", value: "title_desc" },
  { label: "Artist (A-Z)", value: "artist_asc" },
  { label: "Album (A-Z)", value: "album_asc" },
  { label: "Longest First", value: "duration_desc" },
  { label: "Most Played", value: "most_played" },
];

/** Shared column template for the header row and every song row: # / title / album / genre / time / fav / playlist / queue. */
const ROW_GRID =
  "grid grid-cols-[40px_minmax(0,2.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(56px,0.5fr)_48px_150px_48px] items-center";

const baseGenreOptions = [
  "Pop",
  "Rock",
  "Hip-Hop",
  "R&B",
  "Electronic",
  "Indie",
  "Country",
  "Jazz",
  "Classical",
  "Metal",
  "Folk",
  "Latin",
  "Reggae",
  "Blues",
  "Other",
];

const sortSongs = (items: Song[], sortBy: SongSort): Song[] => {
  const sorted = [...items];

  switch (sortBy) {
    case "title_asc":
      return sorted.sort((a, b) => a.title.localeCompare(b.title));
    case "title_desc":
      return sorted.sort((a, b) => b.title.localeCompare(a.title));
    case "artist_asc":
      return sorted.sort(
        (a, b) =>
          a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
      );
    case "album_asc":
      return sorted.sort(
        (a, b) =>
          a.album.localeCompare(b.album) || a.title.localeCompare(b.title),
      );
    case "duration_desc":
      return sorted.sort(
        (a, b) => b.duration - a.duration || a.title.localeCompare(b.title),
      );
    case "most_played":
      return sorted.sort(
        (a, b) =>
          b.playCount - a.playCount ||
          (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0),
      );
    case "recently_added":
    default:
      return sorted.sort(
        (a, b) => b.addedAt - a.addedAt || a.title.localeCompare(b.title),
      );
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
  addSongToCustomPlaylist: (
    playlistId: string,
    songId: string,
  ) => Promise<void> | void;
  updateSongGenre: (songId: string, genre: string) => Promise<void> | void;
  genreOptions: string[];
  genreListId: string;
  editingSongId: string | null;
  setEditingSongId: (songId: string | null) => void;
}

/** Inputs inside a row live in a clickable row; keep their (and their label's) clicks from starting playback. */
const stopRowClick = (event: React.MouseEvent) => event.stopPropagation();

const SongRow = memo(
  ({ index, style, data }: ListChildComponentProps<SongRowData>) => {
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
    const [genreDraft, setGenreDraft] = useState("");
    const genreInputRef = useRef<HTMLInputElement | null>(null);

    useEffect(() => {
      return () => {
        if (pulseRef.current) {
          window.clearTimeout(pulseRef.current);
        }
      };
    }, []);

    const songId = song?.id;
    const songGenre = song?.genre?.trim() ?? "";

    useEffect(() => {
      if (!songId) {
        return;
      }
      setGenreDraft(songGenre);
    }, [songId, songGenre]);

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

    const commitGenreDraft = () => {
      const nextGenre = genreDraft.trim();
      if (nextGenre) {
        void updateSongGenre(song.id, nextGenre);
      }
      if (editingSongId === song.id) {
        setEditingSongId(null);
      }
    };

    return (
      <div style={style} className="px-3 py-1">
        <Surface
          variant="flat"
          radius="md"
          interactive
          active={isCurrent}
          role="button"
          tabIndex={0}
          onClick={() => {
            setQueue(queueIds, song.id);
            void playSongById(song.id, false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setQueue(queueIds, song.id);
              void playSongById(song.id, false);
            }
          }}
          className={`${ROW_GRID} h-12 px-3 text-[13px] ${isCurrent ? "text-amply-textPrimary" : "text-amply-textSecondary"}`}
        >
          <span className="text-center text-xs text-amply-textMuted">
            {index + 1}
          </span>

          <div className="flex min-w-0 items-center gap-3">
            <ArtworkImage
              src={song.albumArt}
              alt={song.album}
              className="neu-well h-10 w-10 shrink-0 overflow-hidden rounded-sm"
              placeholderContent={null}
            />
            <div className="min-w-0">
              <p
                className={`truncate text-[18px] font-bold ${isCurrent ? "text-amply-accent" : "text-amply-textPrimary"}`}
              >
                {song.title}
              </p>
              <p className="truncate text-[14px] font-medium text-amply-textSecondary">
                {song.artist}
              </p>
            </div>
          </div>

          <p className="truncate text-[13px] text-amply-textSecondary">
            {song.album}
          </p>

          <div className="flex items-center justify-between gap-2 pr-2">
            {isEditing ? (
              <div className="w-full" onClick={stopRowClick}>
                <TextInput
                  ref={genreInputRef}
                  size="sm"
                  list={genreListId}
                  value={genreDraft}
                  onValueChange={setGenreDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.stopPropagation();
                      commitGenreDraft();
                    }
                    if (event.key === "Escape") {
                      event.stopPropagation();
                      setGenreDraft(song.genre?.trim() ?? "");
                      if (editingSongId === song.id) {
                        setEditingSongId(null);
                      }
                    }
                  }}
                  onBlur={commitGenreDraft}
                  placeholder="Set genre..."
                />
              </div>
            ) : isUnknown ? (
              <div className="w-full" onClick={stopRowClick}>
                <Select
                  label="Genre"
                  size="sm"
                  defaultValue=""
                  onChange={(event) => {
                    event.stopPropagation();
                    const nextGenre = event.target.value;
                    if (!nextGenre) {
                      return;
                    }
                    if (nextGenre === "__edit__") {
                      setEditingSongId(song.id);
                      event.currentTarget.value = "";
                      return;
                    }
                    void updateSongGenre(song.id, nextGenre);
                    event.currentTarget.value = "";
                  }}
                  className="w-full"
                >
                  <option value="">Set genre...</option>
                  {genreOptions.map((genre) => (
                    <option key={genre} value={genre}>
                      {genre}
                    </option>
                  ))}
                  <option value="__edit__">Custom...</option>
                </Select>
              </div>
            ) : (
              <>
                <p className="flex-1 truncate text-[12px] text-amply-textMuted">
                  {song.genre}
                </p>
                <IconButton
                  name="edit"
                  label="Edit genre"
                  size="xs"
                  variant="ghost"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditingSongId(song.id);
                  }}
                />
              </>
            )}
          </div>

          <p className="justify-self-center text-[12px] text-amply-textMuted">
            {formatDuration(song.duration)}
          </p>

          <IconButton
            name={song.favorite ? "heart-filled" : "heart"}
            label={song.favorite ? "Remove from favorites" : "Add to favorites"}
            size="sm"
            variant="ghost"
            accentIcon={song.favorite}
            className={favoritePulse ? "favorite-pulse" : undefined}
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
          />

          <div className="mr-2 min-w-0" onClick={stopRowClick}>
            <Select
              label="Add"
              size="sm"
              defaultValue=""
              onChange={(event) => {
                event.stopPropagation();
                const playlistId = event.target.value;
                if (!playlistId) {
                  return;
                }
                void addSongToCustomPlaylist(playlistId, song.id);
                event.currentTarget.value = "";
              }}
              disabled={!customPlaylists.length}
              selectClassName="disabled:cursor-not-allowed disabled:opacity-60"
            >
              <option value="">
                {customPlaylists.length ? "Add to..." : "No playlists"}
              </option>
              {customPlaylists.map((playlist) => (
                <option key={playlist.id} value={playlist.id}>
                  {playlist.name}
                </option>
              ))}
            </Select>
          </div>

          <IconButton
            name="queue"
            label="Add to queue"
            size="sm"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              enqueueSong(song.id);
            }}
          />
        </Surface>
      </div>
    );
  },
);

const SongList = ({
  songs,
  persistKey,
  initialSort = "recently_added",
  hideSort = false,
}: SongListProps) => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const enqueueSong = usePlayerStore((state) => state.enqueueSong);
  const customPlaylists = useLibraryStore((state) => state.customPlaylists);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const genreListId = useMemo(
    () => `amply-genre-options-${persistKey ?? "library"}`,
    [persistKey],
  );
  const persistSort = !hideSort && Boolean(persistKey);
  const [persistedSort, setPersistedSort] = usePersistedPreference<SongSort>(
    `songlist-sort:${persistKey ?? "default"}`,
    isSongSort,
    initialSort,
  );
  const [localSort, setLocalSort] = useState<SongSort>(initialSort);
  const sortBy = persistSort ? persistedSort : localSort;
  const setSortBy = persistSort ? setPersistedSort : setLocalSort;

  const sortedSongs = useMemo(() => {
    if (hideSort) {
      return songs;
    }
    return sortSongs(songs, sortBy);
  }, [songs, sortBy, hideSort]);
  const queueIds = useMemo(
    () => sortedSongs.map((song) => song.id),
    [sortedSongs],
  );
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
    <Card
      padding="none"
      radius="lg"
      className="render-contained overflow-hidden"
    >
      <div className="flex items-center justify-between px-4 py-3">
        <Kicker>Songs</Kicker>
        {!hideSort ? (
          <Select
            label="Sort"
            size="sm"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SongSort)}
            className="w-[220px]"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <Divider />

      <div
        className={`${ROW_GRID} h-12 px-4 text-[12px] uppercase tracking-wide text-amply-textMuted`}
      >
        <span>#</span>
        <span>Title</span>
        <span>Album</span>
        <span>Genre</span>
        <span className="justify-self-start">Time</span>
        <span>Fav</span>
        <span>Playlist</span>
        <span>Queue</span>
      </div>
      <Divider />

      <datalist id={genreListId}>
        {genreOptions.map((genre) => (
          <option key={genre} value={genre} />
        ))}
      </datalist>

      <div className="anim-rise render-contained h-[62vh]">
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
    </Card>
  );
};

export default SongList;
