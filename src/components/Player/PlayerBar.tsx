import { Link } from 'react-router-dom';
import prevIcon from '@/assets/icons/prev.svg';
import nextIcon from '@/assets/icons/next.svg';
import playIcon from '@/assets/icons/play.svg';
import pauseIcon from '@/assets/icons/pause.svg';
import shuffleIcon from '@/assets/icons/shuffle.svg';
import repeatIcon from '@/assets/icons/repeat.svg';
import queueIcon from '@/assets/icons/queue.svg';
import lyricsIcon from '@/assets/icons/lyrics.svg';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { PlaybackMode } from '@/types/music';
import { formatDuration } from '@/utils/time';

const iconButtonClass = 'rounded-full p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover hover:text-amply-textPrimary';
const darkSurfaceIconClass = 'h-5 w-5 brightness-0 invert';
const panelIconClass = 'h-4 w-4 brightness-0 invert';

const PlayerBar = () => {
  const currentSongId = usePlayerStore((state) => state.currentSongId);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const positionSec = usePlayerStore((state) => state.positionSec);
  const durationSec = usePlayerStore((state) => state.durationSec);
  const shuffleEnabled = usePlayerStore((state) => state.shuffleEnabled);
  const repeatMode = usePlayerStore((state) => state.repeatMode);
  const volume = usePlayerStore((state) => state.volume);
  const setNowPlayingTab = usePlayerStore((state) => state.setNowPlayingTab);

  const togglePlayPause = usePlayerStore((state) => state.togglePlayPause);
  const playNext = usePlayerStore((state) => state.playNext);
  const playPrevious = usePlayerStore((state) => state.playPrevious);
  const seekTo = usePlayerStore((state) => state.seekTo);
  const setVolume = usePlayerStore((state) => state.setVolume);
  const cyclePlaybackMode = usePlayerStore((state) => state.cyclePlaybackMode);

  const song = useLibraryStore((state) => (currentSongId ? state.getSongById(currentSongId) : undefined));

  const progressPercent = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
  const playbackMode: PlaybackMode = shuffleEnabled ? 'shuffle' : repeatMode === 'all' || repeatMode === 'one' ? 'repeat' : 'order';
  const modeIcon = playbackMode === 'shuffle' ? shuffleIcon : playbackMode === 'repeat' ? repeatIcon : playIcon;
  const modeLabel = playbackMode === 'shuffle' ? 'Shuffle' : playbackMode === 'repeat' ? 'Repeat' : 'In Order';

  return (
    <footer className="relative z-50 h-[90px] border-t border-amply-border bg-amply-card px-4 py-2 shadow-[0_-10px_20px_rgba(0,0,0,0.42)]" style={{ backgroundColor: '#181818' }}>
      <div className="grid h-full grid-cols-[1.6fr_2fr_1.2fr] items-center gap-4">
        <Link to="/now-playing" className="flex min-w-0 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-amply-hover">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-zinc-800">
            {song?.albumArt ? <img src={song.albumArt} alt={song.album} className="h-full w-full object-cover" /> : null}
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-amply-textPrimary">{song?.title ?? 'Select a track'}</p>
            <p className="truncate text-[12px] text-amply-textSecondary">{song ? `${song.artist} - ${song.album}` : 'Your local library'}</p>
          </div>
        </Link>

        <div className="space-y-1">
          <div className="flex items-center justify-center gap-2">
            <button
              type="button"
              onClick={cyclePlaybackMode}
              className={`${iconButtonClass} ${playbackMode !== 'order' ? 'text-amply-accent' : ''}`}
              title={`Playback mode: ${modeLabel}. Click to cycle.`}
            >
              <img src={modeIcon} alt={modeLabel} className={darkSurfaceIconClass} />
            </button>
            <button type="button" onClick={() => void playPrevious()} className={iconButtonClass}>
              <img src={prevIcon} alt="Previous" className={darkSurfaceIconClass} />
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-amply-accent text-black transition-colors hover:bg-amply-accentHover"
            >
              <img src={isPlaying ? pauseIcon : playIcon} alt="Play/Pause" className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => void playNext()} className={iconButtonClass}>
              <img src={nextIcon} alt="Next" className={darkSurfaceIconClass} />
            </button>
            <span className="min-w-[64px] text-center text-[11px] text-amply-textSecondary">{modeLabel}</span>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-amply-textMuted">
            <span className="w-9 text-right">{formatDuration(positionSec)}</span>
            <div className="relative h-1 flex-1 rounded-full bg-[#404040]">
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
            <span className="w-9">{formatDuration(durationSec)}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Link
            to="/now-playing"
            onClick={() => setNowPlayingTab('queue')}
            className="rounded-lg border border-amply-border p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
            title="Queue"
          >
            <img src={queueIcon} alt="Queue" className={panelIconClass} />
          </Link>
          <Link
            to="/now-playing"
            onClick={() => setNowPlayingTab('lyrics')}
            className="rounded-lg border border-amply-border p-2 text-amply-textSecondary transition-colors hover:bg-amply-hover"
            title="Lyrics"
          >
            <img src={lyricsIcon} alt="Lyrics" className={panelIconClass} />
          </Link>
          <label className="ml-2 flex items-center gap-2 text-[12px] text-amply-textSecondary">
            Vol
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="h-1 w-24 cursor-pointer accent-amply-accent"
            />
          </label>
        </div>
      </div>
    </footer>
  );
};

export default PlayerBar;
