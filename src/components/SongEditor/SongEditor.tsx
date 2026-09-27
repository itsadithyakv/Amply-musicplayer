import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { Button, Modal, TextInput } from '@/components/ui';
import { isTauri } from '@/services/storageService';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Song } from '@/types/music';

/** Which song the editor is open for. One editor serves every list, so rows only call `open`. */
export const useSongEditor = create<{ songId: string | null; open: (songId: string) => void; close: () => void }>((set) => ({
  songId: null,
  open: (songId) => set({ songId }),
  close: () => set({ songId: null }),
}));

interface Draft {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  genre: string;
  year: string;
  track: string;
}

const isPlaceholder = (value: string | undefined, placeholder: string) =>
  !value?.trim() || value.trim().toLowerCase() === placeholder;

const draftFor = (song: Song): Draft => ({
  title: song.title,
  artist: isPlaceholder(song.artist, 'unknown artist') ? '' : song.artist,
  album: isPlaceholder(song.album, 'unknown album') ? '' : song.album,
  albumArtist: song.albumArtist ?? '',
  genre: isPlaceholder(song.genre, 'unknown genre') ? '' : song.genre,
  year: song.year ? String(song.year) : '',
  track: song.track ? String(song.track) : '',
});

const toNumber = (value: string): number | null => {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Edits a song's tags in the file itself, so every player sees the change. */
export const SongEditor = () => {
  const songId = useSongEditor((state) => state.songId);
  const close = useSongEditor((state) => state.close);
  const song = useLibraryStore((state) => (songId ? state.getSongById(songId) : undefined));
  const applyEditedSong = useLibraryStore((state) => state.applyEditedSong);
  const showToast = usePlayerStore((state) => state.showToast);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(song ? draftFor(song) : null);
    setError(null);
    // Only a different song resets the form; library updates while typing must not wipe it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId]);

  if (!song || !draft) {
    return null;
  }

  const field = (key: keyof Draft, label: string, extra: { inputMode?: 'numeric' } = {}) => (
    <TextInput
      label={label}
      value={draft[key]}
      onValueChange={(value) => setDraft({ ...draft, [key]: value })}
      ref={key === 'title' ? titleRef : undefined}
      {...extra}
    />
  );

  const save = async () => {
    if (!draft.title.trim()) {
      setError('A song needs a title.');
      return;
    }
    if (!isTauri()) {
      close();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await invoke<Partial<Song>>('write_song_tags', {
        path: song.path,
        edit: {
          title: draft.title,
          artist: draft.artist,
          album: draft.album,
          albumArtist: draft.albumArtist,
          genre: draft.genre,
          year: toNumber(draft.year),
          track: toNumber(draft.track),
        },
      });
      await applyEditedSong(song.id, updated);
      showToast('Song info saved');
      close();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        message.includes('outside the configured library folders')
          ? 'Only songs inside your library folders can be edited.'
          : `Could not save: ${message}`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={close}
      size="md"
      title="Edit song info"
      description={song.filename}
      initialFocusRef={titleRef}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {field('title', 'Title')}
        <div className="grid gap-3 sm:grid-cols-2">
          {field('artist', 'Artist')}
          {field('albumArtist', 'Album artist')}
        </div>
        {field('album', 'Album')}
        <div className="grid gap-3 sm:grid-cols-3">
          {field('genre', 'Genre')}
          {field('year', 'Year', { inputMode: 'numeric' })}
          {field('track', 'Track', { inputMode: 'numeric' })}
        </div>
        {error ? (
          <p role="alert" className="text-[12px] text-amply-danger">
            {error}
          </p>
        ) : null}
        {/* Enter submits from any field. */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
};
