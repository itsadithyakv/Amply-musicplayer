import { readStorageJson, writeStorageJson } from '@/services/storageService';

const cachePath = 'metadata_cache/album_art_cache.json';

const slugify = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const normalizeArtworkUrl = (url: string): string => {
  return url.replace(/100x100bb/g, '300x300bb');
};

const cacheKey = (artist: string, album: string): string => {
  return `${slugify(artist || 'unknown-artist')}--${slugify(album || 'unknown-album')}`;
};

type AlbumArtworkCache = Record<string, string>;

const compressImageToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url, { mode: 'cors' });
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const maxSize = 220;
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const targetW = Math.max(1, Math.round(bitmap.width * scale));
    const targetH = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', 0.78);
  } catch {
    return null;
  }
};

const fetchAlbumArtwork = async (artist: string, album: string): Promise<string | null> => {
  const term = encodeURIComponent(`${artist} ${album}`.trim());
  const endpoint = `https://itunes.apple.com/search?term=${term}&entity=album&limit=1`;
  const response = await fetch(endpoint);
  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    results?: Array<{ artworkUrl100?: string }>;
  };

  const artwork = payload.results?.[0]?.artworkUrl100;
  return artwork ? normalizeArtworkUrl(artwork) : null;
};

export const loadAlbumArtwork = async (artist: string, album: string): Promise<string | null> => {
  if (!artist?.trim() || !album?.trim()) {
    return null;
  }

  const cache = await readStorageJson<AlbumArtworkCache>(cachePath, {});
  const key = cacheKey(artist, album);
  const cached = cache[key];
  if (cached) {
    return cached;
  }

  try {
    const fetched = await fetchAlbumArtwork(artist, album);
    if (!fetched) {
      return null;
    }

    const compressed = await compressImageToDataUrl(fetched);
    const stored = compressed ?? fetched;

    await writeStorageJson(cachePath, {
      ...cache,
      [key]: stored,
    });

    return stored;
  } catch {
    return null;
  }
};
