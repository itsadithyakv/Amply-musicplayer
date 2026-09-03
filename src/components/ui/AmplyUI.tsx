/**
 * LEGACY SHIM — re-exports the old AmplyUI names on top of the new primitives so un-migrated
 * pages keep compiling. Deleted at the end of Phase A6; import from '@/components/ui' instead.
 */
import clsx from 'clsx';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Surface } from '@/components/ui/Surface';

export { PageHeader } from '@/components/ui/PageHeader';
export { SegmentedTabs } from '@/components/ui/SegmentedTabs';
export { SearchInput as UnifiedSearchInput, Select as UnifiedSelectInput } from '@/components/ui/Input';

export const SoftPanel = ({ children, className, ...props }: { children: ReactNode; className?: string } & HTMLAttributes<HTMLDivElement>) => (
  <Surface variant="raised" radius="lg" className={className} {...props}>
    {children}
  </Surface>
);

export const PillButton = ({
  children,
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) => (
  <Button variant={variant} {...props}>
    {children}
  </Button>
);

/** Old children-based icon button (pages still pass an <img>). */
export const IconButton = ({ children, className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    type={type}
    className={clsx(
      'neu-interactive neu-raised-sm inline-flex h-10 w-10 items-center justify-center rounded-full text-amply-textSecondary hover:text-amply-textPrimary disabled:cursor-not-allowed disabled:opacity-60',
      className,
    )}
  >
    {children}
  </button>
);
