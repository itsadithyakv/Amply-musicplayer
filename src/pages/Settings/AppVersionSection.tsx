import { Kicker } from '@/components/ui';
import packageInfo from '../../../package.json';
import { SettingsSection } from '@/pages/Settings/SettingsSection';

const APP_PACKAGE_VERSION = packageInfo.version;

export const AppVersionSection = () => (
  <SettingsSection icon="info" title="App Version" description="Current Amply release.">
    <div className="neu-pressed-sm flex min-h-[42px] items-center justify-between gap-3 rounded-full px-4 py-2">
      <Kicker>Amply</Kicker>
      <span className="text-[12px] font-medium tabular-nums text-amply-textSecondary">{APP_PACKAGE_VERSION}</span>
    </div>
  </SettingsSection>
);
