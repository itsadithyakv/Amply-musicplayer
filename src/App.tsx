import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { useOverlayController } from '@/hooks/useOverlayController';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useMediaSession } from '@/hooks/useMediaSession';
import { useFpsMonitor } from '@/hooks/useFpsMonitor';
import Sidebar from '@/components/Sidebar/Sidebar';
import PlayerBar from '@/components/Player/PlayerBar';
import NowPlayingPanel from '@/components/NowPlayingPanel/NowPlayingPanel';
import HomePage from '@/pages/Home';
import LibraryPage from '@/pages/Library';
import PlaylistsPage from '@/pages/Playlists';
import PlaylistDetailPage from '@/pages/PlaylistDetail';
import NowPlayingPage from '@/pages/NowPlaying';
import SearchPage from '@/pages/Search';
const StatsPage = lazy(() => import('@/pages/Stats'));
const SettingsPage = lazy(() => import('@/pages/Settings'));
import OverlayPage from '@/pages/Overlay';
import GameModePage from '@/pages/GameMode';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { flushDebouncedWrites } from '@/services/storageService';
import { warmSearchIndex } from '@/utils/search';

const App = () => {
  const initializeLibrary = useLibraryStore((state) => state.initialize);
  const libraryInitialized = useLibraryStore((state) => state.initialized);
  const libraryScanning = useLibraryStore((state) => state.isScanning);
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);
  const startMetadataFetch = useLibraryStore((state) => state.startMetadataFetch);
  const albumTrackFetch = useLibraryStore((state) => state.albumTrackFetch);
  const startAlbumTracklistFetch = useLibraryStore((state) => state.startAlbumTracklistFetch);
  const songsCount = useLibraryStore((state) => state.songs.length);
  const initializePlayer = usePlayerStore((state) => state.initialize);
  const playerInitialized = usePlayerStore((state) => state.initialized);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const settings = usePlayerStore((state) => state.settings);
  const location = useLocation();
  const navigate = useNavigate();
  const lastIdleFetchRef = useRef(0);
  const lastAlbumIdleFetchRef = useRef(0);
  const lastUserInputRef = useRef(0);
  const searchWarmRef = useRef<string | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const { lowPerf } = useFpsMonitor();

  const isOverlayRoute =
    location.pathname === '/overlay' ||
    (typeof window !== 'undefined' && window.location.hash?.includes('/overlay'));

  if (isOverlayRoute) {
    return <OverlayPage />;
  }

  useEffect(() => {
    initializePlayer();
    initializeLibrary();
  }, [initializeLibrary, initializePlayer]);

  useEffect(() => {
    return;
  }, []);

  useOverlayController(settings.miniNowPlayingOverlay);
  useMediaSession();
  useGlobalShortcuts();

  useEffect(() => {
    const handleUnload = () => {
      void flushDebouncedWrites();
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    const idle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }).requestIdleCallback;
    const cancelIdle = (globalThis as typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback;

    const scheduleFlush = () => {
      if (!alive) {
        return;
      }
      if (typeof idle === 'function') {
        idleHandle = idle(() => {
          void flushDebouncedWrites();
        }, { timeout: 2000 });
      } else {
        void flushDebouncedWrites();
      }
    };

    const interval = window.setInterval(scheduleFlush, 5000);
    scheduleFlush();

    return () => {
      alive = false;
      window.clearInterval(interval);
      if (idleHandle !== null && typeof cancelIdle === 'function') {
        cancelIdle(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, []);

  useEffect(() => {
    const markInput = () => {
      const now = Date.now();
      lastUserInputRef.current = now;
      (window as unknown as { __AMP_LAST_INTERACTION__?: number }).__AMP_LAST_INTERACTION__ = now;
    };
    markInput();
    window.addEventListener('pointerdown', markInput);
    window.addEventListener('keydown', markInput);
    window.addEventListener('wheel', markInput, { passive: true });
    window.addEventListener('resize', markInput);
    document.addEventListener('fullscreenchange', markInput);
    return () => {
      window.removeEventListener('pointerdown', markInput);
      window.removeEventListener('keydown', markInput);
      window.removeEventListener('wheel', markInput);
      window.removeEventListener('resize', markInput);
      document.removeEventListener('fullscreenchange', markInput);
    };
  }, []);

  useEffect(() => {
    if (settings.gameMode) {
      return;
    }
    const node = mainScrollRef.current;
    if (!node) {
      return;
    }

    const key = `amply-scroll:${location.pathname}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      const value = Number(saved);
      if (Number.isFinite(value)) {
        node.scrollTop = value;
      }
    } else {
      node.scrollTop = 0;
    }

    let raf = 0;
    const onScroll = () => {
      if (raf) {
        return;
      }
      raf = window.requestAnimationFrame(() => {
        sessionStorage.setItem(key, String(node.scrollTop));
        raf = 0;
      });
    };

    node.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      node.removeEventListener('scroll', onScroll);
      if (raf) {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [location.pathname, settings.gameMode]);

  useEffect(() => {
    if (!songsCount || libraryScanning) {
      return;
    }
    const library = useLibraryStore.getState().songs;
    const fingerprint = `${library.length}:${library[0]?.id ?? 'none'}:${library[library.length - 1]?.id ?? 'none'}`;
    if (searchWarmRef.current === fingerprint) {
      return;
    }
    searchWarmRef.current = fingerprint;
    let alive = true;
    let idleHandle: number | null = null;
    let timeoutHandle: number | null = null;
    const idle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }).requestIdleCallback;
    const cancelIdle = (globalThis as typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback;
    let index = 0;

    const runChunk = () => {
      if (!alive) {
        return;
      }
      index = warmSearchIndex(library, index, 500);
      if (index < library.length) {
        schedule();
      }
    };

    const schedule = () => {
      if (typeof idle === 'function') {
        idleHandle = idle(() => runChunk(), { timeout: 1200 });
      } else {
        timeoutHandle = window.setTimeout(runChunk, 100);
      }
    };

    schedule();
    return () => {
      alive = false;
      if (idleHandle !== null && typeof cancelIdle === 'function') {
        cancelIdle(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [songsCount, libraryScanning]);

  useEffect(() => {
    (window as unknown as { __AMP_LOW_PERF__?: boolean }).__AMP_LOW_PERF__ = lowPerf || settings.gameMode;
    (window as unknown as { __AMP_GAME_MODE__?: boolean }).__AMP_GAME_MODE__ = settings.gameMode;
  }, [lowPerf, settings.gameMode]);

  useEffect(() => {
    let alive = true;
    let idleHandle: number | null = null;
    let interval: number | null = null;
    let timeoutHandle: number | null = null;
    const idle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: (deadline: { timeRemaining: () => number }) => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }).requestIdleCallback;
    const cancelIdle = (globalThis as typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback;

    const scheduleIdleFetch = () => {
      if (!alive) {
        return;
      }
      if (typeof idle === 'function') {
        idleHandle = idle((deadline) => {
          if (!alive) {
            return;
          }
          if (deadline.timeRemaining() < 50) {
            return;
          }
          runFetch();
        }, { timeout: 6000 });
      } else {
        timeoutHandle = window.setTimeout(runFetch, 3000);
      }
    };

    const runFetch = () => {
      if (!alive) {
        return;
      }
      if (
        settings.gameMode ||
        settings.metadataFetchPaused ||
        libraryScanning ||
        metadataFetch.running ||
        isPlaying ||
        !songsCount ||
        !metadataFetch.pending
      ) {
        return;
      }
      if (lowPerf) {
        return;
      }
      if (document.hidden) {
        return;
      }
      if (Date.now() - lastUserInputRef.current < 45_000) {
        return;
      }
      const now = Date.now();
      if (now - lastIdleFetchRef.current < 10 * 60_000) {
        return;
      }
      lastIdleFetchRef.current = now;
      startMetadataFetch();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        return;
      }
      scheduleIdleFetch();
    };

    scheduleIdleFetch();
    interval = window.setInterval(scheduleIdleFetch, 15_000);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      alive = false;
      if (interval !== null) {
        window.clearInterval(interval);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      if (idleHandle !== null && typeof cancelIdle === 'function') {
        cancelIdle(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [settings.gameMode, libraryScanning, metadataFetch.running, isPlaying, songsCount, startMetadataFetch, lowPerf]);

  useEffect(() => {
    let alive = true;
    let idleHandle: number | null = null;
    let interval: number | null = null;
    let timeoutHandle: number | null = null;
    const idle = (globalThis as typeof globalThis & {
      requestIdleCallback?: (cb: (deadline: { timeRemaining: () => number }) => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    }).requestIdleCallback;
    const cancelIdle = (globalThis as typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
    }).cancelIdleCallback;

    const scheduleIdleFetch = () => {
      if (!alive) {
        return;
      }
      if (typeof idle === 'function') {
        idleHandle = idle((deadline) => {
          if (!alive) {
            return;
          }
          if (deadline.timeRemaining() < 60) {
            return;
          }
          runFetch();
        }, { timeout: 8000 });
      } else {
        timeoutHandle = window.setTimeout(runFetch, 4000);
      }
    };

    const runFetch = () => {
      if (!alive) {
        return;
      }
      if (
        settings.gameMode ||
        settings.metadataFetchPaused ||
        libraryScanning ||
        metadataFetch.running ||
        albumTrackFetch.running ||
        isPlaying ||
        !songsCount ||
        !albumTrackFetch.pending
      ) {
        return;
      }
      if (lowPerf) {
        return;
      }
      if (document.hidden) {
        return;
      }
      if (Date.now() - lastUserInputRef.current < 60_000) {
        return;
      }
      const now = Date.now();
      if (now - lastAlbumIdleFetchRef.current < 30 * 60_000) {
        return;
      }
      lastAlbumIdleFetchRef.current = now;
      startAlbumTracklistFetch();
    };

    const handleVisibility = () => {
      if (document.hidden) {
        return;
      }
      scheduleIdleFetch();
    };

    scheduleIdleFetch();
    interval = window.setInterval(scheduleIdleFetch, 20_000);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      alive = false;
      if (interval !== null) {
        window.clearInterval(interval);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      if (idleHandle !== null && typeof cancelIdle === 'function') {
        cancelIdle(idleHandle);
      }
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
  }, [
    settings.gameMode,
    settings.metadataFetchPaused,
    libraryScanning,
    metadataFetch.running,
    albumTrackFetch.running,
    isPlaying,
    songsCount,
    startAlbumTracklistFetch,
    lowPerf,
  ]);

  useEffect(() => {
    if (settings.gameMode && location.pathname !== '/game') {
      navigate('/game', { replace: true });
      return;
    }

    if (!settings.gameMode && location.pathname === '/game') {
      navigate('/home', { replace: true });
    }
  }, [settings.gameMode, location.pathname, navigate]);

  const isLoading = !libraryInitialized || !playerInitialized;

  if (isLoading) {
    return (
      <div className="app-shell flex h-screen w-full items-center justify-center bg-amply-bgPrimary text-amply-textPrimary">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-amply-border border-t-amply-accent" />
          <p className="text-[12px] text-amply-textMuted">
            {libraryScanning ? 'Scanning library…' : 'Starting…'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell grid h-screen w-full grid-rows-[minmax(0,1fr)_84px] text-amply-textPrimary">
      <div className={`grid min-h-0 ${settings.gameMode ? 'grid-cols-1' : 'grid-cols-[240px_minmax(0,1fr)_320px]'}`}>
        {settings.gameMode ? null : <Sidebar />}
        <main
          ref={mainScrollRef}
          className="min-w-0 overflow-y-auto bg-amply-bgSecondary px-6 pb-8 pt-6 xl:px-8 xl:pb-10 xl:pt-8"
        >
          {settings.gameMode ? (
            <Routes>
              <Route path="/game" element={<GameModePage />} />
              <Route path="*" element={<Navigate to="/game" replace />} />
            </Routes>
          ) : (
            <Suspense
              fallback={
                <div className="rounded-2xl border border-amply-border/60 bg-amply-surface p-4 text-[12px] text-amply-textMuted">
                  Loading view...
                </div>
              }
            >
              <Routes>
                <Route path="/" element={<Navigate to="/home" replace />} />
                <Route path="/home" element={<HomePage />} />
                <Route path="/search" element={<SearchPage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/playlists" element={<PlaylistsPage />} />
                <Route path="/playlist/:playlistId" element={<PlaylistDetailPage />} />
                <Route path="/now-playing" element={<NowPlayingPage />} />
                <Route path="/stats" element={<StatsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/home" replace />} />
              </Routes>
            </Suspense>
          )}
        </main>
        {settings.gameMode ? null : <NowPlayingPanel />}
      </div>
      <PlayerBar />
    </div>
  );
};

export default App;
