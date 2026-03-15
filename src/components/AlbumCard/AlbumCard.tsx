import { memo } from 'react';
import clsx from 'clsx';

interface AlbumCardProps {
  title: string;
  subtitle: string;
  artwork?: string;
  onClick?: () => void;
}

const AlbumCard = ({ title, subtitle, artwork, onClick }: AlbumCardProps) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'card-sheen group flex min-h-[220px] w-full flex-col rounded-card bg-amply-surface p-4 text-left shadow-card',
        'transition-transform duration-200 ease-smooth hover:scale-[1.02] hover:shadow-lift',
      )}
    >
      <div className="group relative h-[150px] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-[#1b2233] via-[#171b24] to-[#12151c]">
        {artwork ? (
          <>
            <img src={artwork} alt={title} className="h-full w-full object-cover" loading="lazy" />
            <div className="pointer-events-none absolute inset-0 bg-black/30 transition-opacity duration-200 ease-smooth group-hover:bg-black/20" />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.14em] text-amply-textMuted">
            Amply
          </div>
        )}
      </div>
      <p className="mt-3 truncate text-[14px] font-semibold text-amply-textPrimary">{title}</p>
      <p className="truncate text-[12px] text-amply-textSecondary">{subtitle}</p>
    </button>
  );
};

export default memo(AlbumCard);
