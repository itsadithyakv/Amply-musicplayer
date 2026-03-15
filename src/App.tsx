import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
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
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

const App = () => {
  const initializeLibrary = useLibraryStore((state) => state.initialize);
  const libraryInitialized = useLibraryStore((state) => state.initialized);
  const libraryScanning = useLibraryStore((state) => state.isScanning);
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);
  const initializePlayer = usePlayerStore((state) => state.initialize);
  const playerInitialized = usePlayerStore((state) => state.initialized);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);

  useEffect(() => {
    initializePlayer();
    initializeLibrary();
  }, [initializeLibrary, initializePlayer]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayPause();
        return;
      }

      if (event.code === 'ArrowRight' && event.shiftKey) {
        event.preventDefault();
        void playNext();
        return;
      }

      if (event.code === 'ArrowLeft' && event.shiftKey) {
        event.preventDefault();
        void playPrevious();
        return;
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault();
        const position = usePlayerStore.getState().positionSec;
        const duration = usePlayerStore.getState().durationSec;
        const nextPos = Math.min(duration || position + 5, position + 5);
        usePlayerStore.getState().seekTo(nextPos);
        return;
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault();
        const position = usePlayerStore.getState().positionSec;
        const nextPos = Math.max(0, position - 5);
        usePlayerStore.getState().seekTo(nextPos);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlayPause, playNext, playPrevious]);

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
      <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)_320px]">
        <Sidebar />
        <main className="min-w-0 overflow-y-auto bg-amply-bgSecondary px-8 pb-10 pt-8">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/now-playing" element={<NowPlayingPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
        <NowPlayingPanel />
      </div>
      <PlayerBar />
    </div>
  );
};

export default App;
