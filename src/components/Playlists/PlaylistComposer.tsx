import { memo, useCallback, useDeferredValue, useMemo, useState } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { PillButton, SegmentedTabs, UnifiedSearchInput } from '@/components/ui/AmplyUI';
import { recordBudgetLatency } from '@/services/perfDiagnostics';
import type { Playlist, Song } from '@/types/music';
import { filterPlaylistSongs, indexPlaylistSongs, type PlaylistComposerFilter } from './playlistComposerModel';

type ComposerFilter = PlaylistComposerFilter;

interface PlaylistComposerProps {
  songs: Song[];
  initialPlaylist?: Playlist | null;
  onSave: (playlist: Playlist) => void | Promise<void>;
  onCancel: () => void;
}

const resizeCover = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file.');
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error('Cover images must be smaller than 8 MB.');
  }

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = sourceUrl;
    await image.decode();
    const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
    const outputSize = Math.min(1024, sourceSize);
    const canvas = document.createElement('canvas');
    canvas.width = outputSize;
    canvas.height = outputSize;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Cover processing is unavailable.');
    }
    const sourceX = (image.naturalWidth - sourceSize) / 2;
    const sourceY = (image.naturalHeight - sourceSize) / 2;
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, outputSize, outputSize);
    return canvas.toDataURL('image/webp', 0.86);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};

interface PlaylistSongRowData {
  songs: Song[];
  selectedSongIds: Set<string>;
  togglePlaylistSong: (songId: string) => void;
}

