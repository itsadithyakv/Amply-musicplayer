import clsx from 'clsx';
import { useMemo } from 'react';
import prevIcon from '@/assets/icons/prev.svg';
import nextIcon from '@/assets/icons/next.svg';
import playIcon from '@/assets/icons/play.svg';
import pauseIcon from '@/assets/icons/pause.svg';
import shuffleIcon from '@/assets/icons/shuffle.svg';
import repeatIcon from '@/assets/icons/repeat.svg';
import LyricsViewer from '@/components/LyricsViewer/LyricsViewer';
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { PlaybackMode, Song } from '@/types/music';
import { formatDuration } from '@/utils/time';

const darkSurfaceIconClass = 'h-5 w-5 brightness-0 invert';

const NowPlayingPage = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const nowPlayingTab = usePlayerStore((state) => state.nowPlayingTab);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const queueSongIds = usePlayerStore((state) => state.queueSongIds);
  const manualQueueSongIds = usePlayerStore((state) => state.manualQueueSongIds);
  const positionSec = usePlayerStore((state) => state.positionSec);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const shuffleEnabled = usePlayerStore((state) => state.shuffleEnabled);
  const repeatMode = usePlayerStore((state) => state.repeatMode);

  const playSongById = usePlayerStore((state) => state.playSongById);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const playNext = usePlayerStore((state) => state.playNext);
  const cyclePlaybackMode = usePlayerStore((state) => state.cyclePlaybackMode);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const removeQueuedSong = usePlayerStore((state) => state.removeQueuedSong);
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);

  const songs = useLibraryStore((state) => state.songs);

  const song = useMemo(() => {
    if (!currentSongId) {
      return undefined;
    }

    return songs.find((entry) => entry.id === currentSongId);
  }, [currentSongId, songs]);

  const queueSongs = useMemo(() => {
    const ids = manualQueueSongIds.length ? manualQueueSongIds : queueSongIds;
    const songsById = new Map(songs.map((entry) => [entry.id, entry]));

    return ids
      .map((id) => songsById.get(id))
      .filter((entry): entry is Song => Boolean(entry));
  }, [manualQueueSongIds, queueSongIds, songs]);

  const progressPercent = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
  const playbackMode: PlaybackMode = shuffleEnabled ? 'shuffle' : repeatMode === 'all' || repeatMode === 'one' ? 'repeat' : 'order';
  const modeIcon = playbackMode === 'shuffle' ? shuffleIcon : playbackMode === 'repeat' ? repeatIcon : playIcon;
  const modeLabel = playbackMode === 'shuffle' ? 'Shuffle' : playbackMode === 'repeat' ? 'Repeat' : 'In Order';
  const isLyricsTab = nowPlayingTab === 'lyrics';

  const tabs = useMemo(
    () => [
      { id: 'now-playing' as const, label: 'Now Playing' },
      { id: 'lyrics' as const, label: 'Lyrics' },
      { id: 'queue' as const, label: 'Queue' },
    ],
    [],
  );

  return (
    <div
      className={clsx(
        'flex h-full min-h-0 flex-col pt-2',
        isLyricsTab ? 'w-full gap-3 pb-2' : 'mx-auto max-w-5xl gap-6 pb-12',
      )}
    >
      {!isLyricsTab ? (
        <div className="grid grid-cols-[320px_1fr] gap-10">
          <div className="h-[320px] w-[320px] overflow-hidden rounded-card bg-zinc-800 shadow-card">
            {song?.albumArt ? <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" /> : null}
          </div>

          <div className="flex flex-col justify-center gap-5">
            <div>
              <p className="text-[18px] font-bold text-amply-textPrimary">{song?.title ?? 'No song selected'}</p>
              <p className="text-[14px] font-medium text-amply-textSecondary">{song?.artist ?? 'Pick a track from Library'}</p>
            </div>

            <div className="space-y-2">
              <div className="relative h-1 rounded-full bg-[#404040]">
                <div className="absolute left-0 top-0 h-1 rounded-full bg-amply-accent" style={{ width: `${progressPercent}%` }} />
                <input
                  type="range"
                  min={0}
                  max={durationSec || 1}
                  step={0.1}
                  value={positionSec}
                  onChange={(event) => seekTo(Number(event.target.value))}
                  className="absolute left-0 top-[-6px] h-4 w-full cursor-pointer appearance-none bg-transparent"
                />
              </div>
              <div className="flex justify-between text-[12px] text-amply-textMuted">
                <span>{formatDuration(positionSec)}</span>
                <span>{formatDuration(durationSec)}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={cyclePlaybackMode}
                className={`rounded-full p-2 ${playbackMode !== 'order' ? 'text-amply-accent' : 'text-amply-textSecondary'} hover:bg-amply-hover`}
                title={`Playback mode: ${modeLabel}. Click to cycle.`}
              >
                <img src={modeIcon} alt={modeLabel} className={darkSurfaceIconClass} />
              </button>
              <button type="button" onClick={() => void playPrevious()} className="rounded-full p-2 text-amply-textSecondary hover:bg-amply-hover">
                <img src={prevIcon} alt="Previous" className={darkSurfaceIconClass} />
              </button>
              <button
                type="button"
                onClick={togglePlayPause}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-amply-accent text-black transition-colors hover:bg-amply-accentHover"
              >
                <img src={isPlaying ? pauseIcon : playIcon} alt="Play/Pause" className="h-6 w-6" />
              </button>
              <button type="button" onClick={() => void playNext()} className="rounded-full p-2 text-amply-textSecondary hover:bg-amply-hover">
                <img src={nextIcon} alt="Next" className={darkSurfaceIconClass} />
              </button>
              <p className="text-[12px] text-amply-textSecondary">{modeLabel}</p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2 border-b border-amply-border pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setNowPlayingTab(tab.id)}
            className={`rounded-md px-3 py-2 text-[13px] transition-colors ${
              nowPlayingTab === tab.id ? 'bg-amply-hover text-amply-textPrimary' : 'text-amply-textSecondary hover:bg-amply-hover'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {nowPlayingTab === 'now-playing' ? (
        <div className="rounded-card border border-amply-border bg-amply-card p-4 text-[13px] text-amply-textSecondary">
          <p>Album: {song?.album ?? '-'}</p>
          <p>Genre: {song?.genre ?? '-'}</p>
          <p>Playback source: {song?.path ?? '-'}</p>
        </div>
      ) : null}

      {nowPlayingTab === 'lyrics' ? (
        <div className="min-h-0 flex-1">
          <ErrorBoundary
            fallback={
              <div className="h-full rounded-card border border-amply-border bg-amply-card p-4">
                <p className="text-[13px] text-amply-textMuted">Lyrics failed to render. Reopen the tab and try again.</p>
              </div>
            }
          >
            <LyricsViewer song={song ?? null} active={nowPlayingTab === 'lyrics'} fullHeight />
          </ErrorBoundary>
        </div>
      ) : null}

      {nowPlayingTab === 'queue' ? (
        <div className="space-y-2 rounded-card border border-amply-border bg-amply-card p-4">
          {queueSongs.length === 0 ? <p className="text-[13px] text-amply-textMuted">Queue is empty.</p> : null}
          {queueSongs.map((queuedSong, index) => (
            <div
              key={queuedSong.id}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData('text/queue-index', String(index));
              }}
              onDragOver={(event) => {
                event.preventDefault();
              }}
              onDrop={(event) => {
                const from = Number(event.dataTransfer.getData('text/queue-index'));
                reorderQueue(from, index);
              }}
              className="flex items-center justify-between rounded-md border border-amply-border bg-amply-bgSecondary px-3 py-2"
            >
              <button
                type="button"
                className="text-left"
                onClick={() => {
                  void playSongById(queuedSong.id);
                }}
              >
                <p className="text-[13px] text-amply-textPrimary">{queuedSong.title}</p>
                <p className="text-[12px] text-amply-textSecondary">{queuedSong.artist}</p>
              </button>
              <button
                type="button"
                className="text-[12px] text-amply-textMuted transition-colors hover:text-amply-textPrimary"
                onClick={() => removeQueuedSong(queuedSong.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default NowPlayingPage;
