import { PlaylistPickerModal } from '@/components/Player/PlaylistPickerModal';
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
  Icon,
  IconButton,
  Kicker,
  Select,
  Surface,
  TextInput,
} from "@/components/ui";
import type { Song } from "@/types/music";
import { formatDuration } from "@/utils/time";
import { artworkThumb } from "@/utils/artwork";
import { usePlayerStore } from "@/store/playerStore";
import { libraryActions, useLibraryStore } from "@/store/libraryStore";
import { useStructuralSongsSnapshot } from "@/hooks/useLibraryViews";
import { isUnknownGenre } from "@/services/songMetadataService";
import { useSongEditor } from "@/components/SongEditor/SongEditor";
import { useT, type MessageKey } from "@/i18n";
import { useLockedSongIds } from "@/hooks/useLibraryAccess";

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

const sortOptions: Array<{ labelKey: MessageKey; value: SongSort }> = [
  { labelKey: "common.songList.sortBy.recentlyAdded", value: "recently_added" },
  { labelKey: "common.songList.sortBy.titleAsc", value: "title_asc" },
  { labelKey: "common.songList.sortBy.titleDesc", value: "title_desc" },
  { labelKey: "common.songList.sortBy.artistAsc", value: "artist_asc" },
  { labelKey: "common.songList.sortBy.albumAsc", value: "album_asc" },
  { labelKey: "common.songList.sortBy.longestFirst", value: "duration_desc" },
  { labelKey: "common.songList.sortBy.mostPlayed", value: "most_played" },
];

/** Shared column template for the header row and every song row: # / title / album / genre / time / fav / playlist / queue. */
const ROW_GRID =
  "grid grid-cols-[40px_minmax(0,2.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(56px,0.5fr)_48px_112px] items-center";

