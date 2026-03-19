import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/services/storageService';

export type OutputDeviceInfo = {
  name: string;
  isDefault: boolean;
};

export const listOutputDevices = async (): Promise<OutputDeviceInfo[]> => {
  if (!isTauri()) {
    return [];
  }

  try {
    return await invoke<OutputDeviceInfo[]>('audio_list_output_devices');
  } catch {
    return [];
  }
};
