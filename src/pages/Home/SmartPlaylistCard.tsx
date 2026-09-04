import clsx from 'clsx';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Button, IconButton, Surface } from '@/components/ui';
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
  /** Play button: play immediately. */
  onPlay: () => void;
  /** Featured layout only: opens the playlist page. */
  onOpen?: () => void;
  /** Featured layout only: extra controls rendered under the actions (e.g. rotation dots). */
  footer?: ReactNode;
}

/**
 * Smart-playlist card in the neumorphic language: a raised surface carrying the playlist's cover in
 * an inset well, with the text on the surface itself so it reads the same in both themes.
 */
export const SmartPlaylistCard = ({ item, layout = 'grid', onSelect, onPlay, onOpen, footer }: SmartPlaylistCardProps) => {
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

  if (layout === 'featured') {
    return (
      <Surface
        variant="raised"
        radius="lg"
        className="relative flex h-full min-h-[300px] min-w-0 flex-col gap-5 p-5 sm:flex-row sm:items-stretch sm:p-6"
      >
        <div className="relative w-full shrink-0 sm:w-[44%] sm:max-w-[320px]">
          <ArtworkWell artworks={[cover]} alt={item.title} className="h-full w-full rounded-md" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-5">
          <div className="min-w-0 space-y-2">
            <p className="line-clamp-2 text-[26px] font-bold leading-tight tracking-[-0.025em] text-amply-textPrimary sm:text-[30px]">{item.title}</p>
            <p className="line-clamp-3 text-[14px] leading-relaxed text-amply-textSecondary">{item.subtitle}</p>
            {showCount ? <p className="text-[12px] font-medium text-amply-textMuted">{count}</p> : null}
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="lg" icon="play" onClick={handlePlay}>
                Play mix
              </Button>
              {onOpen ? (
                <Button variant="secondary" size="md" icon="chevron-right" onClick={onOpen}>
                  Open
                </Button>
              ) : null}
            </div>
            {footer}
          </div>
        </div>
      </Surface>
    );
  }

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
      className="group flex h-full min-w-0 flex-col gap-3 p-3 text-left"
    >
      <div className="relative">
        <ArtworkWell artworks={[cover]} alt={item.title} className={clsx('aspect-[16/10] w-full')} />
        <IconButton
          name="play"
          label={`Play ${item.title}`}
          variant="accent"
          size="md"
          onClick={handlePlay}
          className="absolute bottom-3 right-3 opacity-0 transition-opacity duration-150 ease-smooth group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </div>
      <div className="min-w-0 space-y-1 px-1 pb-1">
        <p className="truncate text-[17px] font-bold tracking-[-0.02em] text-amply-textPrimary">{item.title}</p>
        <p className="line-clamp-2 text-[12px] leading-snug text-amply-textSecondary">{item.subtitle}</p>
        {showCount ? <p className="text-[11px] text-amply-textMuted">{count}</p> : null}
      </div>
    </Surface>
  );
};
