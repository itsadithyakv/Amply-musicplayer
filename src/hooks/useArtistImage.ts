import { useEffect, useState } from 'react';
import { readCachedArtistProfile } from '@/services/artistProfileService';
import { normalizeArtistLookupText } from '@/utils/artists';

/** Resolved artist image URLs (null = checked, none cached). Shared across every card. */
const resolved = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

const lookup = (artistName: string): Promise<string | null> => {
  const key = normalizeArtistLookupText(artistName);
  if (!key) {
    return Promise.resolve(null);
  }
  const known = resolved.get(key);
  if (known !== undefined) {
    return Promise.resolve(known);
  }
  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }
  const request = readCachedArtistProfile(artistName)
    .then((result) => (result.status === 'ready' ? result.profile.imageUrl ?? null : null))
    .catch(() => null)
    .then((image) => {
      resolved.set(key, image);
      inflight.delete(key);
      return image;
    });
  inflight.set(key, request);
  return request;
};

/** Forget a cached answer (e.g. after a fresh profile fetch) so the next mount re-reads it. */
export const invalidateArtistImage = (artistName: string): void => {
  resolved.delete(normalizeArtistLookupText(artistName));
};

/**
 * The artist's cached photo (from the Wikipedia profile cache), or `undefined` while unknown.
 * Cache-only: never triggers a network fetch, so it is safe inside virtualised grids.
 */
export const useArtistImage = (artistName: string | undefined): string | undefined => {
  const key = artistName ? normalizeArtistLookupText(artistName) : '';
  const [image, setImage] = useState<string | undefined>(() => (key ? (resolved.get(key) ?? undefined) : undefined));

  useEffect(() => {
    if (!artistName || !key) {
      setImage(undefined);
      return;
    }
    let alive = true;
    void lookup(artistName).then((value) => {
      if (alive) {
        setImage(value ?? undefined);
      }
    });
    return () => {
      alive = false;
    };
  }, [artistName, key]);

  return image;
};
