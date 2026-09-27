import { useState } from 'react';
import { useLibraryStore } from '@/store/libraryStore';
import { Button, IconButton, TextInput } from '@/components/ui';
import { useT } from '@/i18n';
import { pickMusicFolders } from '@/services/storageService';
import { SettingsSection } from '@/pages/Settings/SettingsSection';

export const LibrarySection = () => {
  const { t } = useT();
  const libraryPaths = useLibraryStore((state) => state.libraryPaths);
  const isScanning = useLibraryStore((state) => state.isScanning);
  const addLibraryPath = useLibraryStore((state) => state.addLibraryPath);
  const removeLibraryPath = useLibraryStore((state) => state.removeLibraryPath);
  const setLibraryPaths = useLibraryStore((state) => state.setLibraryPaths);
  const scanLibrary = useLibraryStore((state) => state.scanLibrary);

  const [localPath, setLocalPath] = useState('');

  return (
    <SettingsSection icon="folder" title={t('settings.library.title')} description={t('settings.library.description')}>
      <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TextInput
            value={localPath}
            onValueChange={setLocalPath}
            icon="folder"
            placeholder={t('settings.library.pathPlaceholder')}
            aria-label={t('settings.library.pathLabel')}
            className="min-w-0 flex-1"
          />
          <Button
            variant="primary"
            icon="add"
            title={t('settings.library.addPath')}
            className="w-full sm:w-auto sm:min-w-[120px]"
            onClick={async () => {
              const value = localPath.trim();
              if (!value) {
                return;
              }
              await addLibraryPath(value);
              setLocalPath('');
            }}
          >
            {t('settings.library.addPath')}
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            block
            icon="folder"
            title={t('settings.library.browseTitle')}
            onClick={async () => {
              const picked = await pickMusicFolders();
              if (picked.length) {
                const merged = Array.from(new Set([...libraryPaths, ...picked]));
                await setLibraryPaths(merged);
              }
            }}
          >
            {t('settings.library.browse')}
          </Button>
          <Button
            block
            icon="refresh"
            title={t('settings.library.rescanTitle')}
            onClick={() => {
              void scanLibrary();
            }}
          >
            {isScanning ? t('settings.library.scanning') : t('settings.library.rescan')}
          </Button>
        </div>
      </div>

      {libraryPaths.length ? (
        <ul className="mt-4 max-h-44 space-y-1.5 overflow-y-auto pr-1">
          {libraryPaths.map((path) => (
            <li key={path} className="neu-flat flex items-center justify-between gap-3 rounded-md px-3.5 py-2">
              <p className="min-w-0 flex-1 truncate text-[12px] text-amply-textSecondary" title={path}>
                {path}
              </p>
              <IconButton
                name="trash"
                label={t('settings.library.removeFolder')}
                size="sm"
                variant="flat"
                onClick={() => {
                  void removeLibraryPath(path);
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsSection>
  );
};
