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
        'group flex h-[200px] w-[160px] flex-col rounded-card bg-amply-card p-4 text-left',
        'transition-transform duration-200 ease-smooth hover:scale-[1.02] hover:bg-amply-hover',
      )}
    >
      <div className="h-[160px] w-[160px] overflow-hidden rounded-lg bg-gradient-to-br from-zinc-700 via-zinc-900 to-zinc-800">
        {artwork ? (
          <img src={artwork} alt={title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs uppercase tracking-[0.14em] text-amply-textMuted">
            Amply
          </div>
        )}
      </div>
      <p className="mt-3 truncate text-[13px] font-bold text-amply-textPrimary">{title}</p>
      <p className="truncate text-[12px] text-amply-textSecondary">{subtitle}</p>
    </button>
  );
};

export default AlbumCard;
