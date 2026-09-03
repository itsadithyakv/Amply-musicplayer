import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Surface, type SurfaceProps } from '@/components/ui/Surface';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

const paddingClass: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export interface CardProps extends Omit<SurfaceProps, 'title'> {
  padding?: CardPadding;
  /** Optional header row (title + action) rendered above the body. */
  title?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
}

/** A raised panel with optional header and footer rows. */
export const Card = ({ padding = 'md', title, action, footer, className, children, variant = 'raised', radius = 'md', ...rest }: CardProps) => (
  <Surface variant={variant} radius={radius} className={clsx(paddingClass[padding], className)} {...rest}>
    {title || action ? (
      <div className="mb-3 flex items-center justify-between gap-3">
        {typeof title === 'string' ? <h2 className="text-[15px] font-bold text-amply-textPrimary">{title}</h2> : title}
        {action}
      </div>
    ) : null}
    {children}
    {footer ? <div className="mt-4 flex items-center justify-end gap-2">{footer}</div> : null}
  </Surface>
);
