import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { probeAudioFiles } from '@/services/musicScanner';
import { recordPerfEvent } from '@/services/perfDiagnostics';
import { isTauri } from '@/services/storageService';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

/**
 * Plays audio files handed to Amply from outside: "Open with" / a double-click in Explorer, or a
 * drop on the window. The songs join the library (so plays and favourites stick) and start playing.
 */
export const openExternalFiles = async (paths: string[]): Promise<void> => {
  const player = usePlayerStore.getState();
  const songs = await probeAudioFiles(paths).catch((error: unknown) => {
    recordPerfEvent('open-files.probe-failed', { error: error instanceof Error ? error.message : String(error) });
    return [];
  });
  if (!songs.length) {
    player.showToast('Nothing playable in what was opened');
    return;
  }
  await useLibraryStore.getState().addLooseSongs(songs);
  const ids = songs.map((song) => song.id);
  player.setQueue(ids, ids[0]);
  await player.playSongById(ids[0]);
  recordPerfEvent('open-files.played', { files: songs.length });
};

/**
 * Wires the three ways files arrive: launch arguments (held by Rust until the library is ready),
 * files opened while Amply runs (forwarded by the single-instance handler) and drag-and-drop.
 * Returns whether files are being dragged over the window, for the drop overlay.
 */
export const useExternalFiles = (libraryReady: boolean): boolean => {
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!isTauri() || !libraryReady) {
      return;
    }
    let alive = true;
    const disposers: Array<() => void> = [];
    const keep = (dispose: () => void) => (alive ? disposers.push(dispose) : dispose());

    void invoke<string[]>('take_open_files').then((paths) => {
      if (alive && paths.length) {
        void openExternalFiles(paths);
      }
    });
    void listen<string[]>('amply://open-files', (event) => {
      if (event.payload?.length) {
        void openExternalFiles(event.payload);
      }
    }).then(keep);
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const { payload } = event;
        if (payload.type === 'enter') {
          setDragging(payload.paths.length > 0);
        } else if (payload.type === 'leave') {
          setDragging(false);
        } else if (payload.type === 'drop') {
          setDragging(false);
          if (payload.paths.length) {
            void openExternalFiles(payload.paths);
          }
        }
      })
      .then(keep);

    return () => {
      alive = false;
      disposers.forEach((dispose) => dispose());
    };
  }, [libraryReady]);

  return dragging;
};
