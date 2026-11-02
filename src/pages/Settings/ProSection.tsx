import { Badge, Button } from '@/components/ui';
import { useT } from '@/i18n';
import { SettingsSection } from '@/pages/Settings/SettingsSection';
import { useProStore } from '@/store/proStore';

export const ProSection = () => {
  const { t } = useT();
  const isPro = useProStore((state) => state.isPro);
  const offline = useProStore((state) => state.offline);
  const openPaywall = useProStore((state) => state.openPaywall);

  if (isPro) {
    return (
      <SettingsSection
        icon="sparkle"
        title={t('pro.paywall.title')}
        description={offline ? t('pro.settings.offline') : t('pro.settings.active')}
        action={
          <Badge tone="success" icon="sparkle" aria-label={t('pro.plan.label', { plan: t('pro.plan.pro') })}>
            {t('pro.plan.pro')}
          </Badge>
        }
      >
        {null}
      </SettingsSection>
    );
  }

  return (
    <SettingsSection
      icon="sparkle"
      title={t('pro.paywall.title')}
      description={t('pro.settings.free')}
      action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge aria-label={t('pro.plan.label', { plan: t('pro.plan.free') })}>{t('pro.plan.free')}</Badge>
          <Button variant="primary" size="sm" onClick={() => openPaywall()}>
            {t('pro.settings.see')}
          </Button>
        </div>
      }
    >
      {null}
    </SettingsSection>
  );
};
