import clsx from 'clsx';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export const PageHeader = ({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) => (
  <header className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 space-y-1">
        {eyebrow ? <p className="amply-kicker">{eyebrow}</p> : null}
        <h1 className="font-display text-[30px] font-bold tracking-[-0.035em] text-amply-textPrimary">{title}</h1>
        {description ? <p className="max-w-[560px] text-[13px] leading-relaxed text-amply-textSecondary">{description}</p> : null}
      </div>
      {action}
    </div>
    <div className="amply-hairline" />
  </header>
);

export const SoftPanel = ({
  children,
  className,
  ...props
}: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) => (
  <div {...props} className={clsx('ui-soft-card rounded-[24px]', className)}>
    {children}
  </div>
);

export const SegmentedTabs = <T extends string>({
  tabs,
  value,
  onChange,
  className,
  variant = 'grouped',
}: {
  tabs: Array<{ label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  variant?: 'grouped' | 'bare';
}) => (
  <div
    className={clsx(
      'inline-flex flex-wrap items-center',
      variant === 'grouped'
        ? 'gap-1 rounded-[18px] bg-[var(--control-surface)] p-1 shadow-[inset_0_0_0_1px_var(--control-border)]'
        : 'gap-2',
      className,
    )}
    role="tablist"
  >
    {tabs.map((tab) => {
      const active = tab.value === value;
      return (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={active}
          onClick={() => onChange(tab.value)}
          className={clsx(
            'min-h-9 rounded-[14px] px-4 py-2 text-[12px] font-medium tracking-[0.01em] transition-colors duration-150',
            variant === 'bare'
              ? active
                ? 'bg-amply-accent text-black'
                : 'bg-[var(--control-surface)] text-amply-textSecondary shadow-[inset_0_0_0_1px_var(--control-border)] hover:bg-amply-hover hover:text-amply-textPrimary'
              : active
                ? 'bg-[var(--sidebar-active)] text-amply-textPrimary shadow-[0_2px_6px_rgba(105,82,58,0.10),0_8px_14px_rgba(105,82,58,0.12)]'
                : 'text-amply-textSecondary hover:bg-[var(--sidebar-hover)] hover:text-amply-textPrimary',
          )}
        >
          {tab.label}
        </button>
      );
    })}
  </div>
);

export const UnifiedSearchInput = ({
  value,
  onValueChange,
  placeholder,
  className,
  inputClassName,
  ...inputProps
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  value: string;
  onValueChange: (value: string) => void;
  inputClassName?: string;
}) => (
  <div
    className={clsx(
      'flex min-h-[42px] min-w-[220px] items-center gap-3 rounded-[14px] bg-[var(--control-surface)] px-4 py-2.5 shadow-[inset_0_0_0_1px_var(--control-border)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_rgb(var(--amply-accent)/0.75)]',
      className,
    )}
  >
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amply-accent" aria-hidden="true" />
    <input
      {...inputProps}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      placeholder={placeholder}
      className={clsx('min-w-0 flex-1 bg-transparent text-[13px] text-amply-textPrimary outline-none placeholder:text-amply-textMuted', inputClassName)}
    />
  </div>
);

export const UnifiedSelectInput = ({
  label,
  children,
  className,
  selectClassName,
  ...selectProps
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & {
  label: string;
  children: ReactNode;
  className?: string;
  selectClassName?: string;
}) => (
  <label
    className={clsx(
      'flex min-h-[42px] min-w-[220px] items-center gap-3 rounded-[14px] bg-[var(--control-surface)] px-4 py-2.5 shadow-[inset_0_0_0_1px_var(--control-border)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_rgb(var(--amply-accent)/0.75)]',
      className,
    )}
  >
    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amply-textMuted">{label}</span>
    <select
      {...selectProps}
      className={clsx(
        'min-w-0 flex-1 bg-transparent text-[13px] font-medium text-amply-textPrimary outline-none',
        selectClassName,
      )}
    >
      {children}
    </select>
  </label>
);

export const PillButton = ({
  children,
  className,
  variant = 'secondary',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary';
}) => (
  <button
    {...props}
    className={clsx(
      'inline-flex min-h-10 items-center justify-center gap-2 rounded-[14px] px-4 py-2.5 text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
      variant === 'primary'
        ? 'bg-amply-accent text-black hover:bg-amply-accentHover'
        : 'bg-[var(--control-surface)] text-amply-textSecondary shadow-[inset_0_0_0_1px_var(--control-border)] hover:bg-amply-hover hover:text-amply-textPrimary',
      className,
    )}
  >
    {children}
  </button>
);

export const IconButton = ({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    {...props}
    className={clsx(
      'inline-flex h-10 w-10 items-center justify-center rounded-[14px] bg-[var(--control-surface)] text-amply-textSecondary shadow-[inset_0_0_0_1px_var(--control-border)] transition-colors hover:bg-amply-hover hover:text-amply-textPrimary disabled:cursor-not-allowed disabled:opacity-60',
      className,
    )}
  >
    {children}
  </button>
);
