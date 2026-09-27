import { useCallback, useEffect, useRef, useState } from 'react';
import { emitTo, listen } from '@tauri-apps/api/event';
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition, type Window } from '@tauri-apps/api/window';
import { isTauri } from '@/services/storageService';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { IconButton } from '@/components/ui';
import { isLanguageCode, setLanguage } from '@/i18n';

type OverlayTheme = 'light' | 'dark';

type OverlayState = {
  title: string;
  artist: string;
  albumArt: string | null;
  isPlaying: boolean;
  spinningArtwork: boolean;
  /** Mirrors the main window's app theme; null until the first payload arrives (boot script owns it). */
  theme: OverlayTheme | null;
};

type OverlayPayload = Partial<Omit<OverlayState, 'theme'>> & { theme?: unknown; language?: unknown };

const initialState: OverlayState = {
  title: 'Nothing Playing',
  artist: 'Amply',
  albumArt: null,
  isPlaying: false,
  spinningArtwork: true,
  theme: null,
};

/**
 * The window is the pill plus a 12 px margin on every side. The margin keeps the raised shadow
 * inside the window (a shadow clipped at the window edge reads as a hard, jagged outline on a
 * transparent surface) and gives the antialiased rounded edge transparent pixels to blend into.
 */
const WINDOW_MARGIN = 12;
const PILL_HEIGHT = 56;
const COLLAPSED_PILL_WIDTH = 104;
const EXPANDED_PILL_WIDTH = 324;
const COLLAPSED_WIDTH = COLLAPSED_PILL_WIDTH + WINDOW_MARGIN * 2;
const EXPANDED_WIDTH = EXPANDED_PILL_WIDTH + WINDOW_MARGIN * 2;
const OVERLAY_HEIGHT = PILL_HEIGHT + WINDOW_MARGIN * 2;

const isOverlayTheme = (value: unknown): value is OverlayTheme => value === 'light' || value === 'dark';

/**
 * Moves the overlay so a window of `logicalWidth` fits inside its monitor's work area (the screen
 * minus the taskbar). Returns the horizontal shift applied, in physical pixels (negative = left).
 * Near the right edge, or on a narrow portrait screen, the pill slides left instead of expanding
 * off-screen; a drag that ends half off a monitor is pulled back.
 */
const fitToWorkArea = async (overlayWindow: Window, logicalWidth: number): Promise<number> => {
  const monitor = await currentMonitor();
  if (!monitor) return 0;
  const area = monitor.workArea ?? { position: monitor.position, size: monitor.size };
  const width = Math.round(logicalWidth * monitor.scaleFactor);
  const height = Math.round(OVERLAY_HEIGHT * monitor.scaleFactor);
  const position = await overlayWindow.outerPosition();
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
  const x = clamp(position.x, area.position.x, area.position.x + area.size.width - width);
  const y = clamp(position.y, area.position.y, area.position.y + area.size.height - height);
  if (x !== position.x || y !== position.y) {
    await overlayWindow.setPosition(new PhysicalPosition(x, y));
  }
  return x - position.x;
};

/** Wrapper that collapses a control to zero width while the pill is at rest. */
const revealClass =
  'invisible w-0 shrink-0 overflow-hidden opacity-0 transition-[width,margin,opacity] duration-150 group-data-[state=expanded]:visible group-data-[state=expanded]:w-7 group-data-[state=expanded]:opacity-100';

