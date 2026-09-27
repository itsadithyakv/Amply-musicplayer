import { useMemo, useState } from 'react';
import packageInfo from '../../../package.json';
import { Button, ConfirmDialog, IconButton, Modal } from '@/components/ui';
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
  const deleteSongFromDisk = useLibraryStore((state) => state.deleteSongFromDisk);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<Song | null>(null);
  const visible = groups
    .map((group) => ({ ...group, songs: group.songs.filter((song) => !removed.has(song.id)) }))
    .filter((group) => group.songs.length > 1);

  return (
    <Modal open onClose={onClose} size="lg" title="Duplicate songs" description="The same recording stored more than once. The first copy of each is the one you play most.">
      {visible.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-amply-textSecondary">No duplicates left.</p>
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
                      {formatDuration(song.duration)} · {song.playCount} plays
                    </span>
                    {index === 0 ? (
                      <span className="w-8 shrink-0 text-center text-[11px] text-amply-textMuted">keep</span>
                    ) : (
                      <IconButton name="trash" label={`Delete ${song.filename}`} size="xs" variant="danger" onClick={() => setConfirming(song)} />
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
        title="Delete this copy?"
        body={confirming ? `${confirming.path} will be deleted from disk.` : undefined}
        confirmLabel="Delete"
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

/** Duplicate finder, and backup / restore of listening history, playlists and settings. */
export const LibraryToolsSection = () => {
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
        title: 'Back up Amply',
        defaultName: `Amply backup ${date}.json`,
        filterName: 'Amply backup',
        extensions: ['json'],
        content: JSON.stringify(backup, null, 1),
      });
      if (saved) {
        setNote(`Saved ${backup.songs.length} songs' history and ${backup.playlists.length} playlists to ${saved}.`);
      }
    } catch (error) {
      setNote(`Backup failed: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setNote(null);
    try {
      const file = await openTextFile({ title: 'Restore an Amply backup', filterName: 'Amply backup', extensions: ['json'] });
      if (!file) {
        return;
      }
      const backup = parseBackup(file.content);
      if (!backup) {
        setNote('That file is not an Amply backup.');
        return;
      }
      const library = useLibraryStore.getState();
      const plan = planRestore(backup, library.songs, library.customPlaylists);
      await library.applyRestorePlan(plan);
      await usePlayerStore.getState().restoreSettings(plan.settings);
      setNote(
        `Restored history for ${plan.matchedSongs} songs and ${plan.playlists.length} playlists` +
          (plan.unmatchedSongs ? ` (${plan.unmatchedSongs} songs from the backup are not in this library).` : '.') +
          ' Reloading to apply settings…',
      );
      window.setTimeout(() => window.location.reload(), 2500);
    } catch (error) {
      setNote(`Restore failed: ${errorText(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection icon="folder" title="Library Tools" description="Duplicates, backups and restores.">
      <div className="grid gap-1">
        <SettingField
          label="Duplicate songs"
          description={
            duplicateCount === null
              ? 'Find the same recording stored more than once.'
              : duplicateCount === 0
                ? 'No duplicates found.'
                : `${duplicateCount} songs have more than one copy.`
          }
          icon="list"
          trailing={
            <Button size="sm" onClick={() => setDuplicates(findDuplicateGroups(songs))}>
              Find
            </Button>
          }
        />
        <SettingField
          label="Back up"
          description="Save play counts, favourites, playlists and settings to a file."
          icon="download"
          trailing={
            <Button size="sm" onClick={() => void backUp()} disabled={busy}>
              Back up
            </Button>
          }
        />
        <SettingField
          label="Restore"
          description="Merge a backup into this library. Nothing newer is overwritten."
          icon="refresh"
          trailing={
            <Button size="sm" onClick={() => void restore()} disabled={busy}>
              Restore
            </Button>
          }
        />
        {note ? <SettingsNote>{note}</SettingsNote> : null}
      </div>
      {duplicates && duplicates.length > 0 ? <DuplicatesModal groups={duplicates} onClose={() => setDuplicates(null)} /> : null}
    </SettingsSection>
  );
};
