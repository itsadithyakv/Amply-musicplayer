import { PageHeader } from '@/components/ui';
import { LibrarySection } from '@/pages/Settings/LibrarySection';
import { LibraryDataSection } from '@/pages/Settings/LibraryDataSection';
import { PlaybackSection } from '@/pages/Settings/PlaybackSection';
import { EqualizerSection } from '@/pages/Settings/EqualizerSection';
import { AppVersionSection } from '@/pages/Settings/AppVersionSection';
import { AppearanceSection } from '@/pages/Settings/AppearanceSection';
import { AppBehaviorSection } from '@/pages/Settings/AppBehaviorSection';
import { OverlaySection } from '@/pages/Settings/OverlaySection';
import { LyricsVisualsSection } from '@/pages/Settings/LyricsVisualsSection';
import { SleepTimerSection } from '@/pages/Settings/SleepTimerSection';
import { SmartPlaylistsSection } from '@/pages/Settings/SmartPlaylistsSection';

const SettingsPage = () => (
  <div className="space-y-4 pb-8">
    <PageHeader
      eyebrow="Preferences"
      title="Settings"
      description="Minimal controls for library, playback, visuals, and app behavior."
    />

    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.28fr)_minmax(0,0.92fr)] 2xl:items-start">
      <div className="anim-stagger grid gap-4">
        <LibrarySection />
        <LibraryDataSection />
        <PlaybackSection />
        <EqualizerSection />
        <AppVersionSection />
      </div>

      <div className="anim-stagger grid gap-4">
        <AppearanceSection />
        <AppBehaviorSection />
        <OverlaySection />
        <LyricsVisualsSection />
        <SleepTimerSection />
        <SmartPlaylistsSection />
      </div>
    </div>
  </div>
);

export default SettingsPage;
