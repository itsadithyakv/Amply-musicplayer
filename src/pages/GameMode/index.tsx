import { useMemo } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

const GameModePage = () => {
  const songs = useLibraryStore((state) => state.songs);
  const playlists = useLibraryStore((state) => state.playlists);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setGameMode = usePlayerStore((state) => state.setGameMode);

  const items = useMemo(
    () =>
      playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        count: playlist.songIds.length,
        songIds: playlist.songIds,
      })),
    [playlists],
  );

  const playPlaylist = async (songIds: string[]) => {
    const queue = songIds.filter((songId) => songs.some((song) => song.id === songId));
    const first = queue[0];
    if (!first) {
      return;
    }
    setQueue(queue, first);
    await playSongById(first, false);
  };

  return (
    <div className="flex w-full flex-col gap-5 pb-8">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-amply-border/60 bg-amply-surface/70 px-5 py-4 shadow-card">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-amply-border/60 bg-amply-bgSecondary px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amply-textMuted">
            Game Mode
          </div>
          <h1 className="text-[20px] font-semibold tracking-tight text-amply-textPrimary">Lean Library</h1>
          <p className="text-[12px] text-amply-textSecondary">Only playlists and playback controls. No background fetch.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            void setGameMode(false);
          }}
          className="rounded-full border border-amply-border/60 px-4 py-2 text-[12px] font-medium text-amply-textSecondary transition-colors hover:bg-amply-hover hover:text-amply-textPrimary"
        >
          Exit Game Mode
        </button>
      </header>

      <section className="rounded-2xl border border-amply-border/60 bg-amply-bgSecondary/40 p-2">
        {items.length === 0 ? (
          <div className="rounded-xl border border-amply-border/60 bg-amply-surface px-4 py-4 text-[12px] text-amply-textMuted">
            No playlists yet. Create one in normal mode.
          </div>
        ) : (
          <div className="divide-y divide-amply-border/40">
            {items.map((playlist) => (
              <div key={playlist.id} className="flex items-center justify-between gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-amply-textPrimary">{playlist.name}</p>
                  <p className="text-[11px] text-amply-textMuted">{playlist.count} songs</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void playPlaylist(playlist.songIds);
                  }}
                  className="rounded-full bg-amply-accent px-4 py-2 text-[11px] font-semibold text-black transition-colors hover:bg-amply-accentHover"
                >
                  Play
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default GameModePage;
