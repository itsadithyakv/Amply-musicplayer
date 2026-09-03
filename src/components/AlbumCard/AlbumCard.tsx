import { memo, type KeyboardEvent } from 'react';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';
import { IconButton, Surface } from '@/components/ui';

interface AlbumCardProps {
  title: string;
  subtitle: string;
  artwork?: string;
  onClick?: () => void;
  meta?: string;
  onInfo?: () => void;
}

const AlbumCard = ({ title, subtitle, artwork, onClick, meta, onInfo }: AlbumCardProps) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  // A nested info button makes a real <button> invalid HTML, so only then fall back to role="button".
  const clickTargetProps = onInfo
    ? { role: 'button', tabIndex: 0, onKeyDown: handleKeyDown }
    : { type: 'button' as const };

  return (
    <Surface
      as={onInfo ? 'div' : 'button'}
      variant="raised-sm"
      radius="md"
      interactive
      onClick={onClick}
      className="group flex min-h-[208px] w-full flex-col p-3 text-left"
      {...clickTargetProps}
    >
      <div className="neu-well relative h-[148px] w-full overflow-hidden rounded-sm">
        <ArtworkImage
          src={artwork}
          alt={title}
          className="h-full w-full object-cover"
          placeholderContent={<span className="text-xs uppercase tracking-[0.14em] text-amply-textMuted">Amply</span>}
        />
        {onInfo ? (
          <IconButton
            name="info"
            label="View tracklist"
            size="xs"
            variant="raised"
            onClick={(event) => {
              event.stopPropagation();
              onInfo();
            }}
            className="absolute right-2 top-2 opacity-0 transition-opacity duration-200 ease-smooth focus-visible:opacity-100 group-hover:opacity-100"
          />
        ) : null}
      </div>
      <p className="mt-2.5 truncate text-[14px] font-semibold text-amply-textPrimary">{title}</p>
      <p className="truncate text-[12px] text-amply-textSecondary">{subtitle}</p>
      {meta ? <p className="mt-1 text-[11px] text-amply-textMuted">{meta}</p> : null}
    </Surface>
  );
};

export default memo(AlbumCard);
