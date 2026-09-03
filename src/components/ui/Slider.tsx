import clsx from 'clsx';
import { type CSSProperties, type InputHTMLAttributes } from 'react';

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max' | 'step' | 'size' | 'defaultValue'> {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** Fires on every change (drag / arrow key). */
  onChange?: (value: number) => void;
  /** Fires when the user releases the thumb or a key — use for seeking. */
  onCommit?: (value: number) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
  /** Spoken value for screen readers. */
  formatValue?: (value: number) => string;
}

/** Neumorphic range input: pressed track, accent fill, raised thumb. */
export const Slider = ({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  ariaLabel,
  size = 'md',
  formatValue,
  className,
  disabled,
  ...rest
}: SliderProps) => {
  const range = max - min;
  const clamped = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
  const pct = range > 0 ? ((clamped - min) / range) * 100 : 0;
  const style = { '--fill': `${pct}%` } as CSSProperties;
  const read = (target: HTMLInputElement) => Number(target.value);

  return (
    <input
      {...rest}
      type="range"
      min={min}
      max={max}
      step={step}
      value={clamped}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-valuetext={formatValue ? formatValue(clamped) : undefined}
      style={style}
      onChange={(event) => onChange?.(read(event.currentTarget))}
      onPointerUp={(event) => onCommit?.(read(event.currentTarget))}
      onKeyUp={(event) => {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
          onCommit?.(read(event.currentTarget));
        }
      }}
      className={clsx('neu-range', size === 'sm' && 'neu-range--sm', className)}
    />
  );
};
