import { memo, type MutableRefObject } from 'react';
import { Link } from 'react-router-dom';
import { Icon, Slider } from '@/components/ui';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { PlayerShell } from '@/components/Player/PlayerShell';
import { PrimaryTransport } from '@/components/Player/TransportControls';
import { ProgressSection } from '@/components/Player/ProgressSection';
import { usePlayerStore } from '@/store/playerStore';
import { usePlayerBarView } from '@/hooks/useLibraryViews';

/** Lean player bar shown while game mode is on. */
export const GameModeBar = memo(({ actionBusyRef }: { actionBusyRef: MutableRefObject<boolean> }) => {
  const { song, volume } = usePlayerBarView();
  const setVolume = usePlayerStore((state) => state.setVolume);

  return (
    <PlayerShell>
      <div className="grid h-full grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-4">
        <Link
          to="/now-playing"
          className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 transition-[box-shadow] hover:neu-raised-sm"
        >
          <ArtworkImage
            src={song?.albumArt}
            alt={song?.album ?? 'Unknown Album'}
            className="neu-well h-12 w-12 shrink-0 overflow-hidden rounded-sm"
            loading="eager"
            forceReady
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-bold text-amply-textPrimary">{song?.title ?? 'Select a playlist'}</p>
            <p className="truncate text-[12px] text-amply-textSecondary">{song ? song.artist : 'Lean playback mode'}</p>
          </div>
        </Link>

        <div className="flex flex-col">
          <PrimaryTransport actionBusyRef={actionBusyRef} />
          <ProgressSection />
        </div>

        <div className="flex items-center justify-end gap-2">
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
    </PlayerShell>
  );
});
GameModeBar.displayName = 'GameModeBar';
