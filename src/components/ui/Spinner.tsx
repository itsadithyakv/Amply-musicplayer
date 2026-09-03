import clsx from 'clsx';

export interface SpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

/** Minimal ring spinner using the accent colour. */
export const Spinner = ({ size = 16, className, label = 'Loading' }: SpinnerProps) => (
  <span
    role="status"
    aria-label={label}
    style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8)) }}
    className={clsx('inline-block shrink-0 animate-spin rounded-full border-amply-edge/40 border-t-amply-accent', className)}
  />
);
