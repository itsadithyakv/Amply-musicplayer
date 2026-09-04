import clsx from 'clsx';
import { ArtworkImage } from '@/components/ArtworkImage/ArtworkImage';

export type CoverFade = 'bottom' | 'right' | 'left' | 'none';

interface CoverBackdropProps {
  src?: string;
  alt?: string;
  /** Which edge the dark scrim builds up towards, so text placed there stays readable. */
  fade?: CoverFade;
  /** 0–1 strength of the dark tint over the whole image (default 0.28). */
  tint?: number;
  className?: string;
}

const SCRIM = '18 16 14';

const fadeStyle: Record<CoverFade, string> = {
  bottom: `linear-gradient(to top, rgb(${SCRIM} / 0.92) 0%, rgb(${SCRIM} / 0.72) 32%, rgb(${SCRIM} / 0.25) 62%, transparent 100%)`,
  right: `linear-gradient(to right, transparent 0%, rgb(${SCRIM} / 0.3) 36%, rgb(${SCRIM} / 0.78) 56%, rgb(${SCRIM} / 0.9) 72%)`,
  left: `linear-gradient(to left, transparent 0%, rgb(${SCRIM} / 0.3) 36%, rgb(${SCRIM} / 0.78) 56%, rgb(${SCRIM} / 0.9) 72%)`,
  none: 'none',
};

/**
 * Full-bleed album cover behind a card with a dark scrim building up over the side that carries
 * text. Text on top of it should use the `amply-onCover` colours (light in both themes).
 */
export const CoverBackdrop = ({ src, alt = '', fade = 'bottom', tint = 0.28, className }: CoverBackdropProps) => (
  <div aria-hidden="true" className={clsx('pointer-events-none absolute inset-0 overflow-hidden bg-amply-bgDeep', className)}>
    {src ? <ArtworkImage src={src} alt={alt} className="h-full w-full scale-[1.03] object-cover" pulse={false} /> : null}
    <div className="absolute inset-0" style={{ background: `rgb(${SCRIM} / ${tint})` }} />
    {fade !== 'none' ? <div className="absolute inset-0" style={{ background: fadeStyle[fade] }} /> : null}
  </div>
);
