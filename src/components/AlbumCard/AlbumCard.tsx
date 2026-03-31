import { memo, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';

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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      className={clsx(
        'card-sheen group flex min-h-[220px] w-full flex-col rounded-card bg-amply-surface p-4 text-left shadow-card',
        'transition-transform duration-200 ease-smooth hover:scale-[1.02] hover:shadow-lift focus:outline-none focus:ring-2 focus:ring-amply-accent/40',
      )}
    >
      <div className="group relative h-[150px] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b2233] via-[#171b24] to-[#12151c]">
        <ArtworkImage
          src={artwork}
          alt={title}
          className="h-full w-full object-cover"
          placeholderContent={<span className="text-xs uppercase tracking-[0.14em] text-amply-textMuted">Amply</span>}
        />
        {onInfo ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onInfo();
            }}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/40 text-[11px] font-semibold text-white/80 opacity-0 transition-opacity duration-200 ease-smooth group-hover:opacity-100"
            aria-label="View tracklist"
          >
            i
          </button>
        ) : null}
      </div>
      <p className="mt-3 truncate text-[14px] font-semibold text-amply-textPrimary">{title}</p>
      <p className="truncate text-[12px] text-amply-textSecondary">{subtitle}</p>
      {meta ? <p className="mt-1 text-[11px] text-amply-textMuted">{meta}</p> : null}
    </div>
  );
};

export default memo(AlbumCard);
