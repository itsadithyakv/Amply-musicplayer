import { useMemo, useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useLibraryTabView } from '@/hooks/useLibraryViews';
import { Button, Kicker, Surface, Toggle } from '@/components/ui';
import { clearStorageCache, openStorageDir } from '@/services/storageService';
import { resetMetadataCacheIndex } from '@/services/metadataCacheIndex';
import { resetMetadataAttempts } from '@/services/metadataAttemptService';
import { SettingsNote, SettingsSection } from '@/pages/Settings/SettingsSection';
import { useT } from '@/i18n';

export const LibraryDataSection = () => {
  const { t, language } = useT();
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
      { id: 'tracks', labelKey: 'settings.libraryData.tracks', count: songs.length },
      { id: 'artists', labelKey: 'settings.libraryData.artists', count: artists.size },
      { id: 'genres', labelKey: 'settings.libraryData.genres', count: genres.size },
    ] as const;
  }, [songs]);
  const numberFormat = useMemo(() => new Intl.NumberFormat(language), [language]);

  return (
    <SettingsSection icon="download" title={t('settings.libraryData.title')} description={t('settings.libraryData.description')}>
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
              setBulkMessage(t('settings.libraryData.fetchResumed'));
            }
            startMetadataFetch({ allowWhenActive: true });
          }}
        >
          {metadataFetch.running ? t('settings.libraryData.fetching') : t('settings.libraryData.fetchMissing')}
        </Button>

        <Button
          block
          icon="folder"
          onClick={() => {
            void openStorageDir();
          }}
        >
          {t('settings.libraryData.storage')}
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
              setBulkMessage(t('settings.libraryData.cacheCleared'));
            } finally {
              setClearingCache(false);
            }
          }}
        >
          {clearingCache ? t('settings.libraryData.clearing') : t('settings.libraryData.clearCache')}
        </Button>
      </div>

      <div className="mt-3 grid gap-1">
        <Toggle
          label={t('settings.libraryData.pauseLookups.label')}
          description={t('settings.libraryData.pauseLookups.description')}
          checked={metadataFetchPaused}
          onChange={(next) => {
            void setMetadataFetchPaused(next);
          }}
        />
      </div>

      {metadataFetch.running && metadataFetch.total > 0 ? (
        <div className="mt-3">
          <SettingsNote>
            {t('settings.libraryData.progress', {
              done: numberFormat.format(metadataFetch.done),
              total: numberFormat.format(metadataFetch.total),
              artists: numberFormat.format(metadataFetch.artists),
              genres: numberFormat.format(metadataFetch.genres),
            })}
          </SettingsNote>
        </div>
      ) : null}

      {metadataFetch.message || bulkMessage ? (
        <div className="mt-3">
          <SettingsNote>{metadataFetch.message ?? bulkMessage}</SettingsNote>
        </div>
      ) : null}

      <div className="mt-4">
        <Kicker>{t('settings.libraryData.summary')}</Kicker>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {librarySummary.map((item) => (
            <Surface key={item.id} variant="raised-sm" radius="sm" className="px-3 py-3 text-center">
              <p className="text-[18px] font-semibold tabular-nums text-amply-textPrimary">{numberFormat.format(item.count)}</p>
              <p className="mt-0.5 text-[11px] uppercase tracking-[0.12em] text-amply-textSecondary">{t(item.labelKey)}</p>
            </Surface>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
};
