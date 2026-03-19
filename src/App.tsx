import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useOverlayController } from '@/hooks/useOverlayController';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useMediaSession } from '@/hooks/useMediaSession';
import Sidebar from '@/components/Sidebar/Sidebar';
import PlayerBar from '@/components/Player/PlayerBar';
import NowPlayingPanel from '@/components/NowPlayingPanel/NowPlayingPanel';
import HomePage from '@/pages/Home';
import LibraryPage from '@/pages/Library';
import PlaylistsPage from '@/pages/Playlists';
import NowPlayingPage from '@/pages/NowPlaying';
import SearchPage from '@/pages/Search';
import StatsPage from '@/pages/Stats';
import SettingsPage from '@/pages/Settings';
import OverlayPage from '@/pages/Overlay';
import GameModePage from '@/pages/GameMode';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { flushDebouncedWrites } from '@/services/storageService';

const App = () => {
  const initializeLibrary = useLibraryStore((state) => state.initialize);
  const libraryInitialized = useLibraryStore((state) => state.initialized);
  const libraryScanning = useLibraryStore((state) => state.isScanning);
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);
  const initializePlayer = usePlayerStore((state) => state.initialize);
  const playerInitialized = usePlayerStore((state) => state.initialized);
  const settings = usePlayerStore((state) => state.settings);
  const location = useLocation();
  const navigate = useNavigate();

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
    };
  }, []);

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
        <div className="relative w-full max-w-md rounded-2xl border border-amply-border/60 bg-amply-surface/90 p-6 text-center shadow-card">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amply-surface shadow-glow">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-amply-border border-t-amply-accent" />
          </div>
          <h1 className="text-[20px] font-semibold">Amply</h1>
          <p className="mt-1 text-[12px] text-amply-textSecondary">
            {libraryScanning ? 'Scanning your library...' : 'Preparing your library...'}
          </p>
          {metadataFetch.running ? (
            <p className="mt-2 text-[11px] text-amply-textMuted">
              {metadataFetch.done}/{metadataFetch.total} cached
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell grid h-screen w-full grid-rows-[minmax(0,1fr)_84px] text-amply-textPrimary">
      <div className={`grid min-h-0 ${settings.gameMode ? 'grid-cols-1' : 'grid-cols-[240px_minmax(0,1fr)_320px]'}`}>
        {settings.gameMode ? null : <Sidebar />}
        <main className="min-w-0 overflow-y-auto bg-amply-bgSecondary px-6 pb-8 pt-6 xl:px-8 xl:pb-10 xl:pt-8">
          {settings.gameMode ? (
            <Routes>
              <Route path="/game" element={<GameModePage />} />
              <Route path="*" element={<Navigate to="/game" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="/home" element={<HomePage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/playlists" element={<PlaylistsPage />} />
              <Route path="/now-playing" element={<NowPlayingPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          )}
        </main>
        {settings.gameMode ? null : <NowPlayingPanel />}
      </div>
      <PlayerBar />
    </div>
  );
};

export default App;
