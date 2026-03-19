import { useEffect } from 'react';
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, currentMonitor } from '@tauri-apps/api/window';
import { emitTo, listen } from '@tauri-apps/api/event';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { isTauri } from '@/services/storageService';

export const useOverlayController = (enabled: boolean): void => {
  const closeToTaskbar = usePlayerStore((state) => state.settings.closeToTaskbar);
  const overlayAutoHide = usePlayerStore((state) => state.settings.overlayAutoHide);
  const buildOverlayPayload = () => {
    const playerState = usePlayerStore.getState();
    const songId = playerState.currentSongId;
    const currentSong = songId ? useLibraryStore.getState().getSongById(songId) : undefined;
    return {
      title: currentSong?.title ?? 'Nothing Playing',
      artist: currentSong?.artist ?? 'Amply',
      albumArt: currentSong?.albumArt ?? null,
      isPlaying: playerState.isPlaying,
    };
  };

  const emitOverlayState = async () => {
    const overlay = (await WebviewWindow.getAll()).find((window) => window.label === 'overlay') ?? null;
    if (!overlay) {
      return;
    }
    await emitTo('overlay', 'amply://overlay-state', buildOverlayPayload());
  };

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label === 'overlay') {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const waitForCreated = (overlay: WebviewWindow): Promise<void> =>
      new Promise((resolve) => {
        overlay.once('tauri://created', () => resolve());
        overlay.once('tauri://error', () => resolve());
      });

    const ensureOverlay = async () => {
      if (inFlight) {
        return;
      }
      inFlight = true;
      const overlayLabel = 'overlay';
      const existing = (await WebviewWindow.getAll()).find((window) => window.label === overlayLabel) ?? null;

      if (!enabled) {
        if (existing) {
          await existing.hide().catch(() => existing.close().catch(() => {}));
        }
        inFlight = false;
        return;
      }

      let overlay = existing;
      const overlayUrl =
        typeof window !== 'undefined'
          ? new URL('/#/overlay', window.location.href).toString()
          : '/#/overlay';
      if (!overlay) {
        try {
          overlay = new WebviewWindow(overlayLabel, {
            url: overlayUrl,
            transparent: true,
            decorations: false,
            resizable: false,
            alwaysOnTop: true,
            visibleOnAllWorkspaces: true,
            skipTaskbar: true,
            shadow: false,
            focusable: true,
            visible: true,
            width: 240,
            height: 56,
            backgroundColor: [0, 0, 0, 0],
            title: 'Amply Overlay',
          });
          overlay.once('tauri://created', () => {
            console.info('[Amply] Overlay window created');
          });
          overlay.once('tauri://error', (event) => {
            console.error('[Amply] Overlay window error', event?.payload ?? event);
          });
          await waitForCreated(overlay);
        } catch (error) {
          console.error('[Amply] Overlay window creation failed', error);
          inFlight = false;
          return;
        }
      }

      if (cancelled || !overlay) {
        inFlight = false;
        return;
      }

      try {
        await overlay.setAlwaysOnTop(true);
        await overlay.setVisibleOnAllWorkspaces(true);
        await overlay.setBackgroundColor([0, 0, 0, 0]);
        await overlay.show();
        await overlay.setFocus();
      } catch (error) {
        console.error('[Amply] Overlay window show failed', error);
      }

      try {
        const monitor = await currentMonitor();
        if (monitor) {
          const height = 64;
          const x = monitor.position.x + 16;
          const y = monitor.position.y + Math.round((monitor.workArea.size.height - height) / 2);
          await overlay.setPosition(new PhysicalPosition(x, y));
        } else {
          await overlay.setPosition(new PhysicalPosition(100, 200));
        }
      } catch (error) {
        console.error('[Amply] Overlay window position failed', error);
      }
      inFlight = false;
    };

    void ensureOverlay();
    let retry: number | null = null;
    if (enabled) {
      retry = window.setTimeout(() => {
        void ensureOverlay();
      }, 1200);
    }

    return () => {
      cancelled = true;
      if (retry) {
        window.clearTimeout(retry);
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label === 'overlay') {
      return;
    }

    if (!enabled) {
      return;
    }

    let disposed = false;

    const syncVisibility = async () => {
      if (disposed) {
        return;
      }
      const overlay = (await WebviewWindow.getAll()).find((window) => window.label === 'overlay') ?? null;
      if (!overlay) {
        return;
      }
      const { isPlaying } = usePlayerStore.getState();
      if (overlayAutoHide && !isPlaying) {
        await overlay.hide().catch(() => {});
      } else {
        await overlay.show().catch(() => {});
      }
    };

    const unsub = usePlayerStore.subscribe(() => {
      void syncVisibility();
    });

    void syncVisibility();

    return () => {
      disposed = true;
      unsub();
    };
  }, [enabled, overlayAutoHide]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label === 'overlay') {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;

    (async () => {
      unlisten = await currentWindow.onCloseRequested(async () => {
        if (closeToTaskbar) {
          return;
        }
        const overlay = (await WebviewWindow.getAll()).find((window) => window.label === 'overlay') ?? null;
        if (overlay) {
          await overlay.close().catch(() => {});
        }
      });

      if (disposed && unlisten) {
        unlisten();
      }
    })();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [closeToTaskbar]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label === 'overlay') {
      return;
    }

    if (!enabled) {
      return;
    }

    let scheduled = false;
    let cancelled = false;

    const scheduleEmit = () => {
      if (scheduled) {
        return;
      }
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        if (cancelled) {
          return;
        }
        void emitOverlayState().catch((error) => {
          console.warn('[Amply] Overlay emit failed', error);
        });
      });
    };

    const unsubPlayer = usePlayerStore.subscribe(() => scheduleEmit());
    const unsubLibrary = useLibraryStore.subscribe(() => scheduleEmit());

    scheduleEmit();

    return () => {
      cancelled = true;
      unsubPlayer();
      unsubLibrary();
    };
  }, [enabled]);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const currentWindow = getCurrentWebviewWindow();
    if (currentWindow.label === 'overlay') {
      return;
    }

    if (!enabled) {
      return;
    }

    let unlistenPlay: (() => void) | null = null;
    let unlistenPause: (() => void) | null = null;
    let unlistenPrev: (() => void) | null = null;
    let unlistenNext: (() => void) | null = null;
    let actionBusy = false;

    const runCommand = async (fn: () => Promise<void> | void) => {
      if (actionBusy) {
        return;
      }
      actionBusy = true;
      try {
        await fn();
      } finally {
        actionBusy = false;
      }
    };

    void (async () => {
      unlistenPlay = await listen('amply://overlay-play', async () => {
        usePlayerStore.getState().resumePlayback();
        void emitOverlayState();
      });
      unlistenPause = await listen('amply://overlay-pause', async () => {
        usePlayerStore.getState().pausePlayback();
        void emitOverlayState();
      });
      unlistenPrev = await listen('amply://overlay-prev', async () => {
        await runCommand(() => usePlayerStore.getState().playPrevious());
        void emitOverlayState();
      });
      unlistenNext = await listen('amply://overlay-next', async () => {
        await runCommand(() => usePlayerStore.getState().playNext(true));
        void emitOverlayState();
      });
    })();

    return () => {
      if (unlistenPlay) {
        unlistenPlay();
      }
      if (unlistenPause) {
        unlistenPause();
      }
      if (unlistenPrev) {
        unlistenPrev();
      }
      if (unlistenNext) {
        unlistenNext();
      }
    };
  }, [enabled]);
};
