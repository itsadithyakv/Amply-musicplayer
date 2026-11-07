import { Badge, Button } from '@/components/ui';
import { useT } from '@/i18n';
import { SettingsSection } from '@/pages/Settings/SettingsSection';
import { usePlayerStore } from '@/store/playerStore';
import { useProStore } from '@/store/proStore';

export const ProSection = () => {
  const { t, tp } = useT();
  const owned = useProStore((state) => state.owned);
  const trial = useProStore((state) => state.trial);
  const offline = useProStore((state) => state.offline);
  const openPaywall = useProStore((state) => state.openPaywall);
  const startTrial = useProStore((state) => state.startTrial);
  const showToast = usePlayerStore((state) => state.showToast);

  if (!owned && trial.active && trial.endsAt) {
    const daysLeft = Math.max(1, Math.ceil((trial.endsAt * 1000 - Date.now()) / 86_400_000));
    return (
      <SettingsSection
        icon="sparkle"
        title={t('pro.paywall.title')}
        description={tp('pro.trial.daysLeft', daysLeft)}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge tone="accent" aria-label={t('pro.plan.label', { plan: t('pro.plan.trial') })}>{t('pro.plan.trial')}</Badge>
            <Button variant="primary" size="sm" onClick={() => openPaywall()}>
              {t('pro.paywall.buy')}
            </Button>
          </div>
        }
      >
        {null}
      </SettingsSection>
    );
  }

  if (owned) {
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
          <Button variant={trial.available ? 'secondary' : 'primary'} size="sm" onClick={() => openPaywall()}>
            {t('pro.settings.see')}
          </Button>
          {trial.available ? (
            <Button
              variant="primary"
              size="sm"
              icon="sparkle"
              onClick={() => {
                void startTrial().then((started) => showToast(t(started ? 'pro.trial.started' : 'pro.trial.used')));
              }}
            >
              {t('pro.trial.start')}
            </Button>
          ) : null}
        </div>
      }
    >
      {null}
    </SettingsSection>
  );
};
