import clsx from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFlag } from '@/services/runtimeFlags';
import { SmartPlaylistCard, type SmartPlaylistCardItem } from '@/pages/Home/SmartPlaylistCard';

interface FeaturedMixCarouselProps {
  items: SmartPlaylistCardItem[];
  onPlay: (item: SmartPlaylistCardItem) => void;
  onOpen: (item: SmartPlaylistCardItem) => void;
  /** Milliseconds between automatic advances (default 9 s). */
  intervalMs?: number;
}

/**
 * The large featured card cycles through the given mixes so playlists that do not fit in the grid
 * still get surfaced. It pauses while hovered or focused, while the tab is hidden, and under low-perf.
 */
export const FeaturedMixCarousel = ({ items, onPlay, onOpen, intervalMs = 9000 }: FeaturedMixCarouselProps) => {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const lowPerf = useFlag('lowPerf');
  const itemCount = items.length;
  const indexRef = useRef(index);
  indexRef.current = index;

  const advance = useCallback(
    (step: number) => {
      if (!itemCount) {
        return;
      }
      setIndex((current) => (current + step + itemCount) % itemCount);
    },
    [itemCount],
  );

  // Keep the index valid when the set shrinks (e.g. after a manual regenerate).
  useEffect(() => {
    if (index >= itemCount) {
      setIndex(0);
    }
  }, [index, itemCount]);

  useEffect(() => {
    if (itemCount < 2 || paused || lowPerf) {
      return;
    }
    const tick = () => {
      if (document.visibilityState === 'visible') {
        advance(1);
      }
    };
    const handle = window.setInterval(tick, intervalMs);
    return () => window.clearInterval(handle);
  }, [advance, intervalMs, itemCount, lowPerf, paused]);

  const item = items[Math.min(index, Math.max(0, itemCount - 1))];
  if (!item) {
    return null;
  }

  return (
    <div
      className="h-full"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPaused(false);
        }
      }}
    >
      <div key={item.id} className="anim-fade-in h-full">
        <SmartPlaylistCard
          item={item}
          layout="featured"
          onSelect={() => onPlay(item)}
          onPlay={() => onPlay(item)}
          onOpen={() => onOpen(item)}
          footer={
            itemCount > 1 ? (
              <div className="flex items-center gap-2" role="tablist" aria-label="Featured mixes">
                {items.map((entry, entryIndex) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={entryIndex === index}
                    aria-label={`Show ${entry.title}`}
                    onClick={() => setIndex(entryIndex)}
                    className={clsx(
                      'h-2 rounded-full transition-[width,background-color] duration-200 ease-smooth',
                      entryIndex === index ? 'w-6 bg-amply-accent' : 'w-2 bg-amply-textMuted/40 hover:bg-amply-textMuted/70',
                    )}
                  />
                ))}
              </div>
            ) : null
          }
        />
      </div>
    </div>
  );
};
