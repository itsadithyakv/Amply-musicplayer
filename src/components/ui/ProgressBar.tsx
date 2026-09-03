import clsx from 'clsx';

export interface ProgressBarProps {
  /** 0–1. Ignored when indeterminate. */
  value?: number;
  indeterminate?: boolean;
  ariaLabel: string;
  className?: string;
}

/** Non-interactive progress track (scan / metadata / buffering). */
export const ProgressBar = ({ value = 0, indeterminate = false, ariaLabel, className }: ProgressBarProps) => {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className={clsx('neu-progress', indeterminate && 'neu-progress--indeterminate', className)}
    >
      <span style={indeterminate ? undefined : { width: `${pct}%` }} />
    </div>
  );
};
