import { useEffect, useRef, useState } from 'react';
import { listen, emitTo } from '@tauri-apps/api/event';
import { getAllWebviewWindows } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, PhysicalSize } from '@tauri-apps/api/window';
import { isTauri } from '@/services/storageService';
import clsx from 'clsx';

interface OverlayState {
  title: string;
  artist: string;
  albumArt?: string | null;
  isPlaying: boolean;
}

const OverlayPage = () => {
  const [state, setState] = useState<OverlayState>({
    title: 'Nothing Playing',
    artist: 'Amply',
    albumArt: null,
    isPlaying: false,
  });
  const [isHovering, setIsHovering] = useState(false);
  const barRef = useRef<HTMLDivElement | null>(null);
  const targetLabelRef = useRef<string | null>('main');

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.background = 'transparent';
      document.body.style.background = 'transparent';
      document.body.style.margin = '0';
      document.body.style.padding = '0';
      document.body.style.overflow = 'hidden';
      document.documentElement.style.height = '100%';
      document.body.style.height = '100%';
      const root = document.getElementById('root');
      if (root) {
        root.style.background = 'transparent';
        root.style.height = '100%';
      }
    }
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    void getCurrentWindow().setBackgroundColor([0, 0, 0, 0]);
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    void (async () => {
      const windows = await getAllWebviewWindows();
      const target = windows.find((win) => win.label !== 'overlay')?.label ?? 'main';
      targetLabelRef.current = target;
    })();
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    const el = barRef.current;
    if (!el) {
      return;
    }

    const win = getCurrentWindow();
    let frame: number | null = null;

    const applySize = async () => {
      if (!barRef.current) {
        return;
      }
      const rect = barRef.current.getBoundingClientRect();
      const scale = await win.scaleFactor();
      const width = Math.max(1, Math.round(rect.width * scale));
      const height = Math.max(1, Math.round(rect.height * scale));
      const size = new PhysicalSize(width, height);
      await win.setSize(size);
      await win.setMinSize(size);
      await win.setMaxSize(size);
    };

    const schedule = () => {
      if (frame) {
        return;
      }
      frame = window.requestAnimationFrame(() => {
        frame = null;
        void applySize();
      });
    };

    void applySize();

    const observer = new ResizeObserver(() => schedule());
    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let unlisten: (() => void) | null = null;
    void (async () => {
      unlisten = await listen<OverlayState>('amply://overlay-state', (event) => {
        if (!event.payload) {
          return;
        }
        setState(event.payload);
      });
    })();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  return (
    <div className="pointer-events-auto flex h-full w-full items-start justify-start">
      <div
        ref={barRef}
        className="flex items-center gap-2 px-1 py-1 text-amply-textPrimary"
        style={{ opacity: isHovering ? 0.65 : 0.22 }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <button
          type="button"
          onMouseDown={() => {
            void getCurrentWindow().startDragging();
          }}
          className={clsx(
            'mr-1 flex h-7 w-4 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[9px] text-amply-textSecondary backdrop-blur-2xl transition-colors hover:bg-white/10',
          )}
          title="Drag to move"
        >
          ≡
        </button>

        <div className="relative h-10 w-10 shrink-0">
          <div
            className={clsx(
              'pointer-events-none absolute -right-3 -top-3 h-8 w-8 origin-[20%_20%] transition-transform duration-500',
              state.isPlaying ? 'rotate-12' : '-rotate-20',
            )}
          >
            <div className="absolute left-[14px] top-1 h-[18px] w-[2px] rounded-full bg-white/70 shadow-[0_0_6px_rgba(0,0,0,0.35)]" />
            <div className="absolute left-[10px] top-0 h-3 w-3 rounded-full border border-white/50 bg-white/10 backdrop-blur-sm" />
            <div className="absolute left-[13px] top-[18px] h-3 w-3 rounded-sm bg-white/70 shadow-[0_0_6px_rgba(0,0,0,0.35)]" />
          </div>
          <div className="absolute inset-0 rounded-full bg-white/8 shadow-[inset_0_0_6px_rgba(255,255,255,0.15)]" />
          <div
            className={clsx(
              'absolute inset-0 rounded-full border border-white/20',
              state.isPlaying ? 'animate-[spin_6s_linear_infinite]' : '',
            )}
          />
          <div className="absolute inset-1 overflow-hidden rounded-full bg-white/5 backdrop-blur-2xl">
            {state.albumArt ? (
              <img
                src={state.albumArt}
                alt=""
                className={clsx(
                  'h-full w-full object-cover transition-transform duration-700',
                  isHovering ? 'animate-[spin_12s_linear_infinite]' : state.isPlaying ? 'animate-[spin_6s_linear_infinite]' : '',
                )}
              />
            ) : null}
          </div>
          <div className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />
        </div>

        <div className="min-w-0 px-1">
          <p className="truncate text-[11px] font-medium text-amply-textPrimary/95">{state.title}</p>
          <p className="truncate text-[10px] text-amply-textSecondary/80">{state.artist}</p>
        </div>

        {isHovering ? (
          <>
            <button
              type="button"
              onClick={() => {
                const target = targetLabelRef.current ?? 'main';
                void emitTo(target, 'amply://overlay-prev');
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/6 text-[10px] text-amply-textSecondary backdrop-blur-2xl hover:bg-white/12"
              title="Previous"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => {
                const target = targetLabelRef.current ?? 'main';
                if (state.isPlaying) {
                  void emitTo(target, 'amply://overlay-pause');
                } else {
                  void emitTo(target, 'amply://overlay-play');
                }
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-amply-accent text-black shadow-glow transition-colors hover:bg-amply-accentHover"
              title="Play/Pause"
            >
              <span className="text-[10px] font-semibold">{state.isPlaying ? '||' : '>'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const target = targetLabelRef.current ?? 'main';
                void emitTo(target, 'amply://overlay-next');
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-white/6 text-[10px] text-amply-textSecondary backdrop-blur-2xl hover:bg-white/12"
              title="Next"
            >
              ›
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default OverlayPage;
