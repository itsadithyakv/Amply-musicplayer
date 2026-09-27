import { useState } from 'react';
import packageInfo from '../../../package.json';
import { Button } from '@/components/ui';
import { useT } from '@/i18n';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';
import { recordReviewPromptEvent, requestStoreReview } from '@/services/storeReview';
import { usePlayerStore } from '@/store/playerStore';

const APP_PACKAGE_VERSION = packageInfo.version;

export const AppVersionSection = () => {
  const { t } = useT();
  const showToast = usePlayerStore((state) => state.showToast);
  const [rating, setRating] = useState(false);

  const rate = async () => {
    setRating(true);
    const outcome = await requestStoreReview();
    setRating(false);
    // Someone who went to rate from here should not also be prompted later.
    if (outcome === 'rated' || outcome === 'store-opened') {
      recordReviewPromptEvent(outcome);
    }
    if (outcome === 'rated') {
      showToast(t('settings.version.rate.thanks'));
    } else if (outcome === 'failed') {
      showToast(t('settings.version.rate.failed'));
    }
  };

  return (
    <SettingsSection icon="info" title={t('settings.version.title')} description={t('settings.version.description')}>
      <div className="grid gap-3">
        <div className="neu-pressed-sm flex min-h-[42px] items-center justify-between gap-3 rounded-full px-4 py-2">
          <span className="text-[13px] font-medium text-amply-textPrimary">Amply</span>
          <span className="text-[12px] font-medium tabular-nums text-amply-textSecondary">{APP_PACKAGE_VERSION}</span>
        </div>
        <SettingField
          label={t('settings.version.rate.label')}
          description={t('settings.version.rate.description')}
          icon="heart"
          trailing={
            <Button size="sm" icon="external-link" onClick={() => void rate()} loading={rating}>
              {t('settings.version.rate.button')}
            </Button>
          }
        />
      </div>
    </SettingsSection>
  );
};
