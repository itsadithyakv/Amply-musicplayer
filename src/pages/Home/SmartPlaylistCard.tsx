import clsx from 'clsx';
import type { KeyboardEvent, MouseEvent } from 'react';
import { IconButton, Surface } from '@/components/ui';
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
 * Smart-playlist card whose background is one of the playlist's album covers under a dark scrim,
 * with light text on top (the same in both themes).
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
        className="group flex h-full min-w-0 items-center gap-3 p-3 text-left"
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
        'group relative flex h-full min-w-0 overflow-hidden text-left',
        featured ? 'min-h-[300px] items-center' : 'min-h-[260px] items-end',
      )}
    >
      <CoverBackdrop src={cover} fade={featured ? 'right' : 'bottom'} />

      <div className={clsx('relative z-10 flex min-w-0 flex-col gap-1.5', featured ? 'ml-auto w-[58%] p-6' : 'w-full p-4 pt-16')}>
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-amply-onCoverMuted">{featured ? 'Featured mix' : 'Smart playlist'}</p>
        <p className={clsx('truncate font-bold tracking-[-0.02em] text-amply-onCover', featured ? 'text-[28px]' : 'text-[20px]')}>{item.title}</p>
        <p className="line-clamp-2 text-[13px] text-amply-onCoverMuted">{item.subtitle}</p>
        {showCount ? <p className="text-[12px] text-amply-onCoverMuted">{count}</p> : null}
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
