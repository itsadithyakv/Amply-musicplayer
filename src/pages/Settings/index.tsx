import { PageHeader } from '@/components/ui';
import { useT } from '@/i18n';
import { LibrarySection } from '@/pages/Settings/LibrarySection';
import { LibraryDataSection } from '@/pages/Settings/LibraryDataSection';
import { LibraryToolsSection } from '@/pages/Settings/LibraryToolsSection';
import { PlaybackSection } from '@/pages/Settings/PlaybackSection';
import { EqualizerSection } from '@/pages/Settings/EqualizerSection';
import { AppVersionSection } from '@/pages/Settings/AppVersionSection';
import { AppearanceSection } from '@/pages/Settings/AppearanceSection';
import { AppBehaviorSection } from '@/pages/Settings/AppBehaviorSection';
import { OverlaySection } from '@/pages/Settings/OverlaySection';
import { VisualizerSection } from '@/pages/Settings/VisualizerSection';
import { SleepTimerSection } from '@/pages/Settings/SleepTimerSection';
import { SmartPlaylistsSection } from '@/pages/Settings/SmartPlaylistsSection';

const SettingsPage = () => {
  const { t } = useT();

  return (
    <div className="space-y-4 pb-8">
      <PageHeader title={t('settings.page.title')} description={t('settings.page.description')} />

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.28fr)_minmax(0,0.92fr)] 2xl:items-start">
        <div className="anim-stagger grid gap-4">
          <LibrarySection />
          <LibraryDataSection />
          <LibraryToolsSection />
          <PlaybackSection />
          <EqualizerSection />
          <AppVersionSection />
        </div>

        <div className="anim-stagger grid gap-4">
          <AppearanceSection />
          <AppBehaviorSection />
          <OverlaySection />
          <VisualizerSection />
          <SleepTimerSection />
          <SmartPlaylistsSection />
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