/** Genre suggestions offered for untagged songs. These are written into the file's tags, so they stay in English. */
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
  /** Past the free library limit: listed, but playing one opens the Amply Pro offer. */
  lockedIds: ReadonlySet<string>;
  queueIds: string[];
  currentSongId: string | null;
  playSongById: (songId: string, fromQueue?: boolean) => Promise<void>;
  setQueue: (queue: string[], startId: string) => void;
  enqueueSong: (songId: string) => void;
  toggleFavorite: (songId: string) => Promise<void> | void;
  openPlaylistPicker: (songId: string) => void;
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
      lockedIds,
      queueIds,
      currentSongId,
      playSongById,
      setQueue,
      enqueueSong,
      toggleFavorite,
      openPlaylistPicker,
      updateSongGenre,
      genreOptions,
      genreListId,
      editingSongId,
      setEditingSongId,
    } = data;
    const { t } = useT();
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
    const isLocked = lockedIds.has(song.id);

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
          title={isLocked ? t("pro.library.lockedSong") : undefined}
          className={`${ROW_GRID} h-12 px-3 text-[13px] ${isCurrent ? "text-amply-textPrimary" : "text-amply-textSecondary"} ${isLocked ? "opacity-50" : ""}`}
        >
          <span className="text-center text-xs text-amply-textMuted">
            {index + 1}
          </span>

          <div className="flex min-w-0 items-center gap-3">
            <ArtworkImage
              src={artworkThumb(song.albumArt, 64)}
              alt={song.album}
              className="neu-well h-10 w-10 shrink-0 overflow-hidden rounded-sm"
              placeholderContent={null}
            />
            <div className="min-w-0">
              <p
                className={`flex items-center gap-1.5 truncate text-[18px] font-bold ${isCurrent ? "text-amply-accent" : "text-amply-textPrimary"}`}
              >
                {isLocked ? <Icon name="lock" size={12} className="shrink-0 text-amply-textMuted" /> : null}
                <span className="truncate">{song.title}</span>
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
                  placeholder={t("common.songList.setGenre")}
                />
              </div>
            ) : isUnknown ? (
              <div className="w-full" onClick={stopRowClick}>
                <Select
                  label={t("common.field.genre")}
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
                  <option value="">{t("common.songList.setGenre")}</option>
                  {genreOptions.map((genre) => (
                    <option key={genre} value={genre}>
                      {genre}
                    </option>
                  ))}
                  <option value="__edit__">{t("common.songList.customGenre")}</option>
                </Select>
              </div>
            ) : (
              <>
                <p className="flex-1 truncate text-[12px] text-amply-textMuted">
                  {song.genre}
                </p>
                <IconButton
                  name="edit"
                  label={t("common.songList.editGenre")}
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
            label={
              song.favorite
                ? t("common.songList.removeFromFavorites")
                : t("common.songList.addToFavorites")
            }
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

          <div className="flex items-center">
            <IconButton
              name="playlist-add"
              label={t("player.addToPlaylist")}
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                openPlaylistPicker(song.id);
              }}
            />
            <IconButton
              name="queue"
              label={t("common.songList.addToQueue")}
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                enqueueSong(song.id);
              }}
            />
            <IconButton
              name="more"
              label={t("common.songEditor.title")}
              size="sm"
              variant="ghost"
              onClick={(event) => {
                event.stopPropagation();
                useSongEditor.getState().open(song.id);
              }}
            />
          </div>
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
  const { t } = useT();
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const lockedIds = useLockedSongIds();
  const setQueue = usePlayerStore((state) => state.setQueue);
  const enqueueSong = usePlayerStore((state) => state.enqueueSong);
  const customPlaylists = useLibraryStore((state) => state.customPlaylists);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [pickerSongId, setPickerSongId] = useState<string | null>(null);
  const pickerSong = useLibraryStore((state) => (pickerSongId ? state.getSongById(pickerSongId) : undefined));
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
  // Genre suggestions only need the library's known genres, so they are keyed on the structural
  // snapshot (libraryVersion) rather than the per-play `songs` prop identity.
  const structuralSongs = useStructuralSongsSnapshot();
  const genreOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const genre of baseGenreOptions) {
      map.set(genre.toLowerCase(), genre);
    }
    for (const song of structuralSongs) {
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
  }, [structuralSongs]);
  const rowData = useMemo<SongRowData>(
    () => ({
      songs: sortedSongs,
      lockedIds,
      queueIds,
      currentSongId,
      playSongById,
      setQueue,
      enqueueSong,
      toggleFavorite: libraryActions.toggleFavorite,
      openPlaylistPicker: setPickerSongId,
      updateSongGenre: libraryActions.updateGenre,
      genreOptions,
      genreListId,
      editingSongId,
      setEditingSongId,
    }),
    [
      sortedSongs,
      lockedIds,
      queueIds,
      currentSongId,
      playSongById,
      setQueue,
      enqueueSong,
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
        <Kicker>{t("common.songList.songs")}</Kicker>
        {!hideSort ? (
          <Select
            label={t("common.songList.sortLabel")}
            size="sm"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as SongSort)}
            className="w-[220px]"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
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
        <span>{t("common.field.title")}</span>
        <span>{t("common.field.album")}</span>
        <span>{t("common.field.genre")}</span>
        <span className="justify-self-start">
          {t("common.songList.column.time")}
        </span>
        <span>{t("common.songList.column.fav")}</span>
        <span>{t("common.songList.column.queueInfo")}</span>
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
      <PlaylistPickerModal
        open={pickerSongId !== null}
        onClose={() => setPickerSongId(null)}
        song={pickerSong}
        playlists={customPlaylists}
        onAddToPlaylist={(playlistId, songId) => useLibraryStore.getState().addSongToCustomPlaylist(playlistId, songId)}
        onCreatePlaylist={(playlist) => useLibraryStore.getState().upsertCustomPlaylist(playlist)}
        onMessage={(message) => usePlayerStore.getState().showToast(message)}
      />
    </Card>
  );
};

export default SongList;
