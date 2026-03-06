import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import Sidebar from '@/components/Sidebar/Sidebar';
import PlayerBar from '@/components/Player/PlayerBar';
import NowPlayingPanel from '@/components/NowPlayingPanel/NowPlayingPanel';
import HomePage from '@/pages/Home';
import LibraryPage from '@/pages/Library';
import NowPlayingPage from '@/pages/NowPlaying';
import SearchPage from '@/pages/Search';
import StatsPage from '@/pages/Stats';
import SettingsPage from '@/pages/Settings';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

const App = () => {
  const initializeLibrary = useLibraryStore((state) => state.initialize);
  const initializePlayer = usePlayerStore((state) => state.initialize);

  useEffect(() => {
    initializePlayer();
    initializeLibrary();
  }, [initializeLibrary, initializePlayer]);

  return (
    <div className="grid h-screen w-full grid-rows-[minmax(0,1fr)_90px] bg-amply-bgPrimary text-amply-textPrimary">
      <div className="grid min-h-0 grid-cols-[240px_minmax(0,1fr)_320px]">
        <Sidebar />
        <main className="min-w-0 overflow-y-auto bg-amply-bgSecondary px-6 pb-8 pt-6">
          <Routes>
            <Route path="/" element={<Navigate to="/home" replace />} />
            <Route path="/home" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/library" element={<LibraryPage />} />
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
