import { memo } from 'react';
import { OptimizedImage } from '@/components/OptimizedImage/OptimizedImage';
import { useArtworkReady } from '@/hooks/useArtworkReady';

interface ArtworkImageProps {
  src?: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderContent?: React.ReactNode;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  onLoad?: () => void;
  forceReady?: boolean;
  pulse?: boolean;
}

export const ArtworkImage: React.FC<ArtworkImageProps> = memo(({
  src,
  alt,
  className,
  placeholderClassName,
  placeholderContent,
  loading = 'lazy',
  decoding = 'async',
  onLoad,
  forceReady = false,
  pulse = false,
}) => {
  const sharedArtworkReady = useArtworkReady();
  const artworkReady = forceReady || sharedArtworkReady;
  const resolvedSrc = artworkReady ? src : undefined;
  const resolvedPlaceholder = artworkReady
    ? placeholderContent
    : placeholderContent ?? <div className="h-full w-full" aria-hidden="true" />;

  return (
    <OptimizedImage
      src={resolvedSrc}
      alt={alt}
      className={className}
      placeholderClassName={placeholderClassName}
      placeholderContent={resolvedPlaceholder}
      loading={loading}
      decoding={decoding}
      onLoad={onLoad}
      pulse={pulse}
    />
  );
});
