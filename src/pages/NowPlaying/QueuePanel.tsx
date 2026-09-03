import clsx from 'clsx';
import { memo } from 'react';
import { Badge, Card, Divider, Icon, IconButton, Kicker } from '@/components/ui';
import { beginControlInteraction } from '@/services/controlInteraction';
import { usePlayerStore } from '@/store/playerStore';
import { useQueueView } from '@/hooks/useLibraryViews';

export const QueuePanel = memo(({ active }: { active: boolean }) => {
  const { currentSongId, albumQueueView, allowReorder, items: queueDisplay } = useQueueView();
  const playSongById = usePlayerStore((state) => state.playSongById);
  const removeQueuedSong = usePlayerStore((state) => state.removeQueuedSong);
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);

  return (
    <section className={active ? 'block' : 'hidden'} aria-hidden={!active}>
      <Card padding="none">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Kicker>Queue</Kicker>
            {albumQueueView ? <Badge>Album mode</Badge> : null}
          </div>
          <span className="text-[12px] text-amply-textMuted">{queueDisplay.length} songs</span>
        </div>
        <Divider />
        <div className="max-h-[50vh] overflow-y-auto">
          {queueDisplay.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-amply-textMuted">Queue is empty.</p>
          ) : (
            <div className="anim-stagger flex flex-col gap-2 p-3" style={{ ["--stagger-step" as string]: "25ms" }}>
              {queueDisplay.map((queuedSong, index) => {
                const isCurrent = queuedSong.id === currentSongId;
                return (
                  <div
                    key={`${queuedSong.id ?? 'missing'}-${queuedSong.position}-${queuedSong.title}`}
                    draggable={allowReorder}
                    onDragStart={(event) => {
                      if (!allowReorder) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.setData('text/queue-index', String(index));
                    }}
                    onDragOver={(event) => {
                      if (allowReorder) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) => {
                      if (!allowReorder) {
                        return;
                      }
                      const from = Number(event.dataTransfer.getData('text/queue-index'));
                      reorderQueue(from, index);
                    }}
                    aria-current={isCurrent ? 'true' : undefined}
                    className={clsx(
                      'flex items-center justify-between gap-3 rounded-md px-3 py-2',
                      isCurrent ? 'neu-raised-sm' : 'neu-flat',
                      !queuedSong.available && 'opacity-40',
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => {
                        if (queuedSong.available && queuedSong.id) {
                          const finishInteraction = beginControlInteraction('queue-item-play', 'Opening track...');
                          void playSongById(queuedSong.id).finally(() => {
                            finishInteraction();
                          });
                        }
                      }}
                    >
                      {isCurrent ? <Icon name="play" size={12} className="shrink-0 text-amply-accent" /> : null}
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-amply-textPrimary">
                          {queuedSong.position}. {queuedSong.title}
                        </span>
                        <span className="block truncate text-[12px] text-amply-textSecondary">{queuedSong.subtitle}</span>
                      </span>
                    </button>
                    {albumQueueView ? (
                      <Badge tone={queuedSong.available ? 'success' : 'neutral'}>{queuedSong.available ? 'Available' : 'Missing'}</Badge>
                    ) : (
                      <IconButton
                        name="close"
                        label="Remove from queue"
                        size="xs"
                        variant="ghost"
                        onClick={() => removeQueuedSong(queuedSong.id!)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
    </section>
  );
});
QueuePanel.displayName = 'QueuePanel';
