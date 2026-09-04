import { useEffect, useLayoutEffect, useRef } from 'react';
import { WebviewWindow, getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PhysicalPosition, currentMonitor } from '@tauri-apps/api/window';
import { emitTo, listen } from '@tauri-apps/api/event';
import { usePlayerStore } from '@/store/playerStore';
import { useCurrentSongSnapshot } from '@/hooks/useLibraryViews';
import { isTauri } from '@/services/storageService';
import { recordBudgetLatency, recordPerfEvent } from '@/services/perfDiagnostics';
import type { AppSettings } from '@/types/music';

const OVERLAY_LABEL = 'overlay';
/** Must match the collapsed window geometry in pages/Overlay (pill + 12 px margin on every side). */
const OVERLAY_WIDTH = 128;
const OVERLAY_HEIGHT = 80;
const CREATE_TIMEOUT_MS = 3000;
const HEALTHCHECK_MS = 15000;

type OverlayPayload = {
  title: string;
  artist: string;
  albumArt: string | null;
  isPlaying: boolean;
  spinningArtwork: boolean;
  theme: AppSettings['appTheme'];
};

const getOverlayWindow = async (): Promise<WebviewWindow | null> =>
  (await WebviewWindow.getAll()).find((window) => window.label === OVERLAY_LABEL) ?? null;

const waitForOverlayCreated = (overlay: WebviewWindow): Promise<void> =>
  new Promise((resolve) => {
    let settled = false;
    let timeout: number | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout !== null) window.clearTimeout(timeout);
      resolve();
    };
    timeout = window.setTimeout(finish, CREATE_TIMEOUT_MS);
    void overlay.once('tauri://created', finish);
    void overlay.once('tauri://error', finish);
  });

const getOverlayUrl = (): string => new URL('/#/overlay', window.location.href).toString();

