import clsx from 'clsx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Badge, Button, Select } from '@/components/ui';
import type { AppSettings } from '@/types/music';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';

const EQ_BANDS = [
  { freq: '60Hz', short: 'Sub' },
  { freq: '250Hz', short: 'Bass' },
  { freq: '1kHz', short: 'Mid' },
  { freq: '4kHz', short: 'Presence' },
  { freq: '12kHz', short: 'Air' },
] as const;

const EQ_PRESET_LABELS: Record<AppSettings['eqPreset'], string> = {
  flat: 'Flat',
  warm: 'Warm',
  bass: 'Bass Boost',
  treble: 'Treble Lift',
  vocal: 'Vocal Focus',
  club: 'Club',
  custom: 'Custom',
};

// SVG user units. The plot area is inset so the outer nodes and their labels never clip.
const VIEW_W = 100;
const VIEW_H = 56;
const PAD_X = 9;
const PAD_Y = 7;
const PLOT_W = VIEW_W - PAD_X * 2;
const PLOT_H = VIEW_H - PAD_Y * 2;
const EQ_MIN_DB = -12;
const EQ_MAX_DB = 12;
const EQ_RANGE = EQ_MAX_DB - EQ_MIN_DB;

const EQ_ACCENT = 'rgb(var(--amply-accent))';
const EQ_GRID = 'rgb(var(--amply-edge) / 0.35)';
const EQ_BASELINE = 'rgb(var(--amply-text-muted) / 0.45)';
const EQ_LABEL = 'rgb(var(--amply-text-muted))';
const EQ_NODE_FILL = 'rgb(var(--amply-bg))';

type Point = { x: number; y: number };

const clampEqGain = (value: number): number => Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, value));
const formatGain = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
const round = (value: number): number => Number(value.toFixed(2));

const bandX = (index: number): number => round(PAD_X + (index * PLOT_W) / (EQ_BANDS.length - 1));
const gainY = (gain: number): number => round(PAD_Y + (1 - (clampEqGain(gain) - EQ_MIN_DB) / EQ_RANGE) * PLOT_H);
const ZERO_Y = gainY(0);

const eqPoints = (bands: number[]): Point[] => EQ_BANDS.map((_, index) => ({ x: bandX(index), y: gainY(bands[index] ?? 0) }));

/** Catmull-Rom spline (tension 0.5) through every node, emitted as cubic Béziers. */
const buildCurvePath = (points: Point[]): string => {
  if (!points.length) {
    return '';
  }
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const c1x = round(p1.x + (p2.x - p0.x) / 6);
    const c1y = round(p1.y + (p2.y - p0.y) / 6);
    const c2x = round(p2.x - (p3.x - p1.x) / 6);
    const c2y = round(p2.y - (p3.y - p1.y) / 6);
    path += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  return path;
};

/** The curve closed against the 0 dB baseline, so boosts fill upward and cuts fill downward. */
const buildAreaPath = (points: Point[]): string => {
  if (!points.length) {
    return '';
  }
  const first = points[0];
  const last = points[points.length - 1];
  return `${buildCurvePath(points)} L ${last.x} ${ZERO_Y} L ${first.x} ${ZERO_Y} Z`;
};

