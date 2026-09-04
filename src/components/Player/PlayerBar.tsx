import { Link, useLocation, useNavigate } from 'react-router-dom';
import { memo, useEffect, useRef, useState } from 'react';
import { ConfirmDialog, Icon, IconButton, Slider } from '@/components/ui';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { PlayerShell } from '@/components/Player/PlayerShell';
import { GameModeBar } from '@/components/Player/GameModeBar';
import { PlaylistPickerModal } from '@/components/Player/PlaylistPickerModal';
import { ProgressSection } from '@/components/Player/ProgressSection';
import { TransportControls } from '@/components/Player/TransportControls';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { beginTrackedInteraction } from '@/services/interactionTrace';
import { usePlayerBarView } from '@/hooks/useLibraryViews';
import { artworkThumb } from '@/utils/artwork';

const RightControls = memo(() => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentSongId, nowPlayingTab, song, volume } = usePlayerBarView();
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const deleteCurrentSong = usePlayerStore((state) => state.deleteCurrentSong);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!currentSongId) {
      setConfirmDeleteOpen(false);
      setDeleteBusy(false);
    }
  }, [currentSongId]);

  const openNowPlaying = (tab: 'queue' | 'lyrics') => {
    if (location.pathname !== '/now-playing') {
      beginTrackedInteraction('route:now-playing', 'now-playing-open', { source: 'player-bar', target: tab });
    }
    if (location.pathname !== '/now-playing' || nowPlayingTab !== tab) {
      beginTrackedInteraction('now-playing-tab', tab === 'queue' ? 'queue-tab-open' : 'lyrics-tab-open', { source: 'player-bar' });
    }
    setNowPlayingTab(tab);
    navigate('/now-playing');
  };

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        <IconButton name="queue" label="Queue" size="sm" onClick={() => openNowPlaying('queue')} />
        <IconButton name="lyrics" label="Lyrics" size="sm" onClick={() => openNowPlaying('lyrics')} />
        <IconButton
          name="trash"
          label="Delete song"
          size="sm"
          disabled={!currentSongId || deleteBusy}
          onClick={() => {
            if (!currentSongId || deleteBusy) {
              return;
            }
            setConfirmDeleteOpen(true);
          }}
        />
        <div className="ml-2 flex items-center gap-2">
          <Icon name="volume" size={16} className="text-amply-textMuted" />
          <Slider
            className="w-24"
            size="sm"
            value={volume}
            min={0}
            max={1}
            step={0.01}
            onChange={setVolume}
            ariaLabel="Volume"
            formatValue={(value) => `${Math.round(value * 100)}%`}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => {
          if (!deleteBusy) {
            setConfirmDeleteOpen(false);
          }
        }}
        onConfirm={() => {
          if (!currentSongId || deleteBusy) {
            return;
          }
          setDeleteBusy(true);
          void deleteCurrentSong().finally(() => {
            setDeleteBusy(false);
            setConfirmDeleteOpen(false);
          });
        }}
        title="Delete song"
        confirmLabel="Delete"
        danger
        busy={deleteBusy}
        body={
          <div className="space-y-3">
            <p className="text-[13px] leading-relaxed text-amply-textSecondary">
              Delete <span className="font-semibold text-amply-textPrimary">{song?.title ?? 'this song'}</span> from your device? This
              removes the local file, not just the track from Amply.
            </p>
            {song ? (
              <div className="neu-well rounded-sm px-3 py-2">
                <p className="truncate text-[13px] font-semibold text-amply-textPrimary">{song.title}</p>
                <p className="truncate text-[12px] text-amply-textSecondary">
                  {song.artist} - {song.album}
                </p>
              </div>
            ) : null}
          </div>
        }
      />
    </>
  );
});
RightControls.displayName = 'RightControls';