export const useOverlayController = (enabled: boolean): void => {
  const overlayAutoHide = usePlayerStore((state) => state.settings.overlayAutoHide);
  const overlaySpinningArtwork = usePlayerStore((state) => state.settings.overlaySpinningArtwork);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const appTheme = usePlayerStore((state) => state.settings.appTheme);
  const { song } = useCurrentSongSnapshot();
  const payloadRef = useRef<OverlayPayload>({
    title: 'Nothing Playing',
    artist: 'Amply',
    albumArt: null,
    isPlaying: false,
    spinningArtwork: true,
    theme: 'light',
  });
  const lastPayloadKeyRef = useRef<string | null>(null);

  // Refreshed before the effects below run, so `emitOverlayState` always reads the current payload.
  useLayoutEffect(() => {
    payloadRef.current = {
      title: song?.title?.trim() || 'Nothing Playing',
      artist: song?.artist?.trim() || 'Amply',
      albumArt: song?.albumArt?.trim() || null,
      isPlaying,
      spinningArtwork: overlaySpinningArtwork,
      theme: appTheme,
    };
  }, [song?.title, song?.artist, song?.albumArt, isPlaying, overlaySpinningArtwork, appTheme]);

  const emitOverlayState = async (force = false): Promise<void> => {
    const payload = payloadRef.current;
    const payloadKey = `${payload.title}\u0000${payload.artist}\u0000${payload.albumArt ?? ''}\u0000${payload.isPlaying ? 1 : 0}\u0000${payload.spinningArtwork ? 1 : 0}\u0000${payload.theme}`;
    if (!force && payloadKey === lastPayloadKeyRef.current) return;
    const overlay = await getOverlayWindow();
    if (!overlay) return;
    await emitTo(OVERLAY_LABEL, 'amply://overlay-state', payload);
    lastPayloadKeyRef.current = payloadKey;
  };

  // Own window creation and destruction. Playback changes must never rerun this setup.
  useEffect(() => {
    if (!isTauri() || getCurrentWebviewWindow().label === OVERLAY_LABEL) return;

    let disposed = false;
    let inFlight = false;
    let retryHandle: number | null = null;
    let healthHandle: number | null = null;

    const applyVisibility = async (overlay: WebviewWindow) => {
      const state = usePlayerStore.getState();
      if (state.settings.overlayAutoHide && !state.isPlaying) {
        await overlay.hide();
      } else {
        await overlay.show();
      }
    };

    const positionNewOverlay = async (overlay: WebviewWindow) => {
      const monitor = await currentMonitor();
      if (!monitor) {
        await overlay.setPosition(new PhysicalPosition(100, 200));
        return;
      }
      const workArea = monitor.workArea ?? { position: monitor.position, size: monitor.size };
      const outerSize = await overlay.outerSize().catch(() => null);
      const physicalHeight = outerSize?.height ?? OVERLAY_HEIGHT;
      await overlay.setPosition(new PhysicalPosition(
        workArea.position.x + 16,
        workArea.position.y + Math.max(16, Math.round((workArea.size.height - physicalHeight) / 2)),
      ));
    };

    const ensureOverlay = async () => {
      if (inFlight || disposed) return;
      inFlight = true;
      const startedAt = performance.now();
      try {
        let overlay = await getOverlayWindow();
        if (!enabled) {
          if (overlay) await overlay.close().catch(() => overlay?.hide().catch(() => {}));
          lastPayloadKeyRef.current = null;
          return;
        }

        let created = false;
        if (!overlay) {
          created = true;
          overlay = new WebviewWindow(OVERLAY_LABEL, {
            url: getOverlayUrl(),
            transparent: true,
            decorations: false,
            resizable: false,
            alwaysOnTop: true,
            visibleOnAllWorkspaces: true,
            skipTaskbar: true,
            shadow: false,
            focusable: true,
            visible: false,
            width: OVERLAY_WIDTH,
            height: OVERLAY_HEIGHT,
            backgroundColor: [0, 0, 0, 0],
            title: 'Amply Overlay',
          });
          void overlay.once('tauri://created', () => recordPerfEvent('overlay.created'));
          void overlay.once('tauri://error', (event) => recordPerfEvent('overlay.create-error', { error: String(event.payload) }));
          await waitForOverlayCreated(overlay);
        }
        if (disposed || !overlay) return;

        if (created) {
          await Promise.all([
            overlay.setAlwaysOnTop(true),
            overlay.setVisibleOnAllWorkspaces(true),
            overlay.setBackgroundColor([0, 0, 0, 0]),
          ]);
          await positionNewOverlay(overlay);
        }
        await applyVisibility(overlay);
        await emitOverlayState(true).catch(() => {});
      } catch (error) {
        recordPerfEvent('overlay.ensure-error', { error: error instanceof Error ? error.message : String(error) });
      } finally {
        inFlight = false;
        const durationMs = performance.now() - startedAt;
        if (durationMs > 700) recordBudgetLatency('overlay-ensure', durationMs, 700);
      }
    };

    void ensureOverlay();
    if (enabled) {
      retryHandle = window.setTimeout(() => void ensureOverlay(), 1200);
      healthHandle = window.setInterval(async () => {
        if (!await getOverlayWindow().catch(() => null)) void ensureOverlay();
      }, HEALTHCHECK_MS);
    }

    return () => {
      disposed = true;
      if (retryHandle !== null) window.clearTimeout(retryHandle);
      if (healthHandle !== null) window.clearInterval(healthHandle);
    };
  }, [enabled]);

  // Visibility changes are cheap and independent from window setup.
  useEffect(() => {
    if (!enabled || !isTauri() || getCurrentWebviewWindow().label === OVERLAY_LABEL) return;
    let disposed = false;
    void getOverlayWindow().then(async (overlay) => {
      if (!overlay || disposed) return;
      if (overlayAutoHide && !isPlaying) await overlay.hide();
      else await overlay.show();
      await emitOverlayState(true);
    }).catch((error) => recordPerfEvent('overlay.visibility-error', { error: String(error) }));
    return () => { disposed = true; };
  }, [enabled, overlayAutoHide, isPlaying]);

  // Track updates must continue while the main window is minimized or unfocused.
  useEffect(() => {
    if (!enabled || !isTauri() || getCurrentWebviewWindow().label === OVERLAY_LABEL) return;
    void emitOverlayState().catch((error) => recordPerfEvent('overlay.emit-error', { error: String(error) }));
  }, [enabled, song?.id, song?.title, song?.artist, song?.albumArt, isPlaying, overlaySpinningArtwork, appTheme]);

  useEffect(() => {
    if (!enabled || !isTauri() || getCurrentWebviewWindow().label === OVERLAY_LABEL) return;
    let alive = true;
    const unlisteners: Array<() => void> = [];
    let commandQueue = Promise.resolve();

    const register = async (eventName: string, handler: () => Promise<void> | void) => {
      const unlisten = await listen(eventName, () => {
        commandQueue = commandQueue.then(async () => {
          const startedAt = performance.now();
          try {
            await handler();
            await emitOverlayState(true);
            recordBudgetLatency(`overlay-command-${eventName.split('-').at(-1)}`, performance.now() - startedAt, 220);
          } catch (error) {
            recordPerfEvent('overlay.command.error', { eventName, error: error instanceof Error ? error.message : String(error) });
          }
        });
      });
      if (alive) unlisteners.push(unlisten);
      else unlisten();
    };

    const registerReady = async () => {
      const unlisten = await listen('amply://overlay-ready', () => {
        void emitOverlayState(true).catch((error) => {
          recordPerfEvent('overlay.ready-sync-error', { error: String(error) });
        });
      });
      if (alive) unlisteners.push(unlisten);
      else unlisten();
    };

    void Promise.all([
      register('amply://overlay-play', () => usePlayerStore.getState().resumePlayback()),
      register('amply://overlay-pause', () => usePlayerStore.getState().pausePlayback()),
      register('amply://overlay-prev', () => usePlayerStore.getState().playPrevious()),
      register('amply://overlay-next', () => usePlayerStore.getState().playNext(true)),
      registerReady(),
    ]).catch((error) => recordPerfEvent('overlay.listener-error', { error: String(error) }));

    return () => {
      alive = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [enabled]);
};
