import clsx from 'clsx';
import { memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
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
import { Button, Card, Divider, IconButton, Kicker, SearchInput, SegmentedTabs, Surface, TextInput } from '@/components/ui';
import { PlaylistArtworkCollage } from '@/components/Playlists/PlaylistArtworkCollage';
import { t, useT } from '@/i18n';
import { localizedPlaylistDescription } from '@/i18n/playlistNames';
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
    throw new Error(t('playlists.composer.error.notImage'));
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error(t('playlists.composer.error.tooLarge'));
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
      throw new Error(t('playlists.composer.error.processing'));
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
  const label = selected ? t('playlists.composer.added') : t('playlists.composer.add');

  return (
    <div style={style} className="px-1 py-1">
      <div className="neu-flat flex h-full min-w-0 items-center gap-3 rounded-md px-3 text-[12px] transition-[box-shadow] duration-150 hover:neu-raised-sm">
        <div className="neu-well h-10 w-10 shrink-0 overflow-hidden rounded-sm">
          {song.albumArt ? <ArtworkImage src={song.albumArt} alt="" className="h-full w-full object-cover" pulse={false} /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-amply-textPrimary">{song.title}</p>
          <p className="truncate text-[11px] text-amply-textSecondary">{song.artist} · {song.album}</p>
        </div>
        <Button
          size="sm"
          pressed={selected}
          onClick={() => data.togglePlaylistSong(song.id)}
          className={clsx('min-w-[66px]', selected && 'text-amply-accent')}
        >
          {label}
        </Button>
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
  const { t } = useT();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx('flex items-center gap-2 rounded-md px-2 py-2', isDragging ? 'neu-raised z-raised' : 'neu-flat')}
    >
      <IconButton
        ref={setActivatorNodeRef}
        name="drag"
        label={t('playlists.composer.drag', { title: song.title })}
        size="xs"
        variant="ghost"
        className="cursor-grab active:cursor-grabbing"
        {...attributes}
        {...listeners}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-amply-textPrimary">{song.title}</p>
        <p className="truncate text-[11px] text-amply-textSecondary">{song.artist}</p>
      </div>
      <div className="flex items-center gap-1">
        <IconButton name="arrow-up" label={t('playlists.composer.moveUp', { title: song.title })} size="xs" variant="flat" disabled={position === 0} onClick={() => onMove(position, -1)} />
        <IconButton name="arrow-down" label={t('playlists.composer.moveDown', { title: song.title })} size="xs" variant="flat" disabled={position === count - 1} onClick={() => onMove(position, 1)} />
        <IconButton name="close" label={t('playlists.composer.remove', { title: song.title })} size="xs" variant="ghost" onClick={() => onRemove(song.id)} />
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
  const { t, tp } = useT();
  const [playlistName, setPlaylistName] = useState(initialPlaylist?.name ?? '');
  const [playlistDescription, setPlaylistDescription] = useState(initialPlaylist ? localizedPlaylistDescription(initialPlaylist) : '');
  const [playlistArtwork, setPlaylistArtwork] = useState<string | undefined>(initialPlaylist?.artwork);
  const [playlistSongQuery, setPlaylistSongQuery] = useState('');
  const deferredQuery = useDeferredValue(playlistSongQuery);
  const [filterTab, setFilterTab] = useState<ComposerFilter>('all');
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>(initialPlaylist?.songIds ?? []);
  const [playlistError, setPlaylistError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);
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
  const previewArtwork = useMemo(() => {
    if (playlistArtwork) return [playlistArtwork];
    if (!collageArtwork.length) return [];
    return [0, 1, 2, 3].map((slot) => collageArtwork[slot] ?? collageArtwork[0]);
  }, [collageArtwork, playlistArtwork]);

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
      setPlaylistError(t('playlists.composer.error.nameRequired'));
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
        description: playlistDescription.trim(),
        artwork: playlistArtwork,
        songIds: selectedSongIds,
        updatedAt: Math.floor(Date.now() / 1000),
      });
      recordBudgetLatency('playlist-save', performance.now() - startedAt, 300);
    } catch {
      setPlaylistError(t('playlists.composer.error.saveFailed'));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card as="section" padding="md">
            <Kicker>{t('playlists.composer.details')}</Kicker>
            <div className="mt-4 flex items-start gap-4">
              <PlaylistArtworkCollage artworkSet={previewArtwork} radius="sm" thumbSize={128} className="h-24 w-24" />
              <div className="min-w-0 flex-1 space-y-3">
                <TextInput autoFocus label={t('playlists.composer.name')} size="sm" value={playlistName} onValueChange={setPlaylistName} placeholder={t('playlists.composer.namePlaceholder')} />
                <TextInput label={t('playlists.composer.note')} size="sm" value={playlistDescription} onValueChange={setPlaylistDescription} placeholder={t('playlists.composer.notePlaceholder')} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Button size="sm" icon="folder" onClick={() => coverInputRef.current?.click()}>
                {playlistArtwork ? t('playlists.composer.changeCover') : t('playlists.composer.chooseCover')}
              </Button>
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label={t('playlists.composer.coverInput')}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void resizeCover(file).then((dataUrl) => {
                    setPlaylistArtwork(dataUrl);
                    setPlaylistError(null);
                  }).catch((error: Error) => setPlaylistError(error.message));
                }}
              />
              {playlistArtwork ? <Button size="sm" variant="ghost" onClick={() => setPlaylistArtwork(undefined)}>{t('playlists.composer.autoCollage')}</Button> : null}
            </div>
          </Card>

          <Card as="section" padding="md">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Kicker>{t('playlists.composer.trackOrder')}</Kicker>
                <p className="mt-1 text-[12px] text-amply-textSecondary">{tp('playlists.composer.selected', selectedSongIds.length)}</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedSongIds([])} disabled={!selectedSongIds.length}>{t('playlists.composer.clear')}</Button>
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
              ) : (
                <Surface variant="well" radius="sm" className="flex h-full items-center justify-center px-4 text-center text-[12px] text-amply-textSecondary">
                  {t('playlists.composer.emptyOrder')}
                </Surface>
              )}
            </div>
          </Card>
        </div>

        <Card as="section" padding="md" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[14px] font-semibold text-amply-textPrimary">{t('playlists.composer.chooseTracks')}</p>
              <p className="mt-0.5 text-[12px] text-amply-textSecondary">{tp('playlists.composer.matching', composerSongs.length)}</p>
            </div>
            <SearchInput size="sm" value={playlistSongQuery} onValueChange={setPlaylistSongQuery} placeholder={t('playlists.composer.searchPlaceholder')} aria-label={t('playlists.composer.search')} className="w-full max-w-xs" />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <SegmentedTabs
              size="sm"
              ariaLabel={t('playlists.composer.filter')}
              tabs={[
                { value: 'all', label: t('playlists.composer.filter.all') },
                { value: 'favorites', label: t('playlists.composer.filter.favorites') },
                { value: 'recent', label: t('playlists.composer.filter.recent') },
                { value: 'most_played', label: t('playlists.composer.filter.mostPlayed') },
              ]}
              value={filterTab}
              onChange={setFilterTab}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setSelectedSongIds((current) => Array.from(new Set([...current, ...composerSongs.map((song) => song.id)])))}>{t('playlists.composer.addResults')}</Button>
              <Button size="sm" variant="ghost" onClick={() => {
                const visible = new Set(composerSongs.map((song) => song.id));
                setSelectedSongIds((current) => current.filter((id) => !visible.has(id)));
              }}>{t('playlists.composer.removeResults')}</Button>
            </div>
          </div>
          <Surface variant="pressed" radius="md" className="mt-4 h-[520px] overflow-hidden p-1">
            <AutoSizer>
              {({ height, width }) => <List height={height} width={width} itemCount={composerSongs.length} itemSize={58} itemData={rowData} overscanCount={8}>{PlaylistSongRow}</List>}
            </AutoSizer>
          </Surface>
        </Card>
      </div>

      {playlistError ? <p role="alert" className="text-[12px] text-amply-danger">{playlistError}</p> : null}
      <Divider />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{t('playlists.composer.cancel')}</Button>
        <Button variant="primary" loading={saving} onClick={() => void savePlaylist()}>{saving ? t('playlists.composer.saving') : initialPlaylist ? t('playlists.composer.saveChanges') : t('playlists.composer.createTitle')}</Button>
      </div>
    </div>
  );
};

export default PlaylistComposer;
