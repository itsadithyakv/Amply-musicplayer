const AMPLYART_FULL_PATTERN = /^(https?:\/\/amplyart\.localhost\/[^/?#]+?)\.jpg$/i;
const AMPLYART_THUMB_PATTERN = /\.(64|128)\.jpg$/i;

/**
 * Rewrites an `amplyart://` artwork URL (`.../<hash>.jpg`) to the on-demand thumbnail variant
 * (`.../<hash>.<size>.jpg`). Any other URL (data URLs, http images, already-thumbnailed URLs)
 * is returned unchanged.
 */
export const artworkThumb = (src: string | undefined, size: 64 | 128): string | undefined => {
  if (!src) {
    return src;
  }
  if (AMPLYART_THUMB_PATTERN.test(src)) {
    return src;
  }
  const match = AMPLYART_FULL_PATTERN.exec(src);
  if (!match) {
    return src;
  }
  return `${match[1]}.${size}.jpg`;
};
