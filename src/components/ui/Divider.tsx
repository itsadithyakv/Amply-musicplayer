import clsx from 'clsx';

export interface DividerProps {
  /** Leading 34px accent segment, as used under page headers. */
  accentLead?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

export const Divider = ({ accentLead = false, orientation = 'horizontal', className }: DividerProps) => {
  if (orientation === 'vertical') {
    return <span aria-hidden="true" className={clsx('inline-block h-full w-px self-stretch bg-amply-edge/[0.12]', className)} />;
  }
  return <div aria-hidden="true" className={clsx(accentLead ? 'amply-hairline' : 'h-px w-full bg-amply-edge/[0.12]', className)} />;
};