const EQGraphEditor = ({ bands, onChange }: { bands: number[]; onChange: (bands: number[]) => void }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const points = useMemo(() => eqPoints(bands), [bands]);

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }
    const gainFromClientY = (clientY: number): number | null => {
      const svg = svgRef.current;
      if (!svg) {
        return null;
      }
      const rect = svg.getBoundingClientRect();
      if (!rect.height) {
        return null;
      }
      const unitY = ((clientY - rect.top) / rect.height) * VIEW_H;
      const ratio = 1 - (unitY - PAD_Y) / PLOT_H;
      return clampEqGain(Math.round((EQ_MIN_DB + ratio * EQ_RANGE) * 2) / 2);
    };
    const handlePointerMove = (event: PointerEvent) => {
      const gain = gainFromClientY(event.clientY);
      if (gain === null || gain === bands[activeIndex]) {
        return;
      }
      const next = [...bands];
      next[activeIndex] = gain;
      onChange(next);
    };
    const handlePointerUp = () => setActiveIndex(null);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [activeIndex, bands, onChange]);

  const nudge = (index: number, delta: number) => {
    const next = [...bands];
    next[index] = clampEqGain(Number(((bands[index] ?? 0) + delta).toFixed(1)));
    onChange(next);
  };

  return (
    <div>
      <div className="neu-pressed rounded-md p-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="none"
          className="h-44 w-full touch-none sm:h-52"
          role="img"
          aria-label="Equalizer curve"
        >
          <defs>
            <linearGradient id="eqCurveFill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={EQ_ACCENT} stopOpacity="0.3" />
              <stop offset={`${((ZERO_Y - PAD_Y) / PLOT_H) * 100}%`} stopColor={EQ_ACCENT} stopOpacity="0.05" />
              <stop offset="100%" stopColor={EQ_ACCENT} stopOpacity="0.3" />
            </linearGradient>
          </defs>

          {/* horizontal grid: ±12, ±6 dashed; 0 dB solid baseline */}
          {[12, 6, -6, -12].map((db) => (
            <line key={db} x1={PAD_X} y1={gainY(db)} x2={VIEW_W - PAD_X} y2={gainY(db)} stroke={EQ_GRID} strokeDasharray="1.2 2" strokeWidth="0.35" />
          ))}
          <line x1={PAD_X} y1={ZERO_Y} x2={VIEW_W - PAD_X} y2={ZERO_Y} stroke={EQ_BASELINE} strokeWidth="0.45" />
          {[12, 0, -12].map((db) => (
            <text key={`label-${db}`} x={PAD_X - 2} y={gainY(db) + 1.1} textAnchor="end" fontSize="3" fill={EQ_LABEL}>
              {db > 0 ? `+${db}` : db}
            </text>
          ))}

          {/* vertical guides at each band */}
          {points.map((point, index) => (
            <line key={`guide-${index}`} x1={point.x} y1={PAD_Y} x2={point.x} y2={VIEW_H - PAD_Y} stroke={EQ_GRID} strokeDasharray="1.2 2" strokeWidth="0.35" />
          ))}

          <path d={buildAreaPath(points)} fill="url(#eqCurveFill)" />
          <path d={buildCurvePath(points)} fill="none" stroke={EQ_ACCENT} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ strokeWidth: 3 }} />

          {points.map((point, index) => {
            const isActive = activeIndex === index || selectedIndex === index;
            return (
              <g key={EQ_BANDS[index].freq}>
                <circle cx={point.x} cy={point.y} r={isActive ? 3.2 : 2.7} fill={EQ_NODE_FILL} stroke={EQ_ACCENT} strokeWidth="1" />
                <circle cx={point.x} cy={point.y} r={isActive ? 1.3 : 1} fill={EQ_ACCENT} />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="7"
                  fill="transparent"
                  className="cursor-ns-resize"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    setSelectedIndex(index);
                    setActiveIndex(index);
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <div role="tablist" aria-label="Equalizer band" className="neu-pressed-sm mt-3 grid grid-cols-5 gap-1 rounded-full p-1">
        {EQ_BANDS.map((band, index) => {
          const selected = selectedIndex === index;
          return (
            <button
              key={band.freq}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setSelectedIndex(index)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  nudge(index, 0.5);
                } else if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  nudge(index, -0.5);
                }
              }}
              className={clsx(
                'flex min-h-8 flex-col items-center justify-center rounded-full px-2 text-[11px] font-medium leading-tight transition-[box-shadow,color] duration-150',
                selected ? 'neu-raised-sm text-amply-textPrimary' : 'text-amply-textSecondary hover:text-amply-textPrimary',
              )}
            >
              <span>{band.short}</span>
              <span className={clsx('text-[10px]', selected ? 'text-amply-accent' : 'text-amply-textMuted')}>{formatGain(bands[index] ?? 0)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const EqualizerSection = () => {
  const eqBands = usePlayerStore((state) => state.settings.eqBands);
  const eqPreset = usePlayerStore((state) => state.settings.eqPreset);
  const setEqPreset = usePlayerStore((state) => state.setEqPreset);
  const setEqBands = usePlayerStore((state) => state.setEqBands);

  const handleBandsChange = useCallback(
    (next: number[]) => {
      void setEqBands(next);
    },
    [setEqBands],
  );

  return (
    <SettingsSection
      icon="eq"
      title="Equalizer"
      description="Presets and custom tone shaping."
      action={<Badge tone="accent">{EQ_PRESET_LABELS[eqPreset]}</Badge>}
    >
      <div className="grid gap-1">
        <SettingField label="EQ Preset" description="Presets are templates. Drag the graph nodes below to fine-tune your own curve.">
          <Select
            label="Preset"
            value={eqPreset}
            onChange={(event) => {
              void setEqPreset(event.target.value as AppSettings['eqPreset']);
            }}
          >
            {(Object.keys(EQ_PRESET_LABELS) as Array<AppSettings['eqPreset']>).map((preset) => (
              <option key={preset} value={preset}>
                {EQ_PRESET_LABELS[preset]}
              </option>
            ))}
          </Select>
        </SettingField>

        <SettingField
          label="EQ Curve"
          description="Drag a node, or select a band and use the arrow keys."
          trailing={
            <Button
              size="sm"
              icon="refresh"
              onClick={() => {
                void setEqPreset('flat');
              }}
            >
              Reset
            </Button>
          }
        >
          <EQGraphEditor bands={eqBands} onChange={handleBandsChange} />

          <div className="mt-3 grid grid-cols-5 gap-2">
            {EQ_BANDS.map((band, index) => (
              <div key={band.freq} className="neu-flat flex flex-col items-center gap-1.5 rounded-sm px-2 py-2.5 text-center">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amply-textSecondary">{band.short}</p>
                <p className="text-[12px] text-amply-textMuted">{band.freq}</p>
                <Badge tone="accent" uppercase={false}>
                  {formatGain(eqBands[index] ?? 0)} dB
                </Badge>
              </div>
            ))}
          </div>
        </SettingField>
      </div>
    </SettingsSection>
  );
};
