import { usePlayerStore } from '@/store/playerStore';
import { Select, Toggle } from '@/components/ui';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';
import { detectLanguage, LANGUAGES, useT } from '@/i18n';
import type { AppSettings } from '@/types/music';

const languageLabel = (code: string) => LANGUAGES.find((language) => language.code === code)?.label ?? code;

export const AppearanceSection = () => {
  const { t } = useT();
  const appTheme = usePlayerStore((state) => state.settings.appTheme);
  const setAppTheme = usePlayerStore((state) => state.setAppTheme);
  const language = usePlayerStore((state) => state.settings.language);
  const setLanguageSetting = usePlayerStore((state) => state.setLanguageSetting);
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
        <SettingField label={t('settings.language.label')} description={t('settings.language.description')}>
          <Select
            label={t('settings.language.label')}
            value={language}
            onChange={(event) => void setLanguageSetting(event.target.value as AppSettings['language'])}
          >
            <option value="system">{t('settings.language.system', { language: languageLabel(detectLanguage()) })}</option>
            {LANGUAGES.map((option) => (
              // Each language is named in itself, so it can be found from any other.
              <option key={option.code} value={option.code} lang={option.code}>
                {option.label}
              </option>
            ))}
          </Select>
        </SettingField>
      </div>
    </SettingsSection>
  );
};
