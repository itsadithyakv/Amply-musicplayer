import clsx from 'clsx';
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

const shellClass = (size: 'sm' | 'md', className?: string) =>
  clsx(
    'neu-pressed-sm flex items-center gap-3 rounded-full text-amply-textPrimary',
    size === 'sm' ? 'min-h-[36px] px-3.5' : 'min-h-[42px] px-4',
    className,
  );

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value' | 'size'> {
  value: string;
  onValueChange: (value: string) => void;
  /** Visible label rendered inside the shell as a kicker. */
  label?: string;
  icon?: IconName;
  size?: 'sm' | 'md';
  inputClassName?: string;
  /** Show a clear button when there is a value. */
  clearable?: boolean;
  trailing?: ReactNode;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  ({ value, onValueChange, label, icon, size = 'md', className, inputClassName, clearable = false, trailing, id, ...rest }, ref) => {
    const autoId = useId();
    const inputId = id ?? autoId;
    return (
      <label htmlFor={inputId} className={shellClass(size, className)}>
        {icon ? <Icon name={icon} size={16} className="shrink-0 text-amply-textMuted" /> : null}
        {label ? <span className="amply-kicker shrink-0">{label}</span> : null}
        <input
          {...rest}
          ref={ref}
          id={inputId}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          className={clsx('min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-amply-textMuted', inputClassName)}
        />
        {clearable && value ? (
          <button
            type="button"
            aria-label="Clear"
            onClick={() => onValueChange('')}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-amply-textMuted hover:text-amply-textPrimary"
          >
            <Icon name="close" size={14} />
          </button>
        ) : null}
        {trailing}
      </label>
    );
  },
);
TextInput.displayName = 'TextInput';

export type SearchInputProps = Omit<TextInputProps, 'icon' | 'clearable'>;

/** TextInput preset: search icon, clearable, search semantics. */
export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>((props, ref) => (
  <TextInput ref={ref} icon="search" clearable type="search" autoComplete="off" spellCheck={false} {...props} />
));
SearchInput.displayName = 'SearchInput';

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'size'> {
  label: string;
  children: ReactNode;
  className?: string;
  selectClassName?: string;
  size?: 'sm' | 'md';
}

export const Select = ({ label, children, className, selectClassName, size = 'md', id, ...rest }: SelectProps) => {
  const autoId = useId();
  const selectId = id ?? autoId;
  return (
    <label htmlFor={selectId} className={shellClass(size, className)}>
      <span className="amply-kicker shrink-0">{label}</span>
      <select
        {...rest}
        id={selectId}
        className={clsx('min-w-0 flex-1 appearance-none bg-transparent text-[13px] font-medium outline-none', selectClassName)}
      >
        {children}
      </select>
      <Icon name="chevron-down" size={14} className="pointer-events-none shrink-0 text-amply-textMuted" />
    </label>
  );
};
