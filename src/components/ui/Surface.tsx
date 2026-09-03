import clsx from 'clsx';
import { forwardRef, type ElementType, type HTMLAttributes, type ReactNode } from 'react';

export type SurfaceVariant = 'raised' | 'raised-sm' | 'pressed' | 'pressed-sm' | 'flat' | 'well' | 'convex' | 'accent' | 'danger';
export type SurfaceRadius = 'none' | 'sm' | 'md' | 'lg' | 'full';

export const surfaceClass = (variant: SurfaceVariant): string => `neu-${variant}`;

export const radiusClass: Record<SurfaceRadius, string> = {
  none: 'rounded-none',
  sm: 'rounded-sm',
  md: 'rounded-md',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  variant?: SurfaceVariant;
  radius?: SurfaceRadius;
  /** Render as a different element (e.g. 'section', 'article', 'button'). */
  as?: ElementType;
  /** Adds hover/active/pressed affordances. */
  interactive?: boolean;
  /** Visually pressed-in (selected). */
  active?: boolean;
  children?: ReactNode;
}

/**
 * The one neumorphic surface. Everything visible in Amply is a Surface with a variant:
 * raised (cards, buttons), pressed (inputs, selected), flat (list rows), well (artwork/empty).
 */
export const Surface = forwardRef<HTMLElement, SurfaceProps>(
  ({ variant = 'raised', radius = 'md', as: Component = 'div', interactive = false, active = false, className, children, ...rest }, ref) => (
    <Component
      ref={ref}
      data-active={active ? 'true' : undefined}
      className={clsx(surfaceClass(variant), radiusClass[radius], interactive && 'neu-interactive', className)}
      {...rest}
    >
      {children}
    </Component>
  ),
);
Surface.displayName = 'Surface';
