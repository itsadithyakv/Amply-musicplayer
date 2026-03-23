import clsx from 'clsx';
import { useEffect, useMemo, useState } from 'react';
import prevIcon from '@/assets/icons/prev.svg';
import nextIcon from '@/assets/icons/next.svg';
import playIcon from '@/assets/icons/play.svg';
import pauseIcon from '@/assets/icons/pause.svg';
import shuffleIcon from '@/assets/icons/shuffle.svg';
import queueIcon from '@/assets/icons/queue.svg';
import repeatIcon from '@/assets/icons/repeat.svg';
import repeatOnIcon from '@/assets/icons/repeat-on.svg';
import settingsIcon from '@/assets/icons/settings.svg';
import LyricsViewer from '@/components/LyricsViewer/LyricsViewer';
import ErrorBoundary from '@/components/ErrorBoundary/ErrorBoundary';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Song } from '@/types/music';
import { formatDuration } from '@/utils/time';

const darkSurfaceIconClass = 'h-5 w-5 brightness-0 invert';

const NowPlayingPage = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const nowPlayingTab = usePlayerStore((state) => state.nowPlayingTab);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const queueSongIds = usePlayerStore((state) => state.queueSongIds);
  const manualQueueSongIds = usePlayerStore((state) => state.manualQueueSongIds);
  const queueCursor = usePlayerStore((state) => state.queueCursor);
  const positionSec = usePlayerStore((state) => state.positionSec);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const shuffleEnabled = usePlayerStore((state) => state.shuffleEnabled);
  const repeatMode = usePlayerStore((state) => state.repeatMode);

  const playSongById = usePlayerStore((state) => state.playSongById);
  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const playNext = usePlayerStore((state) => state.playNext);
  const setShuffleEnabled = usePlayerStore((state) => state.setShuffleEnabled);
  const toggleLoopSong = usePlayerStore((state) => state.toggleLoopSong);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);
  const removeQueuedSong = usePlayerStore((state) => state.removeQueuedSong);
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);
  const reshuffleQueue = usePlayerStore((state) => state.reshuffleQueue);
  const albumQueueView = usePlayerStore((state) => state.albumQueueView);

  const songs = useLibraryStore((state) => state.songs);

  const song = useMemo(() => {
    if (!currentSongId) {
      return undefined;
    }

    return songs.find((entry) => entry.id === currentSongId);
  }, [currentSongId, songs]);

  const queueSongs = useMemo(() => {
    const baseIds = manualQueueSongIds.length ? manualQueueSongIds : queueSongIds;
    const startIndex = manualQueueSongIds.length ? 0 : Math.max(0, queueCursor);
    const ids = baseIds.slice(startIndex);
    const songsById = new Map(songs.map((entry) => [entry.id, entry]));

    return ids.map((id) => songsById.get(id)).filter((entry): entry is Song => Boolean(entry));
  }, [manualQueueSongIds, queueSongIds, queueCursor, songs]);

  const allowReorder = manualQueueSongIds.length > 0 && !albumQueueView;

  const queueDisplay = useMemo(() => {
    if (albumQueueView) {
      return albumQueueView.items.map((item) => ({
        id: item.id,
        title: item.title,
        subtitle: albumQueueView.artist,
        available: item.available,
        position: item.position,
      }));
    }
    return queueSongs.map((queuedSong, index) => ({
      id: queuedSong.id,
      title: queuedSong.title,
      subtitle: queuedSong.artist,
      available: true,
      position: index + 1,
    }));
  }, [albumQueueView, queueSongs]);

  const progressPercent = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
  const isLooping = repeatMode === 'one';
  const isLyricsTab = nowPlayingTab === 'lyrics';
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tabs = useMemo(
    () => [
      { id: 'lyrics' as const, label: 'Lyrics' },
      { id: 'queue' as const, label: 'Queue' },
    ],
    [],
  );

  useEffect(() => {
    if (nowPlayingTab === 'now-playing') {
      setNowPlayingTab('queue');
    }
  }, [nowPlayingTab, setNowPlayingTab]);

  useEffect(() => {
    setSettingsOpen(false);
  }, [nowPlayingTab]);

  return (
    <div
      className={clsx(
        'flex h-full min-h-0 flex-col pt-2',
        isLyricsTab ? 'w-full gap-3 pb-2' : 'w-full gap-6 pb-10',
      )}
    >
      {!isLyricsTab ? (
        <div className="grid grid-cols-[minmax(260px,320px)_minmax(0,1fr)] gap-8">
          <div
            className="w-full max-w-[320px] overflow-hidden rounded-card bg-zinc-800 shadow-card"
            style={{ aspectRatio: '1 / 1' }}
          >
            {song?.albumArt ? (
              <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" loading="lazy" decoding="async" />
            ) : null}
          </div>

          <div className="flex flex-col justify-center gap-5">
            <div>
              <p className="text-[18px] font-bold text-amply-textPrimary">{song?.title ?? 'No song selected'}</p>
              <div className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-amply-textSecondary">
                <span>{song?.artist ?? 'Pick a track from Library'}</span>
                {song?.album ? <span className="text-[12px] text-amply-textMuted">{song.album}</span> : null}
              </div>
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
              <div className="flex flex-1 items-center justify-end">
                <button
                  type="button"
                  onClick={() => setShuffleEnabled(!shuffleEnabled)}
                  className={`rounded-full p-2 ${shuffleEnabled ? 'text-amply-accent' : 'text-amply-textSecondary'} hover:bg-amply-hover`}
                  title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
                >
                  <img
                    src={shuffleEnabled ? shuffleIcon : queueIcon}
                    alt={shuffleEnabled ? 'Shuffle' : 'In order'}
                    className={darkSurfaceIconClass}
                  />
                </button>
              </div>
              <div className="flex items-center justify-center gap-3">
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
                <button type="button" onClick={() => void playNext(true)} className="rounded-full p-2 text-amply-textSecondary hover:bg-amply-hover">
                  <img src={nextIcon} alt="Next" className={darkSurfaceIconClass} />
                </button>
              </div>
              <div className="flex flex-1 items-center justify-start">
                <button
                  type="button"
                  onClick={toggleLoopSong}
                  className={`rounded-full p-2 ${isLooping ? 'text-amply-accent' : 'text-amply-textSecondary'} hover:bg-amply-hover`}
                  title={isLooping ? 'Loop on' : 'Loop off'}
                >
                  <img src={isLooping ? repeatOnIcon : repeatIcon} alt="Loop song" className={darkSurfaceIconClass} />
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-b border-amply-border pb-2">
        <div className="flex-1" />
        <div className="flex flex-1 justify-center">
          <div className="inline-flex items-center gap-1 rounded-full border border-amply-border/60 bg-amply-bgSecondary/60 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setNowPlayingTab(tab.id)}
              className={`rounded-full px-4 py-1.5 text-[12px] font-medium transition-colors ${
                nowPlayingTab === tab.id ? 'bg-amply-hover text-amply-textPrimary' : 'text-amply-textSecondary hover:bg-amply-hover'
              }`}
            >
              {tab.label}
            </button>
          ))}
          </div>
        </div>
        <div className="relative flex flex-1 justify-end">
            <button
              type="button"
              onClick={() => setSettingsOpen((prev) => !prev)}
              className="rounded-full p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
              title="Tab settings"
            >
              <img src={settingsIcon} alt="" className={darkSurfaceIconClass} />
            </button>
          {settingsOpen ? (
            <div className="absolute right-0 top-11 z-20 w-48 rounded-xl border border-amply-border/60 bg-amply-card p-2 shadow-card">
              {isLyricsTab ? (
                <div className="space-y-1 text-[12px] text-amply-textSecondary">
                  <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.2em] text-amply-textMuted">Lyrics</p>
                  <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1">
                    <span>Sync</span>
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('amply://lyrics-offset', { detail: { deltaMs: -500 } }));
                        }}
                        className="rounded-full px-2 py-1 text-amply-textSecondary transition-colors hover:bg-amply-hover"
                      >
                        –
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('amply://lyrics-offset', { detail: { deltaMs: 500 } }));
                        }}
                        className="rounded-full px-2 py-1 text-amply-textSecondary transition-colors hover:bg-amply-hover"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('amply://lyrics-choose'));
                      setSettingsOpen(false);
                    }}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-amply-textSecondary transition-colors hover:bg-amply-hover"
                  >
                    Choose lyrics
                  </button>
                </div>
              ) : (
                <div className="space-y-1 text-[12px] text-amply-textSecondary">
                  <p className="px-2 pb-1 text-[10px] uppercase tracking-[0.2em] text-amply-textMuted">Queue</p>
                  {!albumQueueView ? (
                    <button
                      type="button"
                      onClick={() => {
                        reshuffleQueue();
                        setSettingsOpen(false);
                      }}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-amply-textSecondary transition-colors hover:bg-amply-hover"
                    >
                      Re-shuffle queue
                    </button>
                  ) : (
                    <p className="px-2 py-1.5 text-[11px] text-amply-textMuted">Album mode active</p>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

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
        <div className="rounded-card border border-amply-border bg-amply-card">
          <div className="flex items-center justify-between border-b border-amply-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <p className="text-[12px] uppercase tracking-wide text-amply-textMuted">Queue</p>
              {albumQueueView ? (
                <span className="rounded-full border border-amply-border/60 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-amply-textMuted">
                  Album Mode
                </span>
              ) : null}
            </div>
            <span className="text-[11px] text-amply-textMuted">{queueDisplay.length} songs</span>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {queueDisplay.length === 0 ? (
              <p className="px-4 py-6 text-[13px] text-amply-textMuted">Queue is empty.</p>
            ) : (
              <div className="divide-y divide-amply-border/40">
                {queueDisplay.map((queuedSong, index) => {
                  const isCurrent = queuedSong.id === currentSongId;
                  return (
                  <div
                    key={`${queuedSong.id ?? 'missing'}-${queuedSong.position}-${queuedSong.title}`}
                    draggable={allowReorder}
                    onDragStart={(event) => {
                      if (!allowReorder) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData('text/queue-index', String(index));
                    }}
                    onDragOver={(event) => {
                      if (allowReorder) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      if (!allowReorder) {
                        return;
                      }
                      const from = Number(event.dataTransfer.getData('text/queue-index'));
                      reorderQueue(from, index);
                    }}
                    className={clsx(
                      'flex items-center justify-between gap-3 px-4 py-3',
                      isCurrent && 'border-l-2 border-amply-accent bg-amply-hover/60',
                      !queuedSong.available && 'opacity-40',
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 text-left"
                      onClick={() => {
                        if (queuedSong.available && queuedSong.id) {
                          void playSongById(queuedSong.id);
                        }
                      }}
                    >
                      <p className="truncate text-[13px] font-medium text-amply-textPrimary">
                        {queuedSong.position}. {queuedSong.title}
                      </p>
                      <p className="truncate text-[12px] text-amply-textSecondary">{queuedSong.subtitle}</p>
                    </button>
                    {albumQueueView ? (
                      <span className="text-[11px] uppercase tracking-[0.2em] text-amply-textMuted">
                        {queuedSong.available ? 'Available' : 'Missing'}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-[11px] uppercase tracking-[0.2em] text-amply-textMuted transition-colors hover:text-amply-textPrimary"
                        onClick={() => removeQueuedSong(queuedSong.id!)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default NowPlayingPage;
