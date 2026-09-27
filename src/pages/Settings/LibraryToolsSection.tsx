import { useMemo, useState } from 'react';
import packageInfo from '../../../package.json';
import { Button, ConfirmDialog, IconButton, Modal } from '@/components/ui';
import { useT } from '@/i18n';
import { SettingField, SettingsNote, SettingsSection } from '@/pages/Settings/SettingsSection';
import { buildBackup, parseBackup, planRestore } from '@/services/backup';
import { findDuplicateGroups, type DuplicateGroup } from '@/services/duplicates';
import { openTextFile, saveTextFile } from '@/services/fileDialogs';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import type { Song } from '@/types/music';
import { formatDuration } from '@/utils/time';

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

const DuplicatesModal = ({ groups, onClose }: { groups: DuplicateGroup[]; onClose: () => void }) => {
  const { t, tp } = useT();
  const deleteSongFromDisk = useLibraryStore((state) => state.deleteSongFromDisk);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<Song | null>(null);
  const visible = groups
    .map((group) => ({ ...group, songs: group.songs.filter((song) => !removed.has(song.id)) }))
    .filter((group) => group.songs.length > 1);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={t('settings.libraryTools.duplicates.label')}
      description={t('settings.libraryTools.modal.description')}
    >
      {visible.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-amply-textSecondary">{t('settings.libraryTools.modal.empty')}</p>
      ) : (
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto pr-1">
          {visible.map((group) => (
            <div key={group.key} className="neu-flat rounded-md p-3">
              <p className="truncate text-[13px] font-semibold text-amply-textPrimary">{group.title}</p>
              <p className="mb-2 truncate text-[12px] text-amply-textSecondary">{group.artist}</p>
              <ul className="grid gap-1">
                {group.songs.map((song, index) => (
                  <li key={song.id} className="flex items-center gap-2 text-[12px]">
                    <span className="min-w-0 flex-1 truncate text-amply-textSecondary" title={song.path}>
                      {song.path}
                    </span>
                    <span className="shrink-0 tabular-nums text-amply-textMuted">
                      {formatDuration(song.duration)} · {tp('settings.libraryTools.modal.plays', song.playCount)}
                    </span>
                    {index === 0 ? (
                      <span className="min-w-8 shrink-0 text-center text-[11px] text-amply-textMuted">{t('settings.libraryTools.modal.keep')}</span>
                    ) : (
                      <IconButton
                        name="trash"
                        label={t('settings.libraryTools.modal.deleteFile', { name: song.filename })}
                        size="xs"
                        variant="danger"
                        onClick={() => setConfirming(song)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirming !== null}
        title={t('settings.libraryTools.modal.confirmTitle')}
        body={confirming ? t('settings.libraryTools.modal.confirmBody', { path: confirming.path }) : undefined}
        confirmLabel={t('settings.libraryTools.modal.confirmDelete')}
        danger
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          const song = confirming;
          setConfirming(null);
          if (song) {
            void deleteSongFromDisk(song.id).then((deleted) => {
              if (deleted) {
                setRemoved((current) => new Set(current).add(song.id));
              }
            });
          }
        }}
      />
    </Modal>
  );
};

/** "{n} songs" and "{n} playlists", for the backup and restore notes. */
const historyCounts = (tp: ReturnType<typeof useT>['tp'], songs: number, playlists: number) => ({
  songs: tp('settings.libraryTools.songs', songs),
  playlists: tp('settings.libraryTools.playlists', playlists),
});

/** Duplicate finder, and backup / restore of listening history, playlists and settings. */
export const LibraryToolsSection = () => {
  const { t, tp } = useT();
  const songs = useLibraryStore((state) => state.songs);
  const [duplicates, setDuplicates] = useState<DuplicateGroup[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const duplicateCount = useMemo(() => (duplicates ? duplicates.length : null), [duplicates]);

  const backUp = async () => {
    setBusy(true);
    setNote(null);
    try {
      const library = useLibraryStore.getState();
      const backup = buildBackup({
        songs: library.songs,
        customPlaylists: library.customPlaylists,
        settings: usePlayerStore.getState().settings,
        appVersion: packageInfo.version,
      });
      const date = backup.exportedAt.slice(0, 10);
      const saved = await saveTextFile({
        title: t('settings.libraryTools.backup.dialogTitle'),
        defaultName: t('settings.libraryTools.backup.fileName', { date }),
        filterName: t('settings.libraryTools.backup.filterName'),
        extensions: ['json'],
        content: JSON.stringify(backup, null, 1),
      });
      if (saved) {
        setNote(t('settings.libraryTools.backup.saved', { ...historyCounts(tp, backup.songs.length, backup.playlists.length), path: saved }));
      }
    } catch (error) {
      setNote(t('settings.libraryTools.backup.failed', { error: errorText(error) }));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setNote(null);
    try {
      const file = await openTextFile({
        title: t('settings.libraryTools.restore.dialogTitle'),
        filterName: t('settings.libraryTools.backup.filterName'),
        extensions: ['json'],
      });
      if (!file) {
        return;
      }
      const backup = parseBackup(file.content);
      if (!backup) {
        setNote(t('settings.libraryTools.restore.notBackup'));
        return;
      }
      const library = useLibraryStore.getState();
      const plan = planRestore(backup, library.songs, library.customPlaylists);
      await library.applyRestorePlan(plan);
      await usePlayerStore.getState().restoreSettings(plan.settings);
      setNote(
        [
          t('settings.libraryTools.restore.done', historyCounts(tp, plan.matchedSongs, plan.playlists.length)),
          plan.unmatchedSongs ? tp('settings.libraryTools.restore.unmatched', plan.unmatchedSongs) : null,
          t('settings.libraryTools.restore.reloading'),
        ]
          .filter(Boolean)
          .join(' '),
      );
      window.setTimeout(() => window.location.reload(), 2500);
    } catch (error) {
      setNote(t('settings.libraryTools.restore.failed', { error: errorText(error) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection icon="folder" title={t('settings.libraryTools.title')} description={t('settings.libraryTools.description')}>
      <div className="grid gap-1">
        <SettingField
          label={t('settings.libraryTools.duplicates.label')}
          description={
            duplicateCount === null
              ? t('settings.libraryTools.duplicates.description')
              : duplicateCount === 0
                ? t('settings.libraryTools.duplicates.none')
                : tp('settings.libraryTools.duplicates.found', duplicateCount)
          }
          icon="list"
          trailing={
            <Button size="sm" onClick={() => setDuplicates(findDuplicateGroups(songs))}>
              {t('settings.libraryTools.duplicates.find')}
            </Button>
          }
        />
        <SettingField
          label={t('settings.libraryTools.backup.label')}
          description={t('settings.libraryTools.backup.description')}
          icon="download"
          trailing={
            <Button size="sm" onClick={() => void backUp()} disabled={busy}>
              {t('settings.libraryTools.backup.button')}
            </Button>
          }
        />
        <SettingField
          label={t('settings.libraryTools.restore.label')}
          description={t('settings.libraryTools.restore.description')}
          icon="refresh"
          trailing={
            <Button size="sm" onClick={() => void restore()} disabled={busy}>
              {t('settings.libraryTools.restore.button')}
            </Button>
          }
        />
        {note ? <SettingsNote>{note}</SettingsNote> : null}
      </div>
      {duplicates && duplicates.length > 0 ? <DuplicatesModal groups={duplicates} onClose={() => setDuplicates(null)} /> : null}
    </SettingsSection>
  );
};