const OverlayPage = () => {
  const [state, setState] = useState<OverlayState>(initialState);
  const [expanded, setExpanded] = useState(false);
  const desiredExpandedRef = useRef(false);
  const resizingRef = useRef(false);
  /** Physical px the pill slid left to fit its expanded width; undone when it collapses. */
  const expandShiftRef = useRef(0);

  const emitMainCommand = useCallback(async (eventName: string) => {
    if (!isTauri()) return;
    try {
      await emitTo('main', eventName);
    } catch (error) {
      console.warn('[Amply] Overlay command failed', eventName, error);
    }
  }, []);

  const resizeOverlay = useCallback((nextExpanded: boolean) => {
    if (!isTauri()) return;
    desiredExpandedRef.current = nextExpanded;
    if (resizingRef.current) return;

    resizingRef.current = true;
    const overlayWindow = getCurrentWindow();
    void (async () => {
      // Apply the latest desired size, then re-check at most twice for hover changes that landed
      // mid-await. Bounded so a pointer bouncing across the edge cannot keep this loop spinning.
      let applied: boolean | null = null;
      for (let attempt = 0; attempt < 3 && applied !== desiredExpandedRef.current; attempt += 1) {
        const target: boolean = desiredExpandedRef.current;
        if (target) {
          // Slide first, then grow, so the expanded pill never flashes past the screen edge.
          expandShiftRef.current = await fitToWorkArea(overlayWindow, EXPANDED_WIDTH);
          await overlayWindow.setSize(new LogicalSize(EXPANDED_WIDTH, OVERLAY_HEIGHT));
        } else {
          await overlayWindow.setSize(new LogicalSize(COLLAPSED_WIDTH, OVERLAY_HEIGHT));
          if (expandShiftRef.current !== 0) {
            const position = await overlayWindow.outerPosition();
            await overlayWindow.setPosition(new PhysicalPosition(position.x - expandShiftRef.current, position.y));
            expandShiftRef.current = 0;
          }
        }
        applied = target;
      }
    })().catch((error) => {
      console.warn('[Amply] Overlay resize failed', error);
    }).finally(() => {
      resizingRef.current = false;
    });
  }, []);

  const setExpansion = useCallback((nextExpanded: boolean) => {
    setExpanded(nextExpanded);
    resizeOverlay(nextExpanded);
  }, [resizeOverlay]);

  // Pull the pill back on screen after a drag, a monitor unplug, or a resolution/DPI change.
  useEffect(() => {
    if (!isTauri()) return;
    const overlayWindow = getCurrentWindow();
    let settleHandle: number | null = null;
    let unlisten: (() => void) | null = null;
    let alive = true;
    const settle = () => {
      if (settleHandle !== null) window.clearTimeout(settleHandle);
      settleHandle = window.setTimeout(() => {
        if (resizingRef.current) return;
        const width = desiredExpandedRef.current ? EXPANDED_WIDTH : COLLAPSED_WIDTH;
        void fitToWorkArea(overlayWindow, width).catch(() => {});
      }, 300);
    };
    void Promise.all([overlayWindow.onMoved(settle), overlayWindow.onScaleChanged(settle)])
      .then((disposers) => {
        const dispose = () => disposers.forEach((stop) => stop());
        if (alive) unlisten = dispose;
        else dispose();
      })
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
      if (settleHandle !== null) window.clearTimeout(settleHandle);
    };
  }, []);

  useEffect(() => {
    const root = document.getElementById('root');
    const previous = {
      htmlBackground: document.documentElement.style.background,
      bodyBackground: document.body.style.background,
      bodyOverflow: document.body.style.overflow,
      rootBackground: root?.style.background ?? '',
    };
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';
    if (root) root.style.background = 'transparent';
    if (isTauri()) {
      const overlayWindow = getCurrentWindow();
      void Promise.all([
        overlayWindow.setBackgroundColor([0, 0, 0, 0]),
        overlayWindow.setSize(new LogicalSize(COLLAPSED_WIDTH, OVERLAY_HEIGHT)),
      ]).catch((error) => {
        console.warn('[Amply] Overlay window setup failed', error);
      });
    }
    return () => {
      document.documentElement.style.background = previous.htmlBackground;
      document.body.style.background = previous.bodyBackground;
      document.body.style.overflow = previous.bodyOverflow;
      if (root) root.style.background = previous.rootBackground;
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let unlisten: (() => void) | null = null;
    let retryHandle: number | null = null;

    void listen<OverlayPayload>('amply://overlay-state', (event) => {
      if (!alive || !event.payload) return;
      const payload = event.payload;
      if (isLanguageCode(payload.language)) {
        void setLanguage(payload.language);
      }
      setState((previous) => ({
        title: typeof payload.title === 'string' && payload.title.trim() ? payload.title : previous.title,
        artist: typeof payload.artist === 'string' && payload.artist.trim() ? payload.artist : previous.artist,
        albumArt: typeof payload.albumArt === 'string' && payload.albumArt.trim() ? payload.albumArt : previous.albumArt,
        isPlaying: Boolean(payload.isPlaying),
        spinningArtwork: payload.spinningArtwork !== false,
        theme: isOverlayTheme(payload.theme) ? payload.theme : previous.theme,
      }));
    }).then((dispose) => {
      if (!alive) {
        dispose();
        return;
      }
      unlisten = dispose;
      void emitTo('main', 'amply://overlay-ready');
      retryHandle = window.setTimeout(() => void emitTo('main', 'amply://overlay-ready'), 500);
    }).catch((error) => console.warn('[Amply] Overlay listener failed', error));

    return () => {
      alive = false;
      unlisten?.();
      if (retryHandle !== null) window.clearTimeout(retryHandle);
    };
  }, []);

  // The overlay is its own webview, so it follows the main window's theme via the payload rather
  // than the player store. The boot script already applied the persisted theme before first paint.
  useEffect(() => {
    if (!state.theme) return;
    document.documentElement.dataset.theme = state.theme;
  }, [state.theme]);

  const togglePlayback = () => {
    const wasPlaying = state.isPlaying;
    setState((current) => ({ ...current, isPlaying: !current.isPlaying }));
    void emitMainCommand(wasPlaying ? 'amply://overlay-pause' : 'amply://overlay-play');
  };

  return (
    <div className="flex h-full w-full items-center justify-start bg-transparent" style={{ padding: WINDOW_MARGIN }}>
      {/* At rest the pill is a quiet translucent surface; on hover it becomes an opaque raised one.
          No overflow clipping here: a rounded clip around the (composited) spinning artwork would be
          rasterised without antialiasing, which is what made the edge look jagged. */}
      <div
        data-testid="overlay-surface"
        data-state={expanded ? 'expanded' : 'collapsed'}
        className="group flex h-[56px] items-center justify-between rounded-full px-2 text-amply-textPrimary shadow-[inset_0_0_0_1px_rgb(var(--amply-edge)/var(--edge-a))] transition-[width,background-color,box-shadow] duration-[180ms] ease-out data-[state=collapsed]:w-[104px] data-[state=collapsed]:bg-amply-bg/80 data-[state=expanded]:w-[324px] data-[state=expanded]:neu-raised-sm"
        onPointerEnter={() => setExpansion(true)}
        onPointerLeave={() => setExpansion(false)}
      >
        <div className={`${revealClass} group-data-[state=expanded]:mr-1`}>
          <IconButton
            name="drag"
            label="Move overlay"
            size="xs"
            variant="flat"
            className="cursor-grab active:cursor-grabbing"
            onPointerDown={() => {
              if (isTauri()) void getCurrentWindow().startDragging();
            }}
          />
        </div>

        <div
          data-testid="overlay-artwork"
          className={`neu-well relative h-11 w-11 shrink-0 opacity-70 transition-opacity duration-150 group-data-[state=expanded]:opacity-100 ${state.spinningArtwork ? 'animate-[spin_8s_linear_infinite] rounded-full' : 'rounded-sm'}`}
          style={state.spinningArtwork ? { animationPlayState: state.isPlaying ? 'running' : 'paused' } : undefined}
        >
          {state.albumArt ? (
            <ArtworkImage
              src={state.albumArt}
              alt=""
              className={`h-full w-full object-cover ${state.spinningArtwork ? 'rounded-full' : 'rounded-sm'}`}
              loading="eager"
              decoding="async"
              forceReady
              pulse={false}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[18px] font-semibold text-amply-textMuted">A</div>
          )}
          {state.spinningArtwork ? (
            <span className="neu-pressed-sm pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full" />
          ) : null}
        </div>

        <div
          data-testid="overlay-details"
          aria-hidden={!expanded}
          className="invisible ml-0 min-w-0 max-w-0 flex-1 overflow-hidden px-0 opacity-0 transition-[max-width,margin,opacity] duration-150 group-data-[state=expanded]:visible group-data-[state=expanded]:ml-2 group-data-[state=expanded]:max-w-[140px] group-data-[state=expanded]:opacity-100"
        >
          <p className="truncate text-[12px] font-semibold tracking-[-0.01em] text-amply-textPrimary">{state.title}</p>
          <p className="mt-0.5 truncate text-[11px] text-amply-textSecondary">{state.artist}</p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <div className={revealClass}>
            <IconButton name="prev" label="Previous track" size="xs" variant="ghost" onClick={() => void emitMainCommand('amply://overlay-prev')} />
          </div>
          <div className="opacity-70 transition-opacity duration-150 group-data-[state=expanded]:opacity-100">
            <IconButton
              name={state.isPlaying ? 'pause' : 'play'}
              label={state.isPlaying ? 'Pause' : 'Play'}
              size="sm"
              variant="accent"
              onClick={togglePlayback}
            />
          </div>
          <div className={revealClass}>
            <IconButton name="next" label="Next track" size="xs" variant="ghost" onClick={() => void emitMainCommand('amply://overlay-next')} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverlayPage;
