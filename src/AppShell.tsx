import { useThemeSync } from '@/hooks/useThemeSync';
import { setFlags } from '@/services/runtimeFlags';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Spinner } from '@/components/ui/Spinner';
import { Toast } from '@/components/ui/Toast';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useOverlayController } from '@/hooks/useOverlayController';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useFpsMonitor } from '@/hooks/useFpsMonitor';
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary';
const Sidebar = lazy(() => import('@/components/Sidebar/Sidebar'));
const PlayerBar = lazy(() => import('@/components/Player/PlayerBar'));
const NowPlayingPanel = lazy(() => import('@/components/NowPlayingPanel/NowPlayingPanel'));
const HomePage = lazy(() => import('@/pages/Home'));
const LibraryPage = lazy(() => import('@/pages/Library'));
const PlaylistsPage = lazy(() => import('@/pages/Playlists'));
const PlaylistDetailPage = lazy(() => import('@/pages/PlaylistDetail'));
const NowPlayingPage = lazy(() => import('@/pages/NowPlaying'));
const SearchPage = lazy(() => import('@/pages/Search'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
import GameModePage from '@/pages/GameMode';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { flushPendingWrites, hasPendingDebouncedWrites, readStorageText, writeStorageText } from '@/services/storageService';
import { isTauri } from '@/services/storageService';
import {
  markWindowRestored,
  noteUserInteraction,
  scheduleNonCriticalTask,
  setSchedulerFocused,
  setSchedulerMinimized,
  setSchedulerPlayingBusy,
  setSchedulerVisibility,
  shouldThrottleNonCriticalWork,
  useSchedulerRenderState,
} from '@/services/appScheduler';
import {
  endPerfMeasure,
  getPerformanceSnapshot,
  hydratePerfDiagnostics,
  markPerf,
  recordBudgetLatency,
  recordPerfEvent,
} from '@/services/perfDiagnostics';
import { beginInteractionFeedback, useInteractionFeedback } from '@/services/interactionFeedback';
import { scheduleAfterPaint, settleTrackedInteraction } from '@/services/interactionTrace';
import {
  getStartupSafetyState,
  initializeSafeMode,
  markStartupReady,
  requestSafeModeNextStart,
} from '@/services/safeModeService';
import { pauseBackground, resumeBackground } from '@/services/playbackScheduler';
import { getLibraryVersions } from '@/store/libraryDataStore';

const shellRouteSet = new Set<string>(['/home', '/search', '/library', '/playlists', '/now-playing', '/settings']);

const ShellFallback = ({ label }: { label: string }) => (
  <div className="flex h-full min-h-[120px] items-center justify-center p-4 text-center text-[12px] text-amply-textSecondary">{label}</div>
);

const RouteFallback = () => (
  <Card padding="lg" className="text-[13px] text-amply-textSecondary">
    This view could not be rendered. Switch routes and come back, or restart Amply if it keeps happening.
  </Card>
);

const recordUiError = (surface: string, error: Error): void => {
  recordPerfEvent('app.ui-error', {
    surface,
    message: error.message,
  });
  void requestSafeModeNextStart(`ui-error:${surface}`);
};

const AppShell = () => {
  const initializeLibrary = useLibraryStore((state) => state.initialize);
  const libraryInitialized = useLibraryStore((state) => state.initialized);
  const libraryScanning = useLibraryStore((state) => state.isScanning);
  const initializePlayer = usePlayerStore((state) => state.initialize);
  const playerInitialized = usePlayerStore((state) => state.initialized);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const miniNowPlayingOverlay = usePlayerStore((state) => state.settings.miniNowPlayingOverlay);
  const toastMessage = usePlayerStore((state) => state.toastMessage);
  const location = useLocation();
  const navigate = useNavigate();
  const lastUserInputRef = useRef(0);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const startupAtRef = useRef(Date.now());
  const routeStartedAtRef = useRef(Date.now());
  const initialRoutePaintedRef = useRef(false);
  const [startupLowMemoryMode, setStartupLowMemoryMode] = useState(() => getStartupSafetyState().lowMemoryMode);
  const [heavyPanelsReady, setHeavyPanelsReady] = useState(() => !getStartupSafetyState().lowMemoryMode);
  const schedulerState = useSchedulerRenderState();
  const interactionFeedback = useInteractionFeedback();
  const isOverlayRoute = false;
  const pathname = location.pathname;
  const isPlaylistDetailRoute = pathname.startsWith('/playlist/');
  const isKnownShellRoute = shellRouteSet.has(pathname);
  const schedulerThrottled =
    schedulerState.visibility === 'hidden' ||
    schedulerState.minimized ||
    shouldThrottleNonCriticalWork();
  const { lowPerf } = useFpsMonitor({
    enabled: !gameMode && !isOverlayRoute && !schedulerThrottled,
  });

  useEffect(() => {
    let resumeSafeModeHandle: number | null = null;
    let alive = true;
    void hydratePerfDiagnostics();
    void initializeSafeMode().then((safeMode) => {
      if (!alive) {
        return;
      }
      const safety = getStartupSafetyState();
      setStartupLowMemoryMode(safety.lowMemoryMode);
      if (safety.lowMemoryMode) {
        const reason = safety.safeMode ? 'safe-mode-startup' : 'constrained-device-startup';
        pauseBackground(reason);
        recordPerfEvent('app.low-memory-startup', {
          reason: safety.reason,
          deviceMemoryGb: safety.deviceMemoryGb,
          hardwareConcurrency: safety.hardwareConcurrency,
        });
        resumeSafeModeHandle = window.setTimeout(() => resumeBackground(reason), safeMode ? 18_000 : 28_000);
      }
    });
    markPerf('app.mount');
    const raf = window.requestAnimationFrame(() => {
      recordPerfEvent('app.first-frame');
    });
    return () => {
      alive = false;
      if (resumeSafeModeHandle !== null) {
        window.clearTimeout(resumeSafeModeHandle);
      }
      window.cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!startupLowMemoryMode) {
      setHeavyPanelsReady(true);
      return;
    }
    const handle = window.setTimeout(() => {
      setHeavyPanelsReady(true);
      recordPerfEvent('app.low-memory-heavy-panels-ready');
    }, 10_000);
    return () => window.clearTimeout(handle);
  }, [startupLowMemoryMode]);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined') {
      return;
    }
    window.__AMPLY_DEBUG__ = { getPerfSnapshot: getPerformanceSnapshot, getLibraryVersions };
    return () => {
      delete window.__AMPLY_DEBUG__;
    };
  }, []);

  useEffect(() => {
    initializePlayer();
    initializeLibrary();
  }, [initializeLibrary, initializePlayer]);

  useThemeSync();
  useOverlayController(miniNowPlayingOverlay);
  useMediaSession();
  useGlobalShortcuts();

  useEffect(() => {
    if (!libraryInitialized || !playerInitialized) {
      return;
    }
    endPerfMeasure('app.mount', {
      libraryInitialized,
      playerInitialized,
      startupMs: Date.now() - startupAtRef.current,
    });
    recordPerfEvent('app.ready', {
      startupMs: Date.now() - startupAtRef.current,
    });
    void markStartupReady();
  }, [libraryInitialized, playerInitialized]);

  useEffect(() => {
    routeStartedAtRef.current = performance.now();
    recordPerfEvent('app.route', { route: location.pathname });
  }, [location.pathname]);

  useEffect(() => {
    const startedAt = routeStartedAtRef.current;
    let cancelled = false;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        if (!cancelled) {
          recordBudgetLatency('route-switch', performance.now() - startedAt, 700);
        }
      });
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(first);
      if (second) {
        window.cancelAnimationFrame(second);
      }
    };
  }, [pathname]);

  useEffect(() => {
    if (!initialRoutePaintedRef.current) {
      initialRoutePaintedRef.current = true;
      return;
    }

    const endFeedback = beginInteractionFeedback({
      delayMs: 0,
      minVisibleMs: 140,
      message: 'Loading view...',
    });
    let cancelled = false;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        if (!cancelled) {
          endFeedback();
        }
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(first);
      if (second) {
        window.cancelAnimationFrame(second);
      }
      endFeedback();
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== '/now-playing') {
      return;
    }
    return scheduleAfterPaint(() => {
      settleTrackedInteraction('route:now-playing', { route: pathname });
    });
  }, [pathname]);

  useEffect(() => {
    if (gameMode && pathname !== '/game') {
      navigate('/game', { replace: true });
      return;
    }
    if (gameMode || isOverlayRoute) {
      return;
    }
    if (pathname === '/') {
      navigate('/home', { replace: true });
      return;
    }
    if (!isKnownShellRoute && !isPlaylistDetailRoute) {
      navigate('/home', { replace: true });
    }
  }, [gameMode, isKnownShellRoute, isOverlayRoute, isPlaylistDetailRoute, navigate, pathname]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      setSchedulerVisibility(document.visibilityState);
    }
    const handleFocus = () => setSchedulerFocused(true);
    const handleBlur = () => setSchedulerFocused(false);
    const markInput = () => {
      const now = Date.now();
      lastUserInputRef.current = now;
      setFlags({ lastInteractionAt: now });
      noteUserInteraction();
    };
    const handleVisibility = () => {
      setSchedulerVisibility(document.visibilityState);
      if (document.visibilityState === 'visible') {
        markWindowRestored('document-visible');
      }
    };
    markInput();
    window.addEventListener('pointerdown', markInput);
    window.addEventListener('keydown', markInput);
    window.addEventListener('wheel', markInput, { passive: true });
    window.addEventListener('resize', markInput);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('fullscreenchange', markInput);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('pointerdown', markInput);
      window.removeEventListener('keydown', markInput);
      window.removeEventListener('wheel', markInput);
      window.removeEventListener('resize', markInput);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
      document.removeEventListener('fullscreenchange', markInput);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  useEffect(() => {
    if (!isTauri() || isOverlayRoute) {
      return;
    }
    let alive = true;
    const currentWindow = getCurrentWindow();
    const unlisten: Array<() => void> = [];

    const syncWindowState = async () => {
      if (!alive) {
        return;
      }
      try {
        const [minimized, visible] = await Promise.all([currentWindow.isMinimized(), currentWindow.isVisible()]);
        setSchedulerMinimized(Boolean(minimized));
        if (visible) {
          markWindowRestored('window-visible');
        } else {
          setSchedulerVisibility('hidden');
        }
      } catch {
        // Ignore transient window query failures.
      }
    };

    void (async () => {
      unlisten.push(await currentWindow.onFocusChanged(({ payload }) => setSchedulerFocused(payload)));
      unlisten.push(await currentWindow.onResized(() => void syncWindowState()));
      unlisten.push(await currentWindow.onMoved(() => void syncWindowState()));
      await syncWindowState();
    })();

    const interval = window.setInterval(() => {
      void syncWindowState();
    }, 2000);

    return () => {
      alive = false;
      window.clearInterval(interval);
      unlisten.forEach((fn) => fn());
    };
  }, [isOverlayRoute]);

  useEffect(() => {
    setSchedulerPlayingBusy(isPlaying);
  }, [isPlaying]);

  useEffect(() => {
    const restoreAt = schedulerState.lastRestoreAt;
    if (!restoreAt) {
      return;
    }
    const remaining = Math.max(0, schedulerState.restoreGraceUntil - Date.now());
    const handle = window.setTimeout(() => {
      recordPerfEvent('window.restore-interactive', {
        restoreStartedAt: restoreAt,
        restoreLatencyMs: Date.now() - restoreAt,
      });
    }, remaining);
    return () => {
      window.clearTimeout(handle);
    };
  }, [schedulerState.lastRestoreAt, schedulerState.restoreGraceUntil]);

  useEffect(() => {
    const flushWrites = () => {
      void flushPendingWrites();
    };
    const handleVisibilityFlush = () => {
      if (document.visibilityState === 'hidden') {
        flushWrites();
      }
    };

    window.addEventListener('beforeunload', flushWrites);
    window.addEventListener('pagehide', flushWrites);
    document.addEventListener('visibilitychange', handleVisibilityFlush);
    return () => {
      window.removeEventListener('beforeunload', flushWrites);
      window.removeEventListener('pagehide', flushWrites);
      document.removeEventListener('visibilitychange', handleVisibilityFlush);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let cancelScheduled: (() => void) | null = null;

    const scheduleFlush = () => {
      if (!alive) {
        return;
      }
      if (!hasPendingDebouncedWrites()) {
        return;
      }
      if (schedulerThrottled) {
        return;
      }
      const recentlyActive = Date.now() - lastUserInputRef.current < 12_000;
      if (!document.hidden && recentlyActive) {
        return;
      }
      cancelScheduled?.();
      cancelScheduled = scheduleNonCriticalTask(
        () => {
          void flushPendingWrites();
        },
        { timeoutMs: 4000, reason: 'flush-debounced-writes' },
      );
    };

    const interval = window.setInterval(scheduleFlush, 20_000);

    return () => {
      alive = false;
      window.clearInterval(interval);
      cancelScheduled?.();
    };
  }, [schedulerThrottled]);

  useEffect(() => {
    if (gameMode) {
      return;
    }
    const node = mainScrollRef.current;
    if (!node) {
      return;
    }

    const key = `scroll/${encodeURIComponent(location.pathname)}.txt`;
    let alive = true;
    let saveTimeout: number | null = null;
    let lastSavedScrollTop = node.scrollTop;

    const restoreScroll = async () => {
      const saved = await readStorageText(key);
      if (!alive || !node) {
        return;
      }
      if (saved) {
        const value = Number(saved);
        if (Number.isFinite(value)) {
          node.scrollTop = value;
          lastSavedScrollTop = value;
          return;
        }
      }
      node.scrollTop = 0;
      lastSavedScrollTop = 0;
    };

    const saveScrollPosition = () => {
      saveTimeout = null;
      if (!node) {
        return;
      }
      const currentScroll = node.scrollTop;
      if (currentScroll === lastSavedScrollTop) {
        return;
      }
      lastSavedScrollTop = currentScroll;
      void writeStorageText(key, String(currentScroll));
    };

    const onScroll = () => {
      if (saveTimeout !== null) {
        window.clearTimeout(saveTimeout);
      }
      saveTimeout = window.setTimeout(saveScrollPosition, 200);
    };

    void restoreScroll();
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      alive = false;
      node.removeEventListener('scroll', onScroll);
      if (saveTimeout !== null) {
        window.clearTimeout(saveTimeout);
      }
      if (node) {
        void writeStorageText(key, String(node.scrollTop));
      }
    };
  }, [location.pathname, gameMode]);

  useEffect(() => {
    setFlags({ lowPerf: lowPerf || gameMode || startupLowMemoryMode });
    setFlags({ gameMode: gameMode });
  }, [lowPerf, gameMode, startupLowMemoryMode]);

  const isLoading = !playerInitialized;

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-amply-bg text-amply-textPrimary">
        <div className="flex flex-col items-center gap-3 text-center">
          <Spinner size={24} />
          <p className="text-[12px] text-amply-textSecondary">
            {libraryScanning ? 'Scanning library...' : 'Starting...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative grid h-screen w-full grid-rows-[minmax(0,1fr)_var(--player-bar-height)] bg-amply-bg text-amply-textPrimary">
      <div
        className={`grid min-h-0 ${
          gameMode
            ? 'grid-cols-1'
            : 'grid-cols-[var(--sidebar-w-collapsed)_minmax(0,1fr)] lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)_320px]'
        }`}
      >
        {gameMode ? null : (
          <ErrorBoundary
            fallback={<ShellFallback label="Sidebar unavailable." />}
            onError={(error) => recordUiError('sidebar', error)}
          >
              <Suspense fallback={<div className="bg-amply-bg" />}>
                <Sidebar />
              </Suspense>
          </ErrorBoundary>
        )}
        <main
          ref={mainScrollRef}
          className="min-w-0 overflow-y-auto overflow-x-hidden bg-amply-bg px-4 pb-8 pt-5 sm:px-6 sm:pt-6 xl:px-8 xl:pb-10 xl:pt-8"
        >
          {gameMode ? (
            <ErrorBoundary
              resetKey={pathname}
              fallback={<RouteFallback />}
              onError={(error) => recordUiError('game-route', error)}
            >
              <div key={pathname} className="anim-page">
                <Routes>
                  <Route path="/game" element={<GameModePage />} />
                </Routes>
              </div>
            </ErrorBoundary>
          ) : (
            <ErrorBoundary
              resetKey={pathname}
              fallback={<RouteFallback />}
              onError={(error) => recordUiError(`route:${pathname}`, error)}
            >
              <Suspense
                fallback={
                  <Card padding="md" className="text-[12px] text-amply-textSecondary">
                    Loading view…
                  </Card>
                }
              >
                <div key={pathname} className="anim-page">
                  <Routes>
                    <Route path="/" element={<Navigate to="/home" replace />} />
                  <Route path="/home" element={<HomePage />} />
                  <Route path="/search" element={<SearchPage />} />
                  <Route path="/library" element={<LibraryPage />} />
                  <Route path="/playlists" element={<PlaylistsPage />} />
                  <Route path="/playlist/:playlistId" element={<PlaylistDetailPage />} />
                  <Route path="/now-playing" element={<NowPlayingPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  </Routes>
                </div>
              </Suspense>
            </ErrorBoundary>
          )}
        </main>
        {gameMode ? null : (
          <ErrorBoundary
            fallback={<ShellFallback label="Track details unavailable." />}
            onError={(error) => recordUiError('now-playing-panel', error)}
          >
            <Suspense fallback={<div className="hidden bg-amply-bg lg:block" />}>
              <div className="hidden min-h-0 lg:block">
              {heavyPanelsReady ? (
                <NowPlayingPanel />
              ) : (
                <div className="h-full bg-amply-bg" />
              )}
              </div>
            </Suspense>
          </ErrorBoundary>
        )}
      </div>
      <ErrorBoundary
        fallback={<ShellFallback label="Player controls unavailable." />}
        onError={(error) => recordUiError('player-bar', error)}
      >
        <Suspense fallback={<div className="neu-raised-top" />}>
          <PlayerBar />
        </Suspense>
      </ErrorBoundary>
      {!libraryInitialized ? (
        <div className="pointer-events-none absolute inset-0 z-shell flex items-center justify-center bg-amply-bg/70">
          <div className="neu-raised flex items-center gap-3 rounded-lg px-5 py-4 text-[12px] text-amply-textSecondary">
            <Spinner size={16} />
            <span>Loading library…</span>
          </div>
        </div>
      ) : null}
      {interactionFeedback.visible ? (
        <div className="pointer-events-none absolute inset-0 z-feedback flex items-center justify-center bg-amply-bg/40">
          <div className="neu-raised flex items-center gap-2 rounded-full px-4 py-2 text-[12px] text-amply-textPrimary">
            <Spinner size={14} />
            <span>{interactionFeedback.message ?? 'Loading…'}</span>
          </div>
        </div>
      ) : null}
      {toastMessage ? (
        <Toast>{toastMessage}</Toast>
      ) : null}
    </div>
  );
};

export default AppShell;
