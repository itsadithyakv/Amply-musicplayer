import clsx from 'clsx';
import type { ReactNode } from 'react';

export interface ToastProps {
  children: ReactNode;
  className?: string;
}

/** Transient message pill anchored above the player bar. Rendering is controlled by the caller. */
export const Toast = ({ children, className }: ToastProps) => (
  <div role="status" aria-live="polite" className={clsx('anim-toast-in pointer-events-none absolute bottom-24 left-1/2 z-toast -translate-x-1/2', className)}>
    <div className="neu-raised rounded-full px-4 py-2 text-[12px] font-medium text-amply-textPrimary">{children}</div>
  </div>
);
