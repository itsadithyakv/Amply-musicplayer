import { memo, useEffect, useMemo, useState } from 'react';
import { IconButton, Kicker, SegmentedTabs } from '@/components/ui';
import { usePlayerStore } from '@/store/playerStore';

export type NowPlayingTabId = 'lyrics' | 'queue';

const menuItemClass =
  'w-full rounded-sm px-2 py-1.5 text-left text-amply-textSecondary transition-colors hover:bg-amply-bgDeep hover:text-amply-textPrimary';

export const TabHeader = memo(
  ({ nowPlayingTab, onSelectTab }: { nowPlayingTab: NowPlayingTabId; onSelectTab: (tab: NowPlayingTabId) => void }) => {
    const albumQueueView = usePlayerStore((state) => state.albumQueueView);
    const reshuffleQueue = usePlayerStore((state) => state.reshuffleQueue);
    const isLyricsTab = nowPlayingTab === 'lyrics';
    const [settingsOpen, setSettingsOpen] = useState(false);

    const tabs = useMemo(
      () => [
        { value: 'lyrics' as const, label: 'Lyrics' },
        { value: 'queue' as const, label: 'Queue' },
      ],
      [],
    );

    useEffect(() => {
      setSettingsOpen(false);
    }, [nowPlayingTab]);

    return (
      <div className="flex items-center justify-between pb-2">
        <div className="flex-1" />
        <div className="flex flex-1 justify-center">
          <SegmentedTabs tabs={tabs} value={nowPlayingTab} onChange={onSelectTab} ariaLabel="Now playing view" />
        </div>
        <div className="relative flex flex-1 justify-end">
          <IconButton
            name="settings"
            label="Tab settings"
            variant="ghost"
            active={settingsOpen}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((prev) => !prev)}
          />
          {settingsOpen ? (
            <div className="neu-raised absolute right-0 top-11 z-raised w-48 rounded-md p-2">
              {isLyricsTab ? (
                <div className="space-y-1 text-[12px] text-amply-textSecondary">
                  <Kicker className="px-2 pb-1">Lyrics</Kicker>
                  <div className="flex items-center justify-between gap-2 px-2 py-1">
                    <span>Sync</span>
                    <div className="inline-flex items-center gap-1">
                      <IconButton
                        name="minus"
                        label="Lyrics earlier by 0.5s"
                        size="xs"
                        variant="flat"
                        onClick={() => {
                          window.dispatchEvent(new CustomEvent('amply://lyrics-offset', { detail: { deltaMs: -500 } }));
                        }}
                      />
                      <IconButton
                        name="plus"
                        label="Lyrics later by 0.5s"
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
                    Choose lyrics
                  </button>
                </div>
              ) : (
                <div className="space-y-1 text-[12px] text-amply-textSecondary">
                  <Kicker className="px-2 pb-1">Queue</Kicker>
                  {!albumQueueView ? (
                    <button
                      type="button"
                      onClick={() => {
                        reshuffleQueue();
                        setSettingsOpen(false);
                      }}
                      className={menuItemClass}
                    >
                      Re-shuffle queue
                    </button>
                  ) : (
                    <p className="px-2 py-1.5 text-[12px] text-amply-textMuted">Album mode active</p>
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
