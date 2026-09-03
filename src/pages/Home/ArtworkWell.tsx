import clsx from 'clsx';
import { useMemo } from 'react';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';

interface ArtworkWellProps {
  /** Candidate artworks; duplicates are collapsed. Two or more unique images render as a 2x2 collage. */
  artworks: Array<string | undefined>;
  alt: string;
  className?: string;
}

/** Square `neu-well` that shows a single artwork or a symmetric 2x2 collage. */
export const ArtworkWell = ({ artworks, alt, className }: ArtworkWellProps) => {
  const unique = useMemo(() => [...new Set(artworks.filter((art): art is string => Boolean(art)))], [artworks]);

  return (
    <div className={clsx('neu-well aspect-square overflow-hidden rounded-sm', className)}>
      {unique.length >= 2 ? (
        <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-1 p-1">
          {[0, 1, 2, 3].map((slot) => {
            const art = unique[slot] ?? unique[slot % unique.length];
            return (
              <div key={slot} className="overflow-hidden rounded-sm">
                <ArtworkImage src={art} alt="" className="h-full w-full object-cover" />
              </div>
            );
          })}
        </div>
      ) : unique[0] ? (
        <ArtworkImage src={unique[0]} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center" role="img" aria-label={alt}>
          <span className="text-[11px] uppercase tracking-[0.14em] text-amply-textMuted">Amply</span>
        </div>
      )}
    </div>
  );
};
