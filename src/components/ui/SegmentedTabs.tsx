import clsx from 'clsx';
import { useRef, type KeyboardEvent } from 'react';

export interface SegmentedTabsProps<T extends string> {
  tabs: Array<{ label: string; value: T; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: 'sm' | 'md';
  /** 'grouped' = pressed track with a raised active tab (default); 'bare' = free-standing pills. */
  variant?: 'grouped' | 'bare';
  ariaLabel?: string;
}

export const SegmentedTabs = <T extends string>({ tabs, value, onChange, className, size = 'md', variant = 'grouped', ariaLabel }: SegmentedTabsProps<T>) => {
  const listRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const enabled = tabs.filter((tab) => !tab.disabled);
    const index = enabled.findIndex((tab) => tab.value === value);
    const next = enabled[(index + (event.key === 'ArrowRight' ? 1 : enabled.length - 1)) % enabled.length];
    if (next) {
      onChange(next.value);
      listRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
    }
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={clsx(
        'inline-flex max-w-full flex-wrap items-center',
        variant === 'grouped' ? 'neu-pressed-sm gap-1 rounded-full p-1' : 'gap-2',
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            data-value={tab.value}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.value)}
            className={clsx(
              'rounded-full font-medium leading-none tracking-[0.01em] transition-[box-shadow,color] duration-150 disabled:opacity-50',
              size === 'sm' ? 'min-h-7 px-3 text-[11px]' : 'min-h-9 px-4 text-[12px]',
              variant === 'grouped'
                ? active
                  ? 'neu-raised-sm text-amply-textPrimary'
                  : 'text-amply-textSecondary hover:text-amply-textPrimary'
                : active
                  ? 'neu-pressed-sm text-amply-accent'
                  : 'neu-raised-sm text-amply-textSecondary hover:text-amply-textPrimary',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
