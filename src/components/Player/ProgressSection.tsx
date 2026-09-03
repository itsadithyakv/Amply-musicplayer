import { memo } from 'react';
import { Slider } from '@/components/ui';
import { formatDuration } from '@/utils/time';
import { useScrubbedProgress } from '@/components/Player/useScrubbedProgress';

/** Inline "elapsed / slider / total" row used by both player bars. */
export const ProgressSection = memo(() => {
  const { positionSec, durationSec, onScrub, onSeek } = useScrubbedProgress();

  return (
    <div className="flex items-center gap-2 text-[11px] text-amply-textSecondary">
      <span className="w-9 text-right tabular-nums">{formatDuration(positionSec)}</span>
      <Slider
        className="min-w-0 flex-1"
        value={positionSec}
        min={0}
        max={durationSec || 1}
        step={0.1}
        onChange={onScrub}
        onCommit={onSeek}
        ariaLabel="Playback position"
        formatValue={formatDuration}
      />
      <span className="w-9 tabular-nums">{formatDuration(durationSec)}</span>
    </div>
  );
});
ProgressSection.displayName = 'ProgressSection';
