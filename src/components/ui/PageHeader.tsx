import type { ReactNode } from 'react';
import { Divider } from '@/components/ui/Divider';

export interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}

export const PageHeader = ({ eyebrow, title, description, action }: PageHeaderProps) => (
  <header className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 space-y-1">
        {eyebrow ? <p className="amply-kicker">{eyebrow}</p> : null}
        <h1 className="font-display text-[30px] font-bold tracking-[-0.035em] text-amply-textPrimary">{title}</h1>
        {description ? <p className="max-w-[560px] text-[13px] leading-relaxed text-amply-textSecondary">{description}</p> : null}
      </div>
      {action}
    </div>
    <Divider accentLead />
  </header>
);
