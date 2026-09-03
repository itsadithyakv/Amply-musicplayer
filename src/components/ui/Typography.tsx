import clsx from 'clsx';
import type { HTMLAttributes, ReactNode } from 'react';

/** 11px uppercase tracking label. */
export const Kicker = ({ className, children, ...rest }: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) => (
  <p className={clsx('amply-kicker', className)} {...rest}>
    {children}
  </p>
);

/** Section heading (h2, 15px bold). */
export const SectionTitle = ({
  className,
  children,
  description,
  ...rest
}: HTMLAttributes<HTMLHeadingElement> & { children: ReactNode; description?: ReactNode }) => (
  <div className="min-w-0">
    <h2 className={clsx('text-[15px] font-bold tracking-[-0.01em] text-amply-textPrimary', className)} {...rest}>
      {children}
    </h2>
    {description ? <p className="mt-0.5 text-[12px] leading-relaxed text-amply-textSecondary">{description}</p> : null}
  </div>
);

/** Secondary metadata line (12px). */
export const Meta = ({ className, children, ...rest }: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) => (
  <p className={clsx('text-[12px] leading-snug text-amply-textSecondary', className)} {...rest}>
    {children}
  </p>
);
