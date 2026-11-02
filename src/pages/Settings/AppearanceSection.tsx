import { requirePro, useProStore } from '@/store/proStore';
import { useEffectiveSetting } from '@/hooks/useEffectiveSettings';
import { LockedRow, ProBadge } from '@/components/Pro/ProGate';
import clsx from 'clsx';
import { usePlayerStore } from '@/store/playerStore';
import { Icon, Select, Toggle } from '@/components/ui';
import { SettingField, SettingsSection } from '@/pages/Settings/SettingsSection';
import { detectLanguage, LANGUAGES, useT, type MessageKey } from '@/i18n';
import type { AccentColor, AppSettings } from '@/types/music';

/** Each accent with the swatch shown for it (its light-theme value). */
const ACCENTS: ReadonlyArray<readonly [AccentColor, string]> = [
  ['amber', 'rgb(235 126 35)'],
  ['rose', 'rgb(210 54 98)'],
  ['violet', 'rgb(114 82 226)'],
  ['blue', 'rgb(40 110 216)'],
  ['teal', 'rgb(17 155 144)'],
  ['green', 'rgb(63 156 80)'],
  ['gold', 'rgb(178 128 19)'],
  ['graphite', 'rgb(70 76 90)'],
];

const ACCENT_LABELS: Record<AccentColor, MessageKey> = {
  amber: 'settings.appearance.accent.amber',
  rose: 'settings.appearance.accent.rose',
  violet: 'settings.appearance.accent.violet',
  blue: 'settings.appearance.accent.blue',
  teal: 'settings.appearance.accent.teal',
  green: 'settings.appearance.accent.green',
  gold: 'settings.appearance.accent.gold',
  graphite: 'settings.appearance.accent.graphite',
};

const languageLabel = (code: string) => LANGUAGES.find((language) => language.code === code)?.label ?? code;

export const AppearanceSection = () => {
  const { t } = useT();
  const appTheme = usePlayerStore((state) => state.settings.appTheme);
  const setAppTheme = usePlayerStore((state) => state.setAppTheme);
  const language = usePlayerStore((state) => state.settings.language);
  const setLanguageSetting = usePlayerStore((state) => state.setLanguageSetting);
  const isDark = appTheme === 'dark';
  const isPro = useProStore((state) => state.isPro);
  const accent = useEffectiveSetting((settings) => settings.accentColor);
  const trueBlack = useEffectiveSetting((settings) => settings.trueBlack);
  const setAccentColor = usePlayerStore((state) => state.setAccentColor);
  const setTrueBlack = usePlayerStore((state) => state.setTrueBlack);

  return (
    <SettingsSection
      icon={isDark ? 'moon' : 'sun'}
      title={t('settings.appearance.title')}
      description={t('settings.appearance.description')}
    >
      <div className="grid gap-1">
        <Toggle
          label={t('settings.appearance.darkMode.label')}
          description={t('settings.appearance.darkMode.description')}
          checked={isDark}
          onChange={(next) => {
            void setAppTheme(next ? 'dark' : 'light');
          }}
        />
        <SettingField
          label={t('settings.appearance.accent.label')}
          description={t('settings.appearance.accent.description')}
          trailing={isPro ? null : <ProBadge />}
        >
          <div role="radiogroup" aria-label={t('settings.appearance.accent.label')} className="flex flex-wrap gap-2.5 px-0.5 py-1">
            {ACCENTS.map(([value, swatch]) => {
              const selected = accent === value;
              const locked = !isPro && value !== 'amber';
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={locked ? t('pro.option', { name: t(ACCENT_LABELS[value]) }) : t(ACCENT_LABELS[value])}
                  title={t(ACCENT_LABELS[value])}
                  onClick={() => {
                    if (!locked || requirePro('themes')) {
                      void setAccentColor(value);
                    }
                  }}
                  className={clsx(
                    'neu-interactive relative inline-flex h-8 w-8 items-center justify-center rounded-full',
                    selected ? 'neu-pressed-sm' : 'neu-raised-sm',
                  )}
                >
                  <span className="h-5 w-5 rounded-full" style={{ background: swatch }} />
                  {selected ? <Icon name="check" size={12} className="absolute text-white mix-blend-difference" /> : null}
                  {locked ? <Icon name="lock" size={12} className="absolute -bottom-1 -right-1 text-amply-textMuted" /> : null}
                </button>
              );
            })}
          </div>
        </SettingField>
        {isPro ? (
          <Toggle
            label={t('settings.appearance.trueBlack.label')}
            description={t('settings.appearance.trueBlack.description')}
            checked={trueBlack}
            disabled={!isDark}
            onChange={(next) => {
              void setTrueBlack(next);
            }}
          />
        ) : (
          <LockedRow feature="themes" />
        )}
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
