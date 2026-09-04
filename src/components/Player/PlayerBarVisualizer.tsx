import { lazy, Suspense } from 'react';
import { useFlag } from '@/services/runtimeFlags';
import { usePlayerStore } from '@/store/playerStore';

const AudioVisualizer = lazy(() => import('@/components/AudioVisualizer/AudioVisualizer'));

/**
 * Spectrum strip that rises out of the player bar. Positioned above the bar (the bar stays on top
 * of it) and never intercepts the pointer, so pages underneath keep working as before.
 */
export const PlayerBarVisualizer = () => {
  const enabled = usePlayerStore((state) => state.settings.lyricsVisualsEnabled);
  const theme = usePlayerStore((state) => state.settings.lyricsVisualTheme);
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const lowPerf = useFlag('lowPerf');
  if (!enabled || lowPerf) {
    return null;
  }
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-full h-[140px] overflow-hidden">
      <Suspense fallback={null}>
        <AudioVisualizer active isPlaying={isPlaying} theme={theme} />
      </Suspense>
    </div>
  );
};
