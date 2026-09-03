import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Surface } from '@/components/ui/Surface';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useHomeView } from '@/hooks/useLibraryViews';

const GameModePage = () => {
  const { allSongIds, playlists } = useHomeView();
  const recordPlaylistUse = useLibraryStore((state) => state.recordPlaylistUse);
  const setQueue = usePlayerStore((state) => state.setQueue);
  const playSongById = usePlayerStore((state) => state.playSongById);
  const setGameMode = usePlayerStore((state) => state.setGameMode);
  const songIdSet = useMemo(() => new Set(allSongIds), [allSongIds]);

  const items = useMemo(
    () =>
      playlists
        .filter((playlist) => playlist.songIds.length > 0)
        .map((playlist) => ({
          id: playlist.id,
          name: playlist.name,
          count: playlist.songIds.length,
          songIds: playlist.songIds,
        })),
    [playlists],
  );

  const playPlaylist = async (songIds: string[], playlistId?: string) => {
    const queue = songIds.filter((songId) => songIdSet.has(songId));
    const first = queue[0];
    if (!first) {
      return;
    }
    setQueue(queue, first);
    await playSongById(first, false);
    if (playlistId) {
      void recordPlaylistUse(playlistId);
    }
  };

  return (
    <div className="flex w-full flex-col gap-5 pb-8">
      <Card padding="lg" className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <Badge tone="accent" icon="game">
            Game Mode
          </Badge>
          <h1 className="text-[20px] font-bold tracking-tight text-amply-textPrimary">Lean Library</h1>
          <p className="text-[12px] text-amply-textSecondary">Only playlists and essential playback controls. Background work stays off.</p>
        </div>
        <Button
          variant="secondary"
          icon="close"
          onClick={() => {
            void setGameMode(false);
          }}
        >
          Exit Game Mode
        </Button>
      </Card>

      <Surface variant="pressed" radius="md" className="p-2">
        {items.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-amply-textSecondary">No playlists yet. Create one in normal mode.</p>
        ) : (
          <ul className="space-y-1">
            {items.map((playlist) => (
              <li key={playlist.id} className="flex items-center justify-between gap-3 rounded-sm px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-amply-textPrimary">{playlist.name}</p>
                  <p className="text-[11px] text-amply-textSecondary">{playlist.count} songs</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon="play"
                  onClick={() => {
                    void playPlaylist(playlist.songIds, playlist.id);
                  }}
                >
                  Play
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Surface>
      <p className="text-[11px] text-amply-textSecondary">
        Game Mode trims the app down to playlist launch and basic transport controls for the lightest possible playback path.
      </p>
    </div>
  );
};

export default GameModePage;
