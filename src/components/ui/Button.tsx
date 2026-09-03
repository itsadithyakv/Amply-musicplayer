import clsx from 'clsx';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Spinner } from '@/components/ui/Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const sizeClass: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 text-[11px] gap-1.5',
  md: 'min-h-10 px-4 text-[12px] gap-2',
  lg: 'min-h-12 px-5 text-[13px] gap-2',
};

const iconSize: Record<ButtonSize, 14 | 16 | 18> = { sm: 14, md: 16, lg: 18 };

const variantClass: Record<ButtonVariant, string> = {
  primary: 'neu-accent font-semibold',
  secondary: 'neu-raised-sm text-amply-textPrimary hover:text-amply-textPrimary',
  ghost: 'neu-flat text-amply-textSecondary hover:text-amply-textPrimary',
  danger: 'neu-danger font-semibold',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  /** Visually pressed-in toggle state (sets aria-pressed). */
  pressed?: boolean;
  /** Full-width pill. */
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'secondary', size = 'md', icon, iconRight, loading = false, pressed, block = false, className, children, disabled, type = 'button', ...rest },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      aria-pressed={pressed}
      disabled={disabled || loading}
      className={clsx(
        'neu-interactive inline-flex items-center justify-center rounded-full font-medium leading-none tracking-[0.01em] select-none',
        sizeClass[size],
        variantClass[variant],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size={iconSize[size]} /> : icon ? <Icon name={icon} size={iconSize[size]} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize[size]} /> : null}
    </button>
  ),
);
Button.displayName = 'Button';
