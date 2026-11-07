import { invoke } from '@tauri-apps/api/core';
import dumbtopIcon from '@/assets/more-apps/dumbtop.png';
import framecapIcon from '@/assets/more-apps/framecap.png';
import juicebarIcon from '@/assets/more-apps/juicebar.png';
import leafletIcon from '@/assets/more-apps/leaflet.png';
import paperyIcon from '@/assets/more-apps/papery.png';
import tachyIcon from '@/assets/more-apps/tachy.png';
import twinlyIcon from '@/assets/more-apps/twinly.png';
import { isTauri } from '@/services/storageService';

/**
 * The other PaperKite apps live in the Microsoft Store, for "More apps from us" in Settings. Only
 * listings that are public go here; a hidden one would open a page that says it is unavailable.
 * Names are the Store names and stay untranslated; the one-liners are in `settings.moreApps.app.*`.
 */
export const PAPERKITE_APPS = [
  { id: 'juicebar', name: 'Juicebar', storeId: '9NSG24NXTHCV', icon: juicebarIcon },
  { id: 'papery', name: 'Papery', storeId: '9NK2Q07CQH90', icon: paperyIcon },
  { id: 'twinly', name: 'Twinly', storeId: '9PMD25CF6BQ2', icon: twinlyIcon },
  { id: 'tachy', name: 'Tachy', storeId: '9PLWHRF39B7C', icon: tachyIcon },
  { id: 'framecap', name: 'Framecap', storeId: '9MW0SX9GSW3K', icon: framecapIcon },
  { id: 'dumbtop', name: 'Dumbtop', storeId: '9P7B0DKHD110', icon: dumbtopIcon },
  { id: 'leaflet', name: 'Leaflet', storeId: '9PH0NLGJFF9W', icon: leafletIcon },
] as const;

export type PaperKiteApp = (typeof PAPERKITE_APPS)[number];

export const storeWebUrl = (storeId: string): string => `https://apps.microsoft.com/detail/${storeId.toLowerCase()}?cid=amply`;

/** Opens the app's page in the Store app; the web listing when that is not possible. */
export const openStoreListing = async (storeId: string): Promise<void> => {
  if (isTauri()) {
    try {
      await invoke('open_store_product', { productId: storeId });
      return;
    } catch {
      // Falls through to the web listing.
    }
  }
  window.open(storeWebUrl(storeId), '_blank', 'noopener');
};
