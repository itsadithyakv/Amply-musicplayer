import { memo, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';

const MAX_LOADED_SRC_KEYS = 1200;
const loadedSrcKeys = new Set<string>();

const hashString = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const getSrcCacheKey = (src: string): string => {
  if (src.length <= 512) {
    return src;
  }
  // Artwork is commonly a large data URL. Hash a fixed-size fingerprint instead
  // of walking the entire encoded image every time a card renders.
  const middle = Math.max(0, Math.floor(src.length / 2) - 32);
  const sample = `${src.slice(0, 64)}${src.slice(middle, middle + 64)}${src.slice(-64)}`;
  return `${src.slice(0, 24)}:${src.length}:${hashString(sample)}`;
};

const rememberLoadedSrc = (src: string): void => {
  const key = getSrcCacheKey(src);
  loadedSrcKeys.add(key);
  if (loadedSrcKeys.size > MAX_LOADED_SRC_KEYS) {
    const first = loadedSrcKeys.values().next().value as string | undefined;
    if (first) {
      loadedSrcKeys.delete(first);
    }
  }
};

const hasLoadedSrc = (src: string): boolean => loadedSrcKeys.has(getSrcCacheKey(src));

interface OptimizedImageProps {
  src?: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  placeholderContent?: React.ReactNode;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
  onLoad?: () => void;
  pulse?: boolean;
}

/**
 * Optimized image component that:
 * - Shows a placeholder while loading
 * - Prevents layout shift (with aspect ratio)
 * - Uses lazy loading by default
 * - Provides visual feedback
 */
export const OptimizedImage: React.FC<OptimizedImageProps> = memo(({
  src,
  alt,
  className,
  placeholderClassName,
  placeholderContent,
  loading = 'lazy',
  decoding = 'async',
  onLoad,
  pulse = true,
}) => {
  const normalizedSrc = useMemo(
    () => (typeof src === 'string' && src.trim().length > 0 ? src : undefined),
    [src],
  );
  const [isLoaded, setIsLoaded] = useState(() => Boolean(normalizedSrc && hasLoadedSrc(normalizedSrc)));
  const [error, setError] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const notifiedRef = useRef(false);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;

  useEffect(() => {
    if (!normalizedSrc) {
      setIsLoaded(false);
      setError(false);
      notifiedRef.current = false;
      return;
    }
    if (hasLoadedSrc(normalizedSrc)) {
      setIsLoaded(true);
      setError(false);
      if (!notifiedRef.current) {
        notifiedRef.current = true;
        onLoadRef.current?.();
      }
      return;
    }
    setIsLoaded(false);
    setError(false);
    notifiedRef.current = false;
  }, [normalizedSrc]);

  useEffect(() => {
    if (!normalizedSrc) {
      return;
    }
    let cancelled = false;
    const handle = window.requestAnimationFrame(() => {
      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth > 0) {
        rememberLoadedSrc(normalizedSrc);
        if (!cancelled) {
          setIsLoaded(true);
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            onLoadRef.current?.();
          }
        }
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(handle);
    };
  }, [normalizedSrc]);

  if (!normalizedSrc && placeholderContent) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900',
          placeholderClassName || className,
        )}
        role="img"
        aria-label={alt}
      >
        {placeholderContent}
      </div>
    );
  }

  if ((!normalizedSrc || error) && !placeholderContent) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900',
          placeholderClassName || className,
        )}
        role="img"
        aria-label={alt}
      >
        <span className="text-xs text-zinc-600">No image</span>
      </div>
    );
  }

  if (error && placeholderContent) {
    return (
      <div
        className={clsx(
          'flex items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900',
          placeholderClassName || className,
        )}
        role="img"
        aria-label={alt}
      >
        {placeholderContent}
      </div>
    );
  }

  return (
    <div
      className={clsx('relative overflow-hidden', className)}
      style={{
        backgroundColor: !isLoaded && !error ? 'rgba(0,0,0,0.2)' : undefined,
      }}
    >
      {!isLoaded && !error && (
        <div
          className={clsx(
            'absolute inset-0 bg-gradient-to-br from-zinc-800 via-zinc-900 to-zinc-950',
            pulse && 'animate-pulse',
            placeholderClassName,
          )}
          aria-hidden="true"
        />
      )}

      {normalizedSrc && !error && (
        <img
          ref={imgRef}
          src={normalizedSrc}
          alt={alt}
          loading={loading}
          decoding={decoding}
          {...{ fetchpriority: loading === 'eager' ? 'high' : 'auto' }}
          className={clsx('h-full w-full object-cover', {
            'opacity-0': !isLoaded && !error,
            'opacity-100 transition-opacity': isLoaded,
          })}
          onLoad={() => {
            if (normalizedSrc) {
              rememberLoadedSrc(normalizedSrc);
            }
            setIsLoaded(true);
            if (!notifiedRef.current) {
              notifiedRef.current = true;
              onLoadRef.current?.();
            }
          }}
          onError={() => {
            setError(true);
            setIsLoaded(false);
          }}
        />
      )}
    </div>
  );
});
