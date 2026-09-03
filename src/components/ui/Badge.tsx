import clsx from 'clsx';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'info' | 'danger';

const toneClass: Record<BadgeTone, string> = {
  neutral: 'text-amply-textSecondary',
  accent: 'text-amply-accent',
  success: 'text-amply-success',
  info: 'text-amply-info',
  danger: 'text-amply-danger',
};

interface BadgeBaseProps {
  tone?: BadgeTone;
  icon?: IconName;
  /** Uppercase tracking kicker style (default) or plain sentence text. */
  uppercase?: boolean;
  children: ReactNode;
  className?: string;
}

const badgeClass = (tone: BadgeTone, uppercase: boolean, interactive: boolean, active: boolean, className?: string) =>
  clsx(
    'inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none',
    uppercase && 'uppercase tracking-[0.14em]',
    active ? 'neu-pressed-sm text-amply-accent' : 'neu-raised-sm',
    interactive && 'neu-interactive hover:text-amply-textPrimary',
    !active && toneClass[tone],
    className,
  );

export type BadgeProps = BadgeBaseProps & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>;

/** Small pill for counts, statuses and tags. */
export const Badge = ({ tone = 'neutral', icon, uppercase = true, className, children, ...rest }: BadgeProps) => (
  <span className={badgeClass(tone, uppercase, false, false, className)} {...rest}>
    {icon ? <Icon name={icon} size={12} /> : null}
    {children}
  </span>
);

export type ChipProps = BadgeBaseProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & { active?: boolean };

/** Clickable badge (filter chips, suggestions). */
export const Chip = ({ tone = 'neutral', icon, uppercase = true, active = false, className, children, type = 'button', ...rest }: ChipProps) => (
  <button type={type} aria-pressed={active} className={badgeClass(tone, uppercase, true, active, className)} {...rest}>
    {icon ? <Icon name={icon} size={12} /> : null}
    {children}
  </button>
);
