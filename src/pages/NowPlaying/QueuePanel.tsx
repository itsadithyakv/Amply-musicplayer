import clsx from 'clsx';
import { memo, useMemo } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge, Card, Divider, Icon, IconButton, Kicker } from '@/components/ui';
import { beginControlInteraction } from '@/services/controlInteraction';
import { usePlayerStore } from '@/store/playerStore';
import { useQueueView } from '@/hooks/useLibraryViews';

type QueueItem = ReturnType<typeof useQueueView>['items'][number];

/** Row key: a song can sit in the queue more than once, so its position is part of the key. */
const itemKey = (item: QueueItem) => `${item.id ?? 'missing'}-${item.position}`;

const QueueRow = ({
  item,
  sortId,
  isCurrent,
  albumQueueView,
  allowReorder,
}: {
  item: QueueItem;
  sortId: string;
  isCurrent: boolean;
  albumQueueView: boolean;
  allowReorder: boolean;
}) => {
  const playSongById = usePlayerStore((state) => state.playSongById);
  const removeQueuedSong = usePlayerStore((state) => state.removeQueuedSong);
  // Pointer-based sorting: Windows hands file drops to the native handler, which swallows HTML5
  // drag-and-drop inside the webview.
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: sortId,
    disabled: !allowReorder,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      aria-current={isCurrent ? 'true' : undefined}
      className={clsx(
        'flex items-center justify-between gap-3 rounded-md px-3 py-2',
        isDragging ? 'neu-raised z-raised' : isCurrent ? 'neu-raised-sm' : 'neu-flat',
        !item.available && 'opacity-40',
      )}
    >
      {allowReorder ? (
        <IconButton
          ref={setActivatorNodeRef}
          name="drag"
          label={`Drag ${item.title}`}
          size="xs"
          variant="ghost"
          className="cursor-grab active:cursor-grabbing"
          {...attributes}
          {...listeners}
        />
      ) : null}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => {
          if (item.available && item.id) {
            const finishInteraction = beginControlInteraction('queue-item-play', 'Opening track...');
            void playSongById(item.id).finally(() => {
              finishInteraction();
            });
          }
        }}
      >
        {isCurrent ? <Icon name="play" size={12} className="shrink-0 text-amply-accent" /> : null}
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-amply-textPrimary">
            {item.position}. {item.title}
          </span>
          <span className="block truncate text-[12px] text-amply-textSecondary">{item.subtitle}</span>
        </span>
      </button>
      {albumQueueView ? (
        <Badge tone={item.available ? 'success' : 'neutral'}>{item.available ? 'Available' : 'Missing'}</Badge>
      ) : (
        <IconButton name="close" label="Remove from queue" size="xs" variant="ghost" onClick={() => removeQueuedSong(item.id!)} />
      )}
    </div>
  );
};

export const QueuePanel = memo(({ active }: { active: boolean }) => {
  const { currentSongId, albumQueueView, allowReorder, items: queueDisplay } = useQueueView();
  const reorderQueue = usePlayerStore((state) => state.reorderQueue);
  const sortIds = useMemo(() => queueDisplay.map(itemKey), [queueDisplay]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active: dragged, over }: DragEndEvent) => {
    if (!over || dragged.id === over.id) {
      return;
    }
    const from = sortIds.indexOf(String(dragged.id));
    const to = sortIds.indexOf(String(over.id));
    if (from >= 0 && to >= 0) {
      reorderQueue(from, to);
    }
  };

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
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={sortIds} strategy={verticalListSortingStrategy}>
                <div className="anim-stagger flex flex-col gap-2 p-3" style={{ ['--stagger-step' as string]: '25ms' }}>
                  {queueDisplay.map((item, index) => (
                    <QueueRow
                      key={sortIds[index]}
                      item={item}
                      sortId={sortIds[index]}
                      isCurrent={item.id === currentSongId}
                      albumQueueView={Boolean(albumQueueView)}
                      allowReorder={allowReorder}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </Card>
    </section>
  );
});
QueuePanel.displayName = 'QueuePanel';
