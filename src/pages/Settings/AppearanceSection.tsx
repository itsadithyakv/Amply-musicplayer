import { usePlayerStore } from '@/store/playerStore';
import { Toggle } from '@/components/ui';
import { SettingsSection } from '@/pages/Settings/SettingsSection';

export const AppearanceSection = () => {
  const appTheme = usePlayerStore((state) => state.settings.appTheme);
  const setAppTheme = usePlayerStore((state) => state.setAppTheme);
  const isDark = appTheme === 'dark';

  return (
    <SettingsSection
      icon={isDark ? 'moon' : 'sun'}
      title="Appearance"
      description="Light by default, dark when you want denser contrast."
    >
      <div className="grid gap-1">
        <Toggle
          label="Use Dark Mode"
          description="Switch between the two visual themes."
          checked={isDark}
          onChange={(next) => {
            void setAppTheme(next ? 'dark' : 'light');
          }}
        />
      </div>
    </SettingsSection>
  );
};
