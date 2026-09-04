import clsx from 'clsx';
import type { KeyboardEvent, MouseEvent } from 'react';
import { IconButton, Kicker, Meta, Surface } from '@/components/ui';
import { CoverBackdrop } from '@/components/ui/CoverBackdrop';
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

interface SmartPlaylistCardProps {
  item: SmartPlaylistCardItem;
  layout?: SmartPlaylistCardLayout;
  /** Card click: play on single click, open on double click (handled by the caller). */
  onSelect: () => void;
  /** Hover play button: play immediately. */
  onPlay: () => void;
}

/**
 * Smart-playlist card whose background is one of the playlist's album covers. The card surface
 * fades in over the side that carries the text, so copy stays legible in both themes.
 */
export const SmartPlaylistCard = ({ item, layout = 'grid', onSelect, onPlay }: SmartPlaylistCardProps) => {
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
  const cover = item.backgroundArtwork ?? item.artwork ?? item.artworks[0];

  if (layout === 'compact') {
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
        className="group flex h-full min-w-0 items-center gap-3 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amply-accent/40"
      >
        <div className="relative w-16 shrink-0">
          <ArtworkWell artworks={[cover]} alt={item.title} />
          <IconButton
            name="play"
            label={`Play ${item.title}`}
            variant="accent"
            size="sm"
            onClick={handlePlay}
            className="absolute bottom-1 right-1 opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100 group-focus-within:opacity-100"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-amply-textPrimary">{item.title}</p>
          <p className="truncate text-[12px] text-amply-textSecondary">{item.subtitle}</p>
        </div>
      </Surface>
    );
  }

  const featured = layout === 'featured';

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
        'group relative flex h-full min-w-0 overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amply-accent/40',
        featured ? 'min-h-[300px] items-center' : 'min-h-[260px] items-end',
      )}
    >
      <CoverBackdrop src={cover} fade={featured ? 'right' : 'bottom'} />

      <div className={clsx('relative z-10 flex min-w-0 flex-col gap-1.5', featured ? 'ml-auto w-[58%] p-6' : 'w-full p-4 pt-16')}>
        <Kicker>{featured ? 'Featured mix' : 'Smart playlist'}</Kicker>
        <p className={clsx('truncate font-bold tracking-[-0.02em] text-amply-textPrimary', featured ? 'text-[28px]' : 'text-[20px]')}>{item.title}</p>
        <p className="line-clamp-2 text-[13px] text-amply-textSecondary">{item.subtitle}</p>
        {showCount ? <Meta>{count}</Meta> : null}
      </div>

      <IconButton
        name="play"
        label={`Play ${item.title}`}
        variant="accent"
        size={featured ? 'lg' : 'md'}
        onClick={handlePlay}
        className={clsx(
          'absolute z-10 opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100 group-focus-within:opacity-100',
          featured ? 'bottom-6 right-6' : 'right-4 top-4',
        )}
      />
    </Surface>
  );
};
