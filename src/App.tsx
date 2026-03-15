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
  const initializePlayer = usePlayerStore((state) => state.initialize);
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
