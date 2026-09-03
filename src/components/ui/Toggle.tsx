import clsx from 'clsx';
import { useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'checked' | 'size'> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** When given, renders a full settings row (label + description + switch). */
  label?: ReactNode;
  description?: ReactNode;
  icon?: IconName;
}

/** Neumorphic switch. Bare when `label` is omitted, otherwise a labelled settings row. */
export const Toggle = ({ checked, onChange, label, description, icon, className, id, disabled, ...rest }: ToggleProps) => {
  const autoId = useId();
  const inputId = id ?? autoId;
  const input = (
    <input
      {...rest}
      id={inputId}
      type="checkbox"
      role="switch"
      aria-checked={checked}
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className={clsx('neu-toggle', !label && className)}
    />
  );

  if (!label) {
    return input;
  }

  return (
    <label
      htmlFor={inputId}
      className={clsx(
        'flex items-start justify-between gap-4 rounded-md px-1 py-2',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <span className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="neu-pressed-sm mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-amply-textSecondary">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold text-amply-textPrimary">{label}</span>
          {description ? <span className="mt-0.5 block text-[12px] leading-relaxed text-amply-textSecondary">{description}</span> : null}
        </span>
      </span>
      <span className="mt-1 shrink-0">{input}</span>
    </label>
  );
};