const SongInfoSection = memo(() => {
  const location = useLocation();
  const { song, customPlaylists } = usePlayerBarView();
  const toggleFavorite = useLibraryStore((state) => state.toggleFavorite);
  const addSongToCustomPlaylist = useLibraryStore((state) => state.addSongToCustomPlaylist);
  const upsertCustomPlaylist = useLibraryStore((state) => state.upsertCustomPlaylist);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [favoritePulse, setFavoritePulse] = useState(false);
  const [favoriteMessage, setFavoriteMessage] = useState<string | null>(null);
  const [playlistMessage, setPlaylistMessage] = useState<string | null>(null);
  const favoriteMessageRef = useRef<number | null>(null);
  const playlistMessageRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (favoriteMessageRef.current) {
        window.clearTimeout(favoriteMessageRef.current);
      }
      if (playlistMessageRef.current) {
        window.clearTimeout(playlistMessageRef.current);
      }
    };
  }, []);

  const showPlaylistMessage = (message: string) => {
    setPlaylistMessage(message);
    if (playlistMessageRef.current) {
      window.clearTimeout(playlistMessageRef.current);
    }
    playlistMessageRef.current = window.setTimeout(() => {
      setPlaylistMessage(null);
    }, 1600);
  };

  return (
    <div className="relative flex min-w-0 items-center gap-3">
      <Link
        to="/now-playing"
        onClick={() => {
          if (location.pathname !== '/now-playing') {
            beginTrackedInteraction('route:now-playing', 'now-playing-open', { source: 'player-bar-song-info' });
          }
        }}
        className="flex min-w-0 items-center gap-3 rounded-md p-2 transition-[box-shadow] hover:neu-raised-sm"
      >
        <ArtworkImage
          src={artworkThumb(song?.albumArt, 64)}
          alt={song?.album ?? 'Unknown Album'}
          className="neu-well h-12 w-12 shrink-0 overflow-hidden rounded-sm"
          loading="eager"
          forceReady
        />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-amply-textPrimary">{song?.title ?? 'Select a track'}</p>
          <p className="truncate text-[12px] text-amply-textSecondary">{song ? `${song.artist} - ${song.album}` : 'Your local library'}</p>
        </div>
      </Link>
      <div className="flex items-center gap-1">
        <IconButton
          name={song?.favorite ? 'heart-filled' : 'heart'}
          label={song?.favorite ? 'Remove from favorites' : 'Add to favorites'}
          size="sm"
          active={Boolean(song?.favorite)}
          accentIcon={Boolean(song?.favorite)}
          disabled={!song}
          className={favoritePulse ? 'favorite-pulse' : undefined}
          onClick={() => {
            if (!song) {
              return;
            }
            const willFavorite = !song.favorite;
            void toggleFavorite(song.id);
            if (willFavorite) {
              setFavoritePulse(true);
              setFavoriteMessage('Added to Favorites');
              if (favoriteMessageRef.current) {
                window.clearTimeout(favoriteMessageRef.current);
              }
              favoriteMessageRef.current = window.setTimeout(() => {
                setFavoritePulse(false);
                setFavoriteMessage(null);
              }, 1400);
            } else {
              setFavoriteMessage(null);
              setFavoritePulse(false);
            }
          }}
        />
        <IconButton
          name="playlist-add"
          label="Add to playlist"
          size="sm"
          disabled={!song}
          onClick={() => setShowPlaylistPicker((value) => !value)}
        />
      </div>

      {favoriteMessage ? <span className="text-[12px] font-semibold text-amply-textSecondary">{favoriteMessage}</span> : null}
      {playlistMessage ? <span className="text-[12px] font-semibold text-amply-textSecondary">{playlistMessage}</span> : null}

      <PlaylistPickerModal
        open={showPlaylistPicker}
        onClose={() => setShowPlaylistPicker(false)}
        song={song}
        playlists={customPlaylists}
        onAddToPlaylist={addSongToCustomPlaylist}
        onCreatePlaylist={upsertCustomPlaylist}
        onMessage={showPlaylistMessage}
      />
    </div>
  );
});
SongInfoSection.displayName = 'SongInfoSection';

const PlayerBar = () => {
  const gameMode = usePlayerStore((state) => state.settings.gameMode);
  const actionBusyRef = useRef(false);

  if (gameMode) {
    return <GameModeBar actionBusyRef={actionBusyRef} />;
  }

  return (
    <PlayerShell>
      <div className="grid h-full grid-cols-[1.6fr_2fr_1.2fr] items-center gap-4">
        <SongInfoSection />

        <div className="flex flex-col">
          <TransportControls actionBusyRef={actionBusyRef} />
          <ProgressSection />
        </div>

        <RightControls />
      </div>
    </PlayerShell>
  );
};

export default memo(PlayerBar);
