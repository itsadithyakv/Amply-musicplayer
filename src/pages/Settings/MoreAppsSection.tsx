import { Icon } from '@/components/ui';
import { useT, type MessageKey } from '@/i18n';
import { SettingsSection } from '@/pages/Settings/SettingsSection';
import { openStoreListing, PAPERKITE_APPS, type PaperKiteApp } from '@/services/moreApps';

const BLURBS: Record<PaperKiteApp['id'], MessageKey> = {
  juicebar: 'settings.moreApps.app.juicebar',
  papery: 'settings.moreApps.app.papery',
  twinly: 'settings.moreApps.app.twinly',
  tachy: 'settings.moreApps.app.tachy',
  framecap: 'settings.moreApps.app.framecap',
  dumbtop: 'settings.moreApps.app.dumbtop',
  leaflet: 'settings.moreApps.app.leaflet',
};

/** The other PaperKite apps, each one click from its Microsoft Store page. */
export const MoreAppsSection = () => {
  const { t } = useT();
  return (
    <SettingsSection icon="sparkle" title={t('settings.moreApps.title')} description={t('settings.moreApps.description')}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {PAPERKITE_APPS.map((app) => (
          <li key={app.id} className="min-w-0">
            <button
              type="button"
              onClick={() => void openStoreListing(app.storeId)}
              aria-label={t('settings.moreApps.open', { name: app.name })}
              className="neu-raised-sm neu-interactive group flex w-full items-center gap-3 rounded-md p-3 text-left"
            >
              <img src={app.icon} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-[10px]" draggable={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-amply-textPrimary">{app.name}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-amply-textSecondary">{t(BLURBS[app.id])}</span>
              </span>
              <Icon name="external-link" size={14} className="shrink-0 text-amply-textMuted transition-colors group-hover:text-amply-accent" />
            </button>
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
};
