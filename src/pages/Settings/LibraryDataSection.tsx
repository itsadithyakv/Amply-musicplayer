import { useMemo, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryTabView } from '@/hooks/useLibraryViews';
import { Button, Kicker, Surface, Toggle } from '@/components/ui';
import { clearStorageCache, openStorageDir } from '@/services/storageService';
import { resetMetadataCacheIndex } from '@/services/metadataCacheIndex';
import { resetMetadataAttempts } from '@/services/metadataAttemptService';
import { SettingsNote, SettingsSection } from '@/pages/Settings/SettingsSection';

export const LibraryDataSection = () => {
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);
  const startMetadataFetch = useLibraryStore((state) => state.startMetadataFetch);
  const metadataFetchPaused = usePlayerStore((state) => state.settings.metadataFetchPaused);
  const setMetadataFetchPaused = usePlayerStore((state) => state.setMetadataFetchPaused);
  const songs = useLibraryTabView('songs').songs;

  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [clearingCache, setClearingCache] = useState(false);

  const librarySummary = useMemo(() => {
    const artists = new Set<string>();
    const genres = new Set<string>();
    for (const song of songs) {
      if (song.artist?.trim()) {
        artists.add(song.artist.trim().toLocaleLowerCase());
      }
      for (const genre of song.genre?.split(/[,;/|]+/) ?? []) {
        const normalized = genre.trim().toLocaleLowerCase();
        if (normalized && normalized !== 'unknown genre') {
          genres.add(normalized);
        }
      }
    }
    return [
      { label: 'Tracks', count: songs.length },
      { label: 'Artists', count: artists.size },
      { label: 'Genres', count: genres.size },
    ];
  }, [songs]);

  return (
    <SettingsSection icon="download" title="Library Data" description="Cache refresh and metadata controls.">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        <Button
          block
          variant="primary"
          icon="download"
          disabled={metadataFetch.running}
          onClick={async () => {
            setBulkMessage(null);
            if (metadataFetchPaused) {
              await setMetadataFetchPaused(false);
              setBulkMessage('Metadata fetching resumed. Starting bulk fetch...');
            }
            startMetadataFetch({ allowWhenActive: true });
          }}
        >
          {metadataFetch.running ? 'Fetching...' : 'Fetch Missing'}
        </Button>

        <Button
          block
          icon="folder"
          onClick={() => {
            void openStorageDir();
          }}
        >
          Storage
        </Button>

        <Button
          block
          variant="danger"
          icon="trash"
          disabled={clearingCache}
          onClick={async () => {
            if (clearingCache) {
              return;
            }
            setClearingCache(true);
            setBulkMessage(null);
            try {
              await clearStorageCache();
              resetMetadataCacheIndex();
              resetMetadataAttempts();
              setBulkMessage('Cache cleared. Restart the app to rescan library data.');
            } finally {
              setClearingCache(false);
            }
          }}
        >
          {clearingCache ? 'Clearing...' : 'Clear Cache'}
        </Button>
      </div>

      <div className="mt-3 grid gap-1">
        <Toggle
          icon="pause"
          label="Pause Metadata Lookups"
          description="Pause background metadata work."
          checked={metadataFetchPaused}
          onChange={(next) => {
            void setMetadataFetchPaused(next);
          }}
        />
      </div>

      {metadataFetch.running && metadataFetch.total > 0 ? (
        <div className="mt-3">
          <SettingsNote>
            Processed {metadataFetch.done}/{metadataFetch.total} metadata tasks. Artists {metadataFetch.artists}. Genres{' '}
            {metadataFetch.genres}.
          </SettingsNote>
        </div>
      ) : null}

      {metadataFetch.message || bulkMessage ? (
        <div className="mt-3">
          <SettingsNote>{metadataFetch.message ?? bulkMessage}</SettingsNote>
        </div>
      ) : null}

      <div className="mt-4">
        <Kicker>Library Summary</Kicker>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {librarySummary.map((item) => (
            <Surface key={item.label} variant="raised-sm" radius="sm" className="px-3 py-3 text-center">
              <p className="text-[18px] font-semibold tabular-nums text-amply-textPrimary">{item.count.toLocaleString()}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-amply-textSecondary">{item.label}</p>
            </Surface>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
};
