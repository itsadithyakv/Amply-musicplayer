import { useState } from 'react';
import packageInfo from '../../../package.json';
import { Button } from '@/components/ui';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';
import { recordReviewPromptEvent, requestStoreReview } from '@/services/storeReview';
import { usePlayerStore } from '@/store/playerStore';

const APP_PACKAGE_VERSION = packageInfo.version;

export const AppVersionSection = () => {
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
      showToast('Thanks for rating Amply!');
    } else if (outcome === 'failed') {
      showToast("Couldn't open the Microsoft Store");
    }
  };

  return (
    <SettingsSection icon="info" title="App Version" description="Current Amply release.">
      <div className="grid gap-3">
        <div className="neu-pressed-sm flex min-h-[42px] items-center justify-between gap-3 rounded-full px-4 py-2">
          <span className="text-[13px] font-medium text-amply-textPrimary">Amply</span>
          <span className="text-[12px] font-medium tabular-nums text-amply-textSecondary">{APP_PACKAGE_VERSION}</span>
        </div>
        <SettingField
          label="Rate Amply"
          description="Leave a rating or review on the Microsoft Store."
          icon="heart"
          trailing={
            <Button size="sm" icon="external-link" onClick={() => void rate()} loading={rating}>
              Rate
            </Button>
          }
        />
      </div>
    </SettingsSection>
  );
};
