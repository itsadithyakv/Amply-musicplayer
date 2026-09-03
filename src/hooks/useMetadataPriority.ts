import { useCallback } from 'react';
import { notifySongChange, shouldLoadExpensiveMetadata as globalShouldLoadExpensiveMetadata } from '@/services/metadataPriority';

/**
 * Hook to prioritize metadata loading based on user activity
 * Delays expensive operations when user is rapidly changing songs
 */
export const useMetadataPriority = () => {
  const onSongChange = useCallback(() => {
    notifySongChange();
  }, []);

  const shouldLoadExpensiveMetadata = useCallback(() => {
    return globalShouldLoadExpensiveMetadata();
  }, []);

  return {
    onSongChange,
    shouldLoadExpensiveMetadata,
  };
};
