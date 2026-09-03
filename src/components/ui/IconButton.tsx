import clsx from 'clsx';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type IconButtonVariant = 'raised' | 'flat' | 'ghost' | 'accent' | 'danger';

const sizeClass: Record<IconButtonSize, string> = {
  xs: 'h-7 w-7',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
  xl: 'h-14 w-14',
};

const iconSize: Record<IconButtonSize, 14 | 16 | 18 | 20 | 24> = { xs: 14, sm: 16, md: 18, lg: 20, xl: 24 };

const variantClass: Record<IconButtonVariant, string> = {
  raised: 'neu-raised-sm text-amply-textSecondary hover:text-amply-textPrimary',
  flat: 'neu-flat text-amply-textSecondary hover:text-amply-textPrimary',
  ghost: 'bg-transparent text-amply-textSecondary hover:text-amply-textPrimary hover:neu-raised-sm',
  accent: 'neu-accent',
  danger: 'neu-danger',
};

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  name: IconName;
  /** Required accessible name (also used as the tooltip). */
  label: string;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** Pressed-in (toggled on). */
  active?: boolean;
  /** Tint the icon with the accent colour without changing the surface. */
  accentIcon?: boolean;
  /** Square instead of circular. */
  square?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ name, label, size = 'md', variant = 'raised', active, accentIcon = false, square = false, className, type = 'button', ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={clsx(
        'neu-interactive inline-flex shrink-0 items-center justify-center leading-none',
        square ? 'rounded-sm' : 'rounded-full',
        sizeClass[size],
        variantClass[variant],
        accentIcon && 'text-amply-accent hover:text-amply-accentHover',
        className,
      )}
      {...rest}
    >
      <Icon name={name} size={iconSize[size]} />
    </button>
  ),
);
IconButton.displayName = 'IconButton';
