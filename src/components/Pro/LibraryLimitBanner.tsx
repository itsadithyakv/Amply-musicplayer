import { Button, Icon } from '@/components/ui';
import { useLockedSongIds } from '@/hooks/useLibraryAccess';
import { useT } from '@/i18n';
import { FREE_SONG_LIMIT } from '@/services/libraryAccess';
import { useProStore } from '@/store/proStore';

/** Shown while a free library has songs past the limit: how many are waiting, and the way to them. */
export const LibraryLimitBanner = () => {
  const { t, tp } = useT();
  const locked = useLockedSongIds();
  const openPaywall = useProStore((state) => state.openPaywall);
  if (locked.size === 0) {
    return null;
  }
  return (
    <div className="neu-raised flex flex-wrap items-center gap-4 rounded-lg px-5 py-4">
      <span className="neu-pressed-sm inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-amply-accent">
        <Icon name="lock" size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-bold text-amply-textPrimary">{tp('pro.library.waiting', locked.size)}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-amply-textSecondary">{t('pro.library.body', { limit: FREE_SONG_LIMIT })}</p>
      </div>
      <Button variant="primary" icon="library" onClick={() => openPaywall('unlimitedLibrary')}>
        {t('pro.library.unlock')}
      </Button>
    </div>
  );
};
