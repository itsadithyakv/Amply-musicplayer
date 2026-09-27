import { memo, useEffect, useMemo, useState } from 'react';
import { IconButton, Kicker, SegmentedTabs } from '@/components/ui';
import { usePlayerStore } from '@/store/playerStore';
import { useT } from '@/i18n';

export type NowPlayingTabId = 'lyrics' | 'queue';

const menuItemClass =
  'w-full rounded-sm px-2 py-1.5 text-left text-amply-textSecondary transition-colors hover:bg-amply-bgDeep hover:text-amply-textPrimary';

export const TabHeader = memo(
  ({ nowPlayingTab, onSelectTab }: { nowPlayingTab: NowPlayingTabId; onSelectTab: (tab: NowPlayingTabId) => void }) => {
    const { t } = useT();
    const albumQueueView = usePlayerStore((state) => state.albumQueueView);
    const reshuffleQueue = usePlayerStore((state) => state.reshuffleQueue);
    const isLyricsTab = nowPlayingTab === 'lyrics';
    const [settingsOpen, setSettingsOpen] = useState(false);

    const tabs = useMemo(
      () => [
        { value: 'lyrics' as const, label: t('player.lyrics') },
        { value: 'queue' as const, label: t('player.queue') },
      ],
      [t],
    );

    useEffect(() => {
      setSettingsOpen(false);
    }, [nowPlayingTab]);

    return (
      <div className="flex items-center justify-between pb-2">
        <div className="flex-1" />
        <div className="flex flex-1 justify-center">
          <SegmentedTabs tabs={tabs} value={nowPlayingTab} onChange={onSelectTab} ariaLabel={t('player.tabs.ariaLabel')} />
        </div>
        <div className="relative flex flex-1 justify-end">
          <IconButton
            name="settings"
            label={t('player.tabs.settings')}
            variant="ghost"
            active={settingsOpen}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((prev) => !prev)}
          />
          {settingsOpen ? (
            <div className="neu-raised absolute right-0 top-11 z-raised w-48 rounded-md p-2">
              {isLyricsTab ? (
                <div className="space-y-1 text-[12px] text-amply-textSecondary">
                  <Kicker className="px-2 pb-1">{t('player.lyrics')}</Kicker>
                  <div className="flex items-center justify-between gap-2 px-2 py-1">
                    <span>{t('player.tabs.sync')}</span>
                    <div className="inline-flex items-center gap-1">
                      <IconButton
                        name="minus"
                        label={t('player.tabs.lyricsEarlier')}
                        size="xs"
                        variant="flat"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('amply://lyrics-offset', { detail: { deltaMs: -500 } }));
                        }}
                      />
                      <IconButton
                        name="plus"
                        label={t('player.tabs.lyricsLater')}
                        size="xs"
                        variant="flat"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('amply://lyrics-offset', { detail: { deltaMs: 500 } }));
                        }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('amply://lyrics-choose'));
                      setSettingsOpen(false);
                    }}
                    className={menuItemClass}
                  >
                    {t('player.tabs.chooseLyrics')}
                  </button>
                </div>
              ) : (
                <div className="space-y-1 text-[12px] text-amply-textSecondary">
                  <Kicker className="px-2 pb-1">{t('player.queue')}</Kicker>
                  {!albumQueueView ? (
                    <button
                      type="button"
                      onClick={() => {
                        reshuffleQueue();
                        setSettingsOpen(false);
                      }}
                      className={menuItemClass}
                    >
                      {t('player.tabs.reshuffle')}
                    </button>
                  ) : (
                    <p className="px-2 py-1.5 text-[12px] text-amply-textMuted">{t('player.tabs.albumModeActive')}</p>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  },
);
TabHeader.displayName = 'TabHeader';
