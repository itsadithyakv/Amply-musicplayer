import { useMemo } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Surface } from '@/components/ui/Surface';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useHomeView } from '@/hooks/useLibraryViews';
import { useT } from '@/i18n';
import { localizedPlaylistName } from '@/i18n/playlistNames';

const GameModePage = () => {
  const { t, tp, language } = useT();
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
          name: localizedPlaylistName(playlist),
          count: playlist.songIds.length,
          songIds: playlist.songIds,
        })),
    // `language` re-runs this when the UI language changes, so smart mix names follow it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playlists, language],
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
            {t('library.gameMode.badge')}
          </Badge>
          <h1 className="text-[20px] font-bold tracking-tight text-amply-textPrimary">{t('library.gameMode.title')}</h1>
          <p className="text-[12px] text-amply-textSecondary">{t('library.gameMode.description')}</p>
        </div>
        <Button
          variant="secondary"
          icon="close"
          onClick={() => {
            void setGameMode(false);
          }}
        >
          {t('library.gameMode.exit')}
        </Button>
      </Card>

      <Surface variant="pressed" radius="md" className="p-2">
        {items.length === 0 ? (
          <p className="px-4 py-4 text-[12px] text-amply-textSecondary">{t('library.gameMode.empty')}</p>
        ) : (
          <ul className="anim-stagger space-y-1">
            {items.map((playlist) => (
              <li key={playlist.id} className="flex items-center justify-between gap-3 rounded-sm px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-amply-textPrimary">{playlist.name}</p>
                  <p className="text-[11px] text-amply-textSecondary">{tp('library.songCount', playlist.count)}</p>
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  icon="play"
                  onClick={() => {
                    void playPlaylist(playlist.songIds, playlist.id);
                  }}
                >
                  {t('common.play')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Surface>
      <p className="text-[11px] text-amply-textSecondary">
        {t('library.gameMode.footnote')}
      </p>
    </div>
  );
};

export default GameModePage;
