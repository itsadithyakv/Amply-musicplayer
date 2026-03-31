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
}

export const ArtworkImage: React.FC<ArtworkImageProps> = ({
  src,
  alt,
  className,
  placeholderClassName,
  placeholderContent,
  loading = 'lazy',
  decoding = 'async',
  onLoad,
  forceReady = false,
}) => {
  const artworkReady = forceReady || useArtworkReady();
  const resolvedSrc = artworkReady ? src : undefined;
  const resolvedPlaceholder = artworkReady ? placeholderContent : undefined;

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
    />
  );
};
