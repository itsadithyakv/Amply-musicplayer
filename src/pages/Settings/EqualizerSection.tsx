import { useCallback, useEffect, useRef, useState } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { Badge, Button, SegmentedTabs, Select } from '@/components/ui';
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

const EQ_GRAPH_WIDTH = 100;
const EQ_GRAPH_HEIGHT = 52;
const EQ_MIN_DB = -12;
const EQ_MAX_DB = 12;

const EQ_ACCENT = 'rgb(var(--amply-accent))';
const EQ_GRID = 'rgb(var(--amply-edge) / 0.25)';
const EQ_NODE_FILL = 'rgb(var(--amply-bg))';

const clampEqGain = (value: number): number => Math.max(EQ_MIN_DB, Math.min(EQ_MAX_DB, value));

const formatGain = (value: number): string => `${value > 0 ? '+' : ''}${value.toFixed(1)}`;

const getEqPoint = (bands: number[], index: number) => {
  const x = bands.length > 1 ? (index * EQ_GRAPH_WIDTH) / (bands.length - 1) : EQ_GRAPH_WIDTH / 2;
  const normalized = (clampEqGain(bands[index] ?? 0) - EQ_MIN_DB) / (EQ_MAX_DB - EQ_MIN_DB);
  const y = Number((EQ_GRAPH_HEIGHT - normalized * EQ_GRAPH_HEIGHT).toFixed(2));
  return { x: Number(x.toFixed(2)), y };
};

const buildEqLinePath = (bands: number[]): string => {
  if (!bands.length) {
    return '';
  }

  const points = bands.map((_, index) => getEqPoint(bands, index));
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const midX = Number(((current.x + next.x) / 2).toFixed(2));
    path += ` Q ${current.x} ${current.y} ${midX} ${Number(((current.y + next.y) / 2).toFixed(2))}`;
  }
  const penultimate = points[points.length - 2];
  const last = points[points.length - 1];
  path += ` Q ${penultimate.x} ${penultimate.y} ${last.x} ${last.y}`;
  return path;
};

const buildEqAreaPath = (bands: number[]): string => {
  if (!bands.length) {
    return '';
  }

  const linePath = buildEqLinePath(bands);
  const first = getEqPoint(bands, 0);
  const last = getEqPoint(bands, bands.length - 1);
  return `${linePath} L ${last.x} ${EQ_GRAPH_HEIGHT} L ${first.x} ${EQ_GRAPH_HEIGHT} Z`;
};

const EQGraphEditor = ({ bands, onChange }: { bands: number[]; onChange: (bands: number[]) => void }) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  /** Band currently being dragged (pointer held). */
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  /** Band highlighted in the selector below the chart. */
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (activeIndex === null) {
      return;
    }

    const updateFromPointer = (clientY: number) => {
      const svg = svgRef.current;
      if (!svg) {
        return;
      }
      const rect = svg.getBoundingClientRect();
      if (!rect.height) {
        return;
      }
      const relativeY = Math.max(0, Math.min(rect.height, clientY - rect.top));
      const ratio = 1 - relativeY / rect.height;
      const gain = clampEqGain(Number((EQ_MIN_DB + ratio * (EQ_MAX_DB - EQ_MIN_DB)).toFixed(1)));
      const next = [...bands];
      next[activeIndex] = gain;
      onChange(next);
    };

    const handlePointerMove = (event: PointerEvent) => {
      updateFromPointer(event.clientY);
    };

    const handlePointerUp = () => {
      setActiveIndex(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [activeIndex, bands, onChange]);

  const bandTabs = EQ_BANDS.map((band, index) => ({
    label: `${band.short} ${formatGain(bands[index] ?? 0)}`,
    value: String(index),
  }));

  return (
    <div>
      <div className="neu-pressed rounded-md p-3">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${EQ_GRAPH_WIDTH} ${EQ_GRAPH_HEIGHT}`}
          className="h-40 w-full touch-none sm:h-48"
          role="img"
          aria-label="Equalizer curve"
        >
          <defs>
            <linearGradient id="eqCurveFill" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={EQ_ACCENT} stopOpacity="0.2" />
              <stop offset="100%" stopColor={EQ_ACCENT} stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {[0, 25, 50, 75, 100].map((line) => {
            const y = (EQ_GRAPH_HEIGHT * line) / 100;
            return (
              <line
                key={line}
                x1="0"
                y1={y}
                x2={EQ_GRAPH_WIDTH}
                y2={y}
                stroke={EQ_GRID}
                strokeDasharray="1.5 2.5"
                strokeWidth="0.45"
              />
            );
          })}

          {EQ_BANDS.map((_, index) => {
            const point = getEqPoint(bands, index);
            return (
              <line
                key={`guide-${index}`}
                x1={point.x}
                y1="0"
                x2={point.x}
                y2={EQ_GRAPH_HEIGHT}
                stroke={EQ_GRID}
                strokeDasharray="1.5 3"
                strokeWidth="0.45"
              />
            );
          })}

          <path d={buildEqAreaPath(bands)} fill="url(#eqCurveFill)" />
          <path
            d={buildEqLinePath(bands)}
            fill="none"
            stroke={EQ_ACCENT}
            strokeWidth="1.55"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {EQ_BANDS.map((band, index) => {
            const point = getEqPoint(bands, index);
            const isActive = activeIndex === index || selectedIndex === index;
            return (
              <g key={band.freq}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={isActive ? '4.1' : '3.4'}
                  fill={EQ_NODE_FILL}
                  stroke={EQ_ACCENT}
                  strokeWidth="1.15"
                />
                <circle cx={point.x} cy={point.y} r={isActive ? '1.5' : '1.2'} fill={EQ_ACCENT} />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="8"
                  fill="transparent"
                  className="cursor-pointer"
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

      <SegmentedTabs
        className="mt-3 w-full"
        size="sm"
        ariaLabel="Equalizer band"
        tabs={bandTabs}
        value={String(selectedIndex)}
        onChange={(value) => setSelectedIndex(Number(value))}
      />
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
        <SettingField
          label="EQ Preset"
          description="Presets are templates. Drag the graph nodes below to fine-tune your own curve."
        >
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
          icon="eq"
          description="Click or drag a node to shape the curve directly."
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

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {EQ_BANDS.map((band, index) => (
              <div
                key={band.freq}
                className="neu-flat flex items-center justify-between gap-2 rounded-sm px-3 py-2.5 sm:flex-col sm:items-start"
              >
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amply-textSecondary">{band.short}</p>
                  <p className="mt-0.5 text-[12px] text-amply-textSecondary">{band.freq}</p>
                </div>
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
