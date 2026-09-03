import clsx from 'clsx';
import type { KeyboardEvent, MouseEvent } from 'react';
import { IconButton, Kicker, Meta, Surface } from '@/components/ui';
import { ArtworkWell } from '@/pages/Home/ArtworkWell';

export type SmartPlaylistCardItem = {
  id: string;
  baseId: string;
  title: string;
  subtitle: string;
  artwork?: string;
  artworks: string[];
  backgroundArtwork?: string;
  description?: string;
  songIds: string[];
  kind: 'smart';
  isMoreMix: boolean;
};

export type SmartPlaylistCardLayout = 'featured' | 'grid' | 'compact';

const toneDotClasses = ['bg-amply-accent', 'bg-amply-success', 'bg-amply-info'] as const;

export const ToneDot = ({ index }: { index: number }) => (
  <span aria-hidden="true" className={clsx('inline-block h-2 w-2 shrink-0 rounded-full', toneDotClasses[index % toneDotClasses.length])} />
);

interface SmartPlaylistCardProps {
  item: SmartPlaylistCardItem;
  layout?: SmartPlaylistCardLayout;
  /** Optional tone accent shown as a small dot next to the kicker. */
  toneIndex?: number;
  /** Card click: play on single click, open on double click (handled by the caller). */
  onSelect: () => void;
  /** Hover play button: play immediately. */
  onPlay: () => void;
}

const titleSize: Record<SmartPlaylistCardLayout, string> = {
  featured: 'text-[24px]',
  grid: 'text-[18px]',
  compact: 'text-[14px]',
};

export const SmartPlaylistCard = ({ item, layout = 'grid', toneIndex, onSelect, onPlay }: SmartPlaylistCardProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  const handlePlay = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onPlay();
  };

  const count = `${item.songIds.length} songs`;
  const showCount = layout !== 'compact' && item.subtitle !== count;
  const artworks = item.artworks.length ? item.artworks : [item.artwork];

  return (
    <Surface
      variant="raised"
      radius="md"
      interactive
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      title="Click to play. Double-click to open playlist."
      className={clsx(
        'group flex h-full min-w-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amply-accent/40',
        layout === 'compact' && 'items-center gap-3 p-3',
        layout === 'featured' && 'items-center gap-5 p-5',
        layout === 'grid' && 'flex-col gap-3 p-4',
      )}
    >
      <div className={clsx('relative shrink-0', layout === 'compact' ? 'w-16' : layout === 'featured' ? 'w-40 sm:w-48' : 'w-full')}>
        <ArtworkWell artworks={artworks} alt={item.title} />
        <IconButton
          name="play"
          label={`Play ${item.title}`}
          variant="accent"
          size={layout === 'compact' ? 'sm' : 'md'}
          onClick={handlePlay}
          className={clsx(
            'absolute opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100 group-focus-within:opacity-100',
            layout === 'compact' ? 'bottom-1 right-1' : 'bottom-2 right-2',
          )}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        {layout !== 'compact' ? (
          <div className="flex items-center gap-2">
            {toneIndex !== undefined ? <ToneDot index={toneIndex} /> : null}
            <Kicker>{layout === 'featured' ? 'Featured mix' : 'Smart playlist'}</Kicker>
          </div>
        ) : null}
        <p className={clsx('truncate font-semibold text-amply-textPrimary', titleSize[layout])}>{item.title}</p>
        <p className={clsx('text-[13px] text-amply-textSecondary', layout === 'compact' ? 'truncate' : 'line-clamp-2')}>{item.subtitle}</p>
        {showCount ? <Meta>{count}</Meta> : null}
      </div>
    </Surface>
  );
};
