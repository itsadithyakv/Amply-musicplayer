import type { ComponentType, ReactNode } from 'react';
import AutoSizer from 'react-virtualized-auto-sizer';
import { FixedSizeList as List, type ListChildComponentProps } from 'react-window';

type CardGridData<T> = {
  items: T[];
  columns: number;
  renderItem: (item: T) => ReactNode;
  getKey: (item: T, index: number) => string;
};

const CARD_MIN_WIDTH = 190;
const CARD_GAP = 18;
const CARD_HEIGHT = 244;

const CardGridRow = <T,>({ index, style, data }: ListChildComponentProps<CardGridData<T>>) => {
  const { items, columns, renderItem, getKey } = data;
  const start = index * columns;
  const slice = items.slice(start, start + columns);

  return (
    <div style={{ ...style, paddingBottom: CARD_GAP }}>
      <div className="grid h-full" style={{ gap: CARD_GAP, gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {slice.map((item, offset) => (
          <div key={getKey(item, start + offset)} className="h-full [&>*]:h-full">
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
};

export interface LibraryCardGridProps<T> {
  items: T[];
  getKey: (item: T, index: number) => string;
  renderItem: (item: T) => ReactNode;
}

/** Virtualised, responsive card grid (react-window rows of N cards) used by the album / artist / genre tabs. */
export const LibraryCardGrid = <T,>({ items, getKey, renderItem }: LibraryCardGridProps<T>) => (
  <div className="anim-rise h-[70vh]">
    <AutoSizer>
      {({ height, width }) => {
        const columns = Math.max(1, Math.floor((width + CARD_GAP) / (CARD_MIN_WIDTH + CARD_GAP)));
        const rowCount = Math.ceil(items.length / columns);
        const data: CardGridData<T> = { items, columns, getKey, renderItem };
        return (
          <List<CardGridData<T>>
            height={height}
            width={width}
            itemCount={rowCount}
            itemSize={CARD_HEIGHT + CARD_GAP}
            itemData={data}
            overscanCount={3}
          >
            {CardGridRow as ComponentType<ListChildComponentProps<CardGridData<T>>>}
          </List>
        );
      }}
    </AutoSizer>
  </div>
);