const PlaylistSongRow = memo(({ index, style, data }: ListChildComponentProps<PlaylistSongRowData>) => {
  const song = data.songs[index];
  if (!song) {
    return null;
  }
  const selected = data.selectedSongIds.has(song.id);

  return (
    <div style={style} className="px-1 py-1">
      <div className="flex h-full min-w-0 items-center gap-3 rounded-[14px] px-3 text-[12px] transition-colors hover:bg-amply-hover">
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-[10px] bg-amply-bgSecondary">
          {song.albumArt ? <ArtworkImage src={song.albumArt} alt="" className="h-full w-full object-cover" pulse={false} /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-amply-textPrimary">{song.title}</p>
          <p className="truncate text-[11px] text-amply-textMuted">{song.artist} · {song.album}</p>
        </div>
        <button
          type="button"
          onClick={() => data.togglePlaylistSong(song.id)}
          aria-pressed={selected}
          className={`min-w-[66px] rounded-[12px] border px-3 py-1.5 text-[11px] font-medium transition-colors ${
            selected
              ? 'border-amply-accent/50 bg-amply-accent/10 text-amply-accent'
              : 'border-amply-border/60 text-amply-textSecondary hover:bg-amply-hover'
          }`}
        >
          {selected ? 'Added' : 'Add'}
        </button>
      </div>
    </div>
  );
});

const SortableSong = ({
  song,
  position,
  count,
  onRemove,
  onMove,
}: {
  song: Song;
  position: number;
  count: number;
  onRemove: (songId: string) => void;
  onMove: (position: number, direction: -1 | 1) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-[14px] border border-amply-border/45 bg-amply-surface/55 px-2 py-2 ${isDragging ? 'z-10 shadow-lift' : ''}`}
    >
      <button
        type="button"
        className="cursor-grab rounded-[10px] px-2 py-2 text-[14px] text-amply-textMuted active:cursor-grabbing"
        aria-label={`Drag ${song.title}`}
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-amply-textPrimary">{song.title}</p>
        <p className="truncate text-[10px] text-amply-textMuted">{song.artist}</p>
      </div>
      <div className="flex items-center gap-1">
        <button type="button" disabled={position === 0} onClick={() => onMove(position, -1)} className="h-7 w-7 rounded-lg text-amply-textMuted hover:bg-amply-hover disabled:opacity-25" aria-label={`Move ${song.title} up`}>↑</button>
        <button type="button" disabled={position === count - 1} onClick={() => onMove(position, 1)} className="h-7 w-7 rounded-lg text-amply-textMuted hover:bg-amply-hover disabled:opacity-25" aria-label={`Move ${song.title} down`}>↓</button>
        <button type="button" onClick={() => onRemove(song.id)} className="h-7 rounded-lg px-2 text-[10px] text-amply-textMuted hover:bg-amply-hover hover:text-amply-textPrimary">Remove</button>
      </div>
    </div>
  );
};

interface SelectedSongRowData {
  songs: Song[];
  onRemove: (songId: string) => void;
  onMove: (position: number, direction: -1 | 1) => void;
}

const SelectedSongRow = memo(({ index, style, data }: ListChildComponentProps<SelectedSongRowData>) => {
  const song = data.songs[index];
  if (!song) return null;
  return (
    <div style={style} className="py-1 pr-1">
      <SortableSong song={song} position={index} count={data.songs.length} onRemove={data.onRemove} onMove={data.onMove} />
    </div>
  );
});

const PlaylistComposer = ({ songs, initialPlaylist, onSave, onCancel }: PlaylistComposerProps) => {
  const [playlistName, setPlaylistName] = useState(initialPlaylist?.name ?? '');
  const [playlistDescription, setPlaylistDescription] = useState(initialPlaylist?.description ?? '');
  const [playlistArtwork, setPlaylistArtwork] = useState<string | undefined>(initialPlaylist?.artwork);
  const [playlistSongQuery, setPlaylistSongQuery] = useState('');
  const deferredQuery = useDeferredValue(playlistSongQuery);
  const [filterTab, setFilterTab] = useState<ComposerFilter>('all');
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>(initialPlaylist?.songIds ?? []);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const indexedSongs = useMemo(() => indexPlaylistSongs(songs), [songs]);
  const songById = useMemo(() => new Map(songs.map((song) => [song.id, song])), [songs]);
  const selectedSet = useMemo(() => new Set(selectedSongIds), [selectedSongIds]);

  const composerSongs = useMemo(() => {
    const startedAt = performance.now();
    const filtered = filterPlaylistSongs(indexedSongs, deferredQuery, filterTab);
    recordBudgetLatency('playlist-search', performance.now() - startedAt, 100);
    return filtered;
  }, [deferredQuery, filterTab, indexedSongs]);

  const selectedSongs = useMemo(
    () => selectedSongIds.map((id) => songById.get(id)).filter((song): song is Song => Boolean(song)),
    [selectedSongIds, songById],
  );
  const collageArtwork = useMemo(
    () => Array.from(new Set(selectedSongs.map((song) => song.albumArt).filter((art): art is string => Boolean(art)))).slice(0, 4),
    [selectedSongs],
  );

  const togglePlaylistSong = useCallback((songId: string) => {
    const startedAt = performance.now();
    setSelectedSongIds((current) => current.includes(songId) ? current.filter((id) => id !== songId) : [...current, songId]);
    recordBudgetLatency('playlist-selection', performance.now() - startedAt, 100);
  }, []);

  const moveSong = useCallback((position: number, direction: -1 | 1) => {
    setSelectedSongIds((current) => arrayMove(current, position, position + direction));
  }, []);

  const handleDragEnd = useCallback(({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const startedAt = performance.now();
    setSelectedSongIds((current) => {
      const from = current.indexOf(String(active.id));
      const to = current.indexOf(String(over.id));
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
    recordBudgetLatency('playlist-reorder', performance.now() - startedAt, 100);
  }, []);

  const rowData = useMemo<PlaylistSongRowData>(() => ({
    songs: composerSongs,
    selectedSongIds: selectedSet,
    togglePlaylistSong,
  }), [composerSongs, selectedSet, togglePlaylistSong]);
  const selectedRowData = useMemo<SelectedSongRowData>(() => ({
    songs: selectedSongs,
    onRemove: togglePlaylistSong,
    onMove: moveSong,
  }), [moveSong, selectedSongs, togglePlaylistSong]);

  const savePlaylist = async () => {
    const name = playlistName.trim();
    if (!name) {
      setPlaylistError('Playlist name is required.');
      return;
    }
    setSaving(true);
    setPlaylistError(null);
    const startedAt = performance.now();
    try {
      await onSave({
        id: initialPlaylist?.id ?? `custom_${Date.now()}`,
        name,
        type: 'custom',
        description: playlistDescription.trim() || 'Custom playlist',
        artwork: playlistArtwork,
        songIds: selectedSongIds,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      recordBudgetLatency('playlist-save', performance.now() - startedAt, 300);
    } catch {
      setPlaylistError('Amply could not save this playlist. Try again.');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="rounded-[20px] border border-amply-border/45 bg-amply-bgSecondary/55 p-4">
            <p className="amply-kicker">Playlist details</p>
            <div className="mt-4 flex items-start gap-4">
              <div className="grid h-24 w-24 shrink-0 grid-cols-2 overflow-hidden rounded-[16px] bg-[#191817] shadow-card">
                {playlistArtwork ? (
                  <ArtworkImage src={playlistArtwork} alt="Playlist cover" className="col-span-2 row-span-2 h-full w-full object-cover" />
                ) : collageArtwork.length ? (
                  [0, 1, 2, 3].map((slot) => {
                    const artwork = collageArtwork[slot] ?? collageArtwork[0];
                    return artwork ? <ArtworkImage key={`${artwork}-${slot}`} src={artwork} alt="" className="h-full w-full object-cover" pulse={false} /> : null;
                  })
                ) : (
                  <div className="col-span-2 row-span-2 flex items-center justify-center text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">Amply</div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[11px] text-amply-textMuted">Name</span>
                  <input autoFocus value={playlistName} onChange={(event) => setPlaylistName(event.target.value)} placeholder="Playlist name" className="w-full rounded-[12px] border border-amply-border/50 bg-amply-bgPrimary/70 px-3 py-2 text-[13px] text-amply-textPrimary outline-none" />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-[11px] text-amply-textMuted">Description</span>
                  <input value={playlistDescription} onChange={(event) => setPlaylistDescription(event.target.value)} placeholder="Optional note" className="w-full rounded-[12px] border border-amply-border/50 bg-amply-bgPrimary/70 px-3 py-2 text-[13px] text-amply-textPrimary outline-none" />
                </label>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <label className="cursor-pointer rounded-[12px] border border-amply-border/55 px-3 py-2 text-[11px] font-medium text-amply-textSecondary hover:bg-amply-hover">
                {playlistArtwork ? 'Change cover' : 'Choose cover'}
                <input type="file" accept="image/*" className="hidden" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void resizeCover(file).then((dataUrl) => {
                    setPlaylistArtwork(dataUrl);
                    setPlaylistError(null);
                  }).catch((error: Error) => setPlaylistError(error.message));
                }} />
              </label>
              {playlistArtwork ? <button type="button" onClick={() => setPlaylistArtwork(undefined)} className="text-[11px] text-amply-textMuted hover:text-amply-textPrimary">Use auto collage</button> : null}
            </div>
          </section>

          <section className="rounded-[20px] border border-amply-border/45 bg-amply-bgSecondary/55 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="amply-kicker">Track order</p>
                <p className="mt-1 text-[11px] text-amply-textMuted">{selectedSongIds.length} selected</p>
              </div>
              <button type="button" onClick={() => setSelectedSongIds([])} disabled={!selectedSongIds.length} className="text-[11px] text-amply-textMuted hover:text-amply-textPrimary disabled:opacity-30">Clear</button>
            </div>
            <div className="mt-3 h-[330px] overflow-hidden">
              {selectedSongs.length ? (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={selectedSongIds} strategy={verticalListSortingStrategy}>
                    <AutoSizer>
                      {({ height, width }) => <List height={height} width={width} itemCount={selectedSongs.length} itemSize={64} itemData={selectedRowData} overscanCount={6}>{SelectedSongRow}</List>}
                    </AutoSizer>
                  </SortableContext>
                </DndContext>
              ) : <div className="flex h-full items-center justify-center rounded-[14px] border border-dashed border-amply-border/55 px-4 text-center text-[12px] text-amply-textMuted">Add tracks from your library. Empty playlists can be saved.</div>}
            </div>
          </section>
        </div>

        <section className="min-w-0 rounded-[20px] border border-amply-border/45 bg-amply-bgSecondary/55 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-semibold text-amply-textPrimary">Choose tracks</p>
              <p className="mt-0.5 text-[11px] text-amply-textMuted">{composerSongs.length.toLocaleString()} matching tracks</p>
            </div>
            <UnifiedSearchInput value={playlistSongQuery} onValueChange={setPlaylistSongQuery} placeholder="Title, artist, or album" className="w-full max-w-xs" />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <SegmentedTabs tabs={[
              { value: 'all', label: 'All' },
              { value: 'favorites', label: 'Favorites' },
              { value: 'recent', label: 'Recent' },
              { value: 'most_played', label: 'Most played' },
            ]} value={filterTab} onChange={setFilterTab} />
            <div className="flex gap-3 text-[11px]">
              <button type="button" onClick={() => setSelectedSongIds((current) => Array.from(new Set([...current, ...composerSongs.map((song) => song.id)])))} className="text-amply-textSecondary hover:text-amply-textPrimary">Add results</button>
              <button type="button" onClick={() => {
                const visible = new Set(composerSongs.map((song) => song.id));
                setSelectedSongIds((current) => current.filter((id) => !visible.has(id)));
              }} className="text-amply-textMuted hover:text-amply-textPrimary">Remove results</button>
            </div>
          </div>
          <div className="mt-4 h-[520px] overflow-hidden rounded-[16px] border border-amply-border/40 bg-amply-bgPrimary/40 p-1">
            <AutoSizer>
              {({ height, width }) => <List height={height} width={width} itemCount={composerSongs.length} itemSize={58} itemData={rowData} overscanCount={8}>{PlaylistSongRow}</List>}
            </AutoSizer>
          </div>
        </section>
      </div>

      {playlistError ? <p role="alert" className="text-[12px] text-red-400">{playlistError}</p> : null}
      <div className="flex justify-end gap-2 border-t border-[var(--divider-soft)] pt-4">
        <PillButton type="button" onClick={onCancel}>Cancel</PillButton>
        <PillButton type="button" variant="primary" disabled={saving} onClick={() => void savePlaylist()}>{saving ? 'Saving…' : initialPlaylist ? 'Save changes' : 'Create playlist'}</PillButton>
      </div>
    </div>
  );
};

export default PlaylistComposer;
