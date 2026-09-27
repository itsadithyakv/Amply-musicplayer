import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { useT } from '@/i18n';

export interface Column {
  /** Category shown under the axis and in the tooltip ("Mon 21", "14:00"). */
  label: string;
  /** Short axis label; empty to leave that tick blank. */
  tick: string;
  value: number;
  /** The value as the reader should see it ("42 min", "3 plays"). */
  display: string;
}

const HEIGHT = 160;
const AXIS = 22;
const TOP_PAD = 18;
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;

/** Column path: 4px rounded data-end at the top, square where it meets the baseline. */
const columnPath = (x: number, width: number, top: number, bottom: number) => {
  const r = Math.min(RADIUS, width / 2, bottom - top);
  return `M${x},${bottom} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${bottom} Z`;
};

/**
 * One series of columns (single hue, so no legend: the card title names it). Every column is a
 * focusable hit target with a tooltip; the tallest carries the only direct label; a table view
 * holds every value without hovering.
 */
export const ColumnChart = ({ title, columns }: { title: string; columns: Column[] }) => {
  const { t } = useT();
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry.contentRect.width)));
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const max = Math.max(...columns.map((column) => column.value), 0);
  const peak = columns.findIndex((column) => column.value === max && max > 0);
  const slot = width / Math.max(columns.length, 1);
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot - GAP));
  const baseline = HEIGHT - AXIS;
  const scale = (value: number) => (max > 0 ? ((baseline - TOP_PAD) * value) / max : 0);
  const activeColumn = active === null ? null : columns[active];

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-[13px] font-semibold text-amply-textPrimary">{title}</h3>
        <Button size="sm" variant="ghost" onClick={() => setShowTable((current) => !current)} aria-pressed={showTable}>
          {showTable ? t('stats.charts.showChart') : t('stats.charts.showTable')}
        </Button>
      </div>
      {showTable ? (
        <div className="max-h-[200px] overflow-y-auto">
          <table className="w-full text-[12px]">
            <tbody>
              {columns.map((column) => (
                <tr key={column.label} className="border-b border-amply-edge/40 last:border-0">
                  <th scope="row" className="py-1 text-left font-medium text-amply-textSecondary">
                    {column.label}
                  </th>
                  <td className="py-1 text-right tabular-nums text-amply-textPrimary">{column.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={frameRef} className="relative" onPointerLeave={() => setActive(null)}>
          <svg width={width} height={HEIGHT} role="img" aria-label={title} className="block overflow-visible">
            <line x1={0} x2={width} y1={baseline + 0.5} y2={baseline + 0.5} className="stroke-amply-textMuted/30" strokeWidth={1} />
            {columns.map((column, index) => {
              const x = index * slot + (slot - barWidth) / 2;
              const height = scale(column.value);
              return (
                <g key={column.label}>
                  {/* The whole slot is the hit target, not just the painted column. */}
                  <rect
                    x={index * slot}
                    y={0}
                    width={slot}
                    height={baseline}
                    fill="transparent"
                    tabIndex={0}
                    role="img"
                    aria-label={`${column.label}: ${column.display}`}
                    onPointerEnter={() => setActive(index)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                    className="outline-none"
                  />
                  {height > 0 ? (
                    <path
                      d={columnPath(x, barWidth, baseline - height, baseline)}
                      className={active === index ? 'fill-amply-chart' : 'fill-amply-chart/85'}
                      pointerEvents="none"
                    />
                  ) : null}
                  {index === peak ? (
                    <text x={x + barWidth / 2} y={baseline - height - 5} textAnchor="middle" className="fill-amply-textSecondary text-[11px]" pointerEvents="none">
                      {column.display}
                    </text>
                  ) : null}
                  {column.tick ? (
                    <text x={x + barWidth / 2} y={HEIGHT - 6} textAnchor="middle" className="fill-amply-textMuted text-[10px]" pointerEvents="none">
                      {column.tick}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          {activeColumn && active !== null ? (
            <div
              role="status"
              className="neu-raised-sm pointer-events-none absolute z-raised -translate-x-1/2 rounded-md px-2.5 py-1.5 text-center"
              style={{ left: Math.min(Math.max(active * slot + slot / 2, 50), width - 50), top: 0 }}
            >
              <p className="text-[13px] font-semibold tabular-nums text-amply-textPrimary">{activeColumn.display}</p>
              <p className="text-[11px] text-amply-textSecondary">{activeColumn.label}</p>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
