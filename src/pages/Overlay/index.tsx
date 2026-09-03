import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { isTauri } from '@/services/storageService';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import prevIcon from '@/assets/icons/prev.svg';
import nextIcon from '@/assets/icons/next.svg';
import playIcon from '@/assets/icons/play.svg';
import pauseIcon from '@/assets/icons/pause.svg';

type OverlayState = {
  title: string;
  artist: string;
  albumArt: string | null;
  isPlaying: boolean;
  spinningArtwork: boolean;
};

const initialState: OverlayState = {
  title: 'Nothing Playing',
  artist: 'Amply',
  albumArt: null,
  isPlaying: false,
  spinningArtwork: true,
};

const COLLAPSED_WIDTH = 112;
const EXPANDED_WIDTH = 332;
const OVERLAY_HEIGHT = 64;

const OverlayButton = memo(({
  label,
  icon,
  accent = false,
  onClick,
}: {
  label: string;
  icon: string;
  accent?: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={accent
      ? 'flex h-9 w-9 items-center justify-center rounded-full bg-amply-accent text-black hover:bg-amply-accentHover'
      : 'flex h-8 w-8 items-center justify-center rounded-full text-white/72 hover:bg-white/10 hover:text-white'}
    title={label}
    aria-label={label}
  >
    <img src={icon} alt="" className={accent ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5 invert'} draggable={false} />
  </button>
));

const OverlayPage = () => {
  const [state, setState] = useState<OverlayState>(initialState);
  const desiredExpandedRef = useRef(false);
  const resizingRef = useRef(false);

  const emitMainCommand = useCallback(async (eventName: string) => {
    if (!isTauri()) return;
    try {
      await emitTo('main', eventName);
    } catch (error) {
      console.warn('[Amply] Overlay command failed', eventName, error);
    }
  }, []);

  const resizeOverlay = useCallback((expanded: boolean) => {
    if (!isTauri()) return;
    desiredExpandedRef.current = expanded;
    if (resizingRef.current) return;

    resizingRef.current = true;
    const overlayWindow = getCurrentWindow();
    void (async () => {
      // Apply the latest desired size, then re-check at most twice for hover changes that landed
      // mid-await. Bounded so a pointer bouncing across the edge cannot keep this loop spinning.
      let applied: boolean | null = null;
      for (let attempt = 0; attempt < 3 && applied !== desiredExpandedRef.current; attempt += 1) {
        const nextExpanded: boolean = desiredExpandedRef.current;
        await overlayWindow.setSize(new LogicalSize(
          nextExpanded ? EXPANDED_WIDTH : COLLAPSED_WIDTH,
          OVERLAY_HEIGHT,
        ));
        applied = nextExpanded;
      }
    })().catch((error) => {
      console.warn('[Amply] Overlay resize failed', error);
    }).finally(() => {
      resizingRef.current = false;
    });
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

    void listen<OverlayState>('amply://overlay-state', (event) => {
      if (!alive || !event.payload) return;
      const payload = event.payload;
      setState((previous) => ({
        title: typeof payload.title === 'string' && payload.title.trim() ? payload.title : previous.title,
        artist: typeof payload.artist === 'string' && payload.artist.trim() ? payload.artist : previous.artist,
        albumArt: typeof payload.albumArt === 'string' && payload.albumArt.trim() ? payload.albumArt : null,
        isPlaying: Boolean(payload.isPlaying),
        spinningArtwork: payload.spinningArtwork !== false,
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

  const togglePlayback = () => {
    const wasPlaying = state.isPlaying;
    setState((current) => ({ ...current, isPlaying: !current.isPlaying }));
    void emitMainCommand(wasPlaying ? 'amply://overlay-pause' : 'amply://overlay-play');
  };

  return (
    <div className="flex h-full w-full items-center justify-start bg-transparent p-1">
      <div
        data-testid="overlay-surface"
        className="group flex h-[56px] w-[104px] items-center overflow-hidden rounded-[18px] border border-white/5 bg-[#171513]/10 px-2 text-white transition-[width,background-color,border-color] duration-[180ms] ease-out hover:w-[324px] hover:border-white/15 hover:bg-[rgba(23,21,19,0.96)]"
        onPointerEnter={() => resizeOverlay(true)}
        onPointerLeave={() => resizeOverlay(false)}
      >
        <button
          type="button"
          onPointerDown={() => {
            if (isTauri()) void getCurrentWindow().startDragging();
          }}
          className="invisible mr-0 flex h-8 w-0 shrink-0 cursor-grab items-center justify-center overflow-hidden rounded-full border border-white/15 bg-white/10 opacity-0 transition-[width,margin,opacity,background-color] duration-150 group-hover:visible group-hover:mr-2 group-hover:w-6 group-hover:opacity-100 hover:bg-white/15 active:cursor-grabbing"
          title="Drag to move overlay"
          aria-label="Move overlay"
        >
          <span className="flex flex-col gap-[3px]" aria-hidden="true">
            <span className="h-1 w-1 rounded-full bg-white/75" />
            <span className="h-1 w-1 rounded-full bg-white/75" />
            <span className="h-1 w-1 rounded-full bg-white/75" />
          </span>
        </button>

        <div
          data-testid="overlay-artwork"
          className={`relative h-11 w-11 shrink-0 overflow-hidden bg-white/5 opacity-35 transition-opacity duration-150 group-hover:opacity-100 ${state.spinningArtwork ? 'animate-[spin_8s_linear_infinite] rounded-full' : 'rounded-[13px]'}`}
          style={state.spinningArtwork ? { animationPlayState: state.isPlaying ? 'running' : 'paused' } : undefined}
        >
          {state.albumArt ? (
            <ArtworkImage src={state.albumArt} alt="" className="h-full w-full object-cover" loading="eager" decoding="async" forceReady pulse={false} />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[18px] font-semibold text-white/24">A</div>
          )}
          {state.spinningArtwork ? (
            <span className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/35 bg-black/65" />
          ) : null}
        </div>

        <div
          data-testid="overlay-details"
          className="invisible ml-0 min-w-0 max-w-0 flex-1 overflow-hidden px-0 opacity-0 transition-[max-width,margin,opacity] duration-150 group-hover:visible group-hover:ml-2 group-hover:max-w-[140px] group-hover:opacity-100"
        >
          <p className="truncate text-[11px] font-semibold tracking-[-0.01em] text-white/95">{state.title}</p>
          <p className="mt-0.5 truncate text-[10px] text-white/52">{state.artist}</p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <div className="invisible w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-150 group-hover:visible group-hover:w-8 group-hover:opacity-100">
            <OverlayButton label="Previous track" icon={prevIcon} onClick={() => void emitMainCommand('amply://overlay-prev')} />
          </div>
          <div className="opacity-35 transition-opacity duration-150 group-hover:opacity-100">
            <OverlayButton label={state.isPlaying ? 'Pause' : 'Play'} icon={state.isPlaying ? pauseIcon : playIcon} accent onClick={togglePlayback} />
          </div>
          <div className="invisible w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-150 group-hover:visible group-hover:w-8 group-hover:opacity-100">
            <OverlayButton label="Next track" icon={nextIcon} onClick={() => void emitMainCommand('amply://overlay-next')} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default OverlayPage;
