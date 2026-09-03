import type { ReactNode } from 'react';
import { Card, Icon, SectionTitle, type IconName } from '@/components/ui';

interface SettingsSectionProps {
  icon: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

/** A settings card: pressed icon chip + section title, optional action slot, body below. */
export const SettingsSection = ({ icon, title, description, action, children }: SettingsSectionProps) => (
  <Card
    as="section"
    action={action}
    title={
      <div className="flex min-w-0 items-center gap-3">
        <span className="neu-pressed-sm inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-amply-textSecondary">
          <Icon name={icon} size={16} />
        </span>
        <SectionTitle description={description}>{title}</SectionTitle>
      </div>
    }
  >
    {children}
  </Card>
);

interface SettingFieldProps {
  label: string;
  description?: ReactNode;
  icon?: IconName;
  /** Right-aligned value or control (e.g. the live slider value or a small button). */
  trailing?: ReactNode;
  children?: ReactNode;
}

/** A labelled settings row for non-switch controls (slider, select, input). Mirrors the `Toggle` row layout. */
export const SettingField = ({ label, description, icon, trailing, children }: SettingFieldProps) => (
  <div className="px-1 py-2">
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="neu-pressed-sm mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-amply-textSecondary">
            <Icon name={icon} size={16} />
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-amply-textPrimary">{label}</p>
          {description ? <p className="mt-0.5 text-[12px] leading-relaxed text-amply-textSecondary">{description}</p> : null}
        </div>
      </div>
      {trailing ? <div className="shrink-0 text-[12px] font-medium tabular-nums text-amply-textSecondary">{trailing}</div> : null}
    </div>
    {children ? <div className="mt-2">{children}</div> : null}
  </div>
);

/** Inline status message (progress, results). */
export const SettingsNote = ({ children }: { children: ReactNode }) => (
  <div role="status" className="neu-pressed-sm rounded-sm px-3.5 py-2.5 text-[12px] leading-relaxed text-amply-textSecondary">
    {children}
  </div>
);
