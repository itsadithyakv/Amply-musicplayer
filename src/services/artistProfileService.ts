import { invoke } from '@tauri-apps/api/core';
import { waitForMetadataIdle } from '@/services/metadataActivityGate';
import { markArtistCached } from '@/services/metadataCacheIndex';
import { isTauri } from '@/services/storageService';
import { normalizeArtistLookupText } from '@/utils/artists';

export interface ArtistProfile {
  artistName: string;
  summary: string;
  imageUrl: string | null;
  sourceUrl: string | null;
  fetchedAt: number;
}

export type ArtistProfileLoadResult =
  | { status: 'ready'; profile: ArtistProfile; fromCache: boolean; cachePath: string }
  | { status: 'no-internet'; cachePath: string }
  | { status: 'missing'; cachePath: string };

const emptyResult = (artistNameRaw: string): ArtistProfileLoadResult => {
  const name = artistNameRaw.trim();
  const cachePath = name ? `storage/artist_cache/${name}.json` : 'storage/artist_cache/unknown-artist.json';
  return { status: 'missing', cachePath };
};

const normalizeText = normalizeArtistLookupText;

export const hasCachedArtistProfile = async (artistNameRaw: string): Promise<boolean> => {
  if (!isTauri()) {
    return false;
  }
  return invoke<boolean>('has_cached_artist_profile_rust', { artistName: artistNameRaw });
};

export const readCachedArtistProfile = async (artistNameRaw: string): Promise<ArtistProfileLoadResult> => {
  if (!isTauri()) {
    return emptyResult(artistNameRaw);
  }

  const result = await invoke<{
    status: 'ready' | 'missing' | 'no-internet';
    profile?: ArtistProfile | null;
    fromCache?: boolean | null;
    cachePath: string;
  }>('read_cached_artist_profile_rust', { artistName: artistNameRaw });

  if (result.status === 'ready' && result.profile) {
    void markArtistCached(normalizeText(result.profile.artistName));
    return {
      status: 'ready',
      profile: result.profile,
      fromCache: Boolean(result.fromCache),
      cachePath: result.cachePath,
    };
  }

  if (result.status === 'no-internet') {
    return { status: 'no-internet', cachePath: result.cachePath };
  }
  return { status: 'missing', cachePath: result.cachePath };
};

export const loadArtistProfile = async (
  artistNameRaw: string,
  options: { waitForIdle?: boolean } = {},
): Promise<ArtistProfileLoadResult> => {
  if (!isTauri()) {
    return emptyResult(artistNameRaw);
  }

  if (options.waitForIdle !== false) {
    try {
      await waitForMetadataIdle();
    } catch {
      // Ignore idle wait errors
    }
  }

  const result = await invoke<{
    status: 'ready' | 'missing' | 'no-internet';
    profile?: ArtistProfile | null;
    fromCache?: boolean | null;
    cachePath: string;
  }>('load_artist_profile_rust', { artistName: artistNameRaw });

  if (result.status === 'ready' && result.profile) {
    void markArtistCached(normalizeText(result.profile.artistName));
    return {
      status: 'ready',
      profile: result.profile,
      fromCache: Boolean(result.fromCache),
      cachePath: result.cachePath,
    };
  }

  if (result.status === 'no-internet') {
    return { status: 'no-internet', cachePath: result.cachePath };
  }
  return { status: 'missing', cachePath: result.cachePath };
};
