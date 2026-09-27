import { memo } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import logoIcon from '@/assets/icons/LogoAmply.png';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Divider } from '@/components/ui/Divider';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useT, type MessageKey } from '@/i18n';

interface NavItem {
  labelKey: MessageKey;
  path: string;
  icon: IconName;
}

const primaryNav: NavItem[] = [
  { labelKey: 'common.nav.home', path: '/home', icon: 'home' },
  { labelKey: 'common.nav.search', path: '/search', icon: 'search' },
  { labelKey: 'common.nav.library', path: '/library', icon: 'library' },
  { labelKey: 'common.nav.playlists', path: '/playlists', icon: 'playlists' },
  { labelKey: 'common.nav.stats', path: '/stats', icon: 'stats' },
];

const secondaryNav: NavItem[] = [{ labelKey: 'common.nav.settings', path: '/settings', icon: 'settings' }];

const navClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'neu-interactive sidebar-nav group relative flex items-center justify-center gap-3 rounded-full px-3 py-2.5 text-[12px] font-medium tracking-[0.01em] lg:justify-start',
    isActive ? 'neu-pressed-sm text-amply-textPrimary' : 'text-amply-textSecondary hover:neu-flat hover:text-amply-textPrimary',
  );

const NavEntry = ({ item }: { item: NavItem }) => {
  const { t } = useT();
  const label = t(item.labelKey);
  return (
    <NavLink to={item.path} className={navClass} title={label} end={false}>
      <Icon name={item.icon} size={18} />
      <span className="hidden lg:inline">{label}</span>
    </NavLink>
  );
};

const MetadataStatus = () => {
  const { t } = useT();
  const running = useLibraryStore((state) => state.metadataFetch.running);
  const done = useLibraryStore((state) => state.metadataFetch.done);
  const total = useLibraryStore((state) => state.metadataFetch.total);
  if (!running) {
    return null;
  }
  return (
    <div className="neu-pressed-sm mb-6 hidden rounded-md px-3 py-2.5 lg:block">
      <p className="mb-2 text-[11px] text-amply-textSecondary">
        {total > 0 ? t('common.sidebar.fetchingMetadata', { done, total }) : t('common.sidebar.checkingMetadataCache')}
      </p>
      <ProgressBar value={total > 0 ? done / total : 0} indeterminate={total === 0} ariaLabel={t('common.sidebar.metadataProgress')} />
    </div>
  );
};

/** One-click mini player switch so the overlay can be toggled without opening Settings. */
const OverlayQuickToggle = () => {
  const { t } = useT();
  const enabled = usePlayerStore((state) => state.settings.miniNowPlayingOverlay);
  const setEnabled = usePlayerStore((state) => state.setMiniNowPlayingOverlay);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      title={enabled ? t('common.sidebar.hideMiniPlayer') : t('common.sidebar.showMiniPlayer')}
      onClick={() => void setEnabled(!enabled)}
      className={clsx(
        'neu-interactive sidebar-nav flex w-full items-center justify-center gap-3 rounded-full px-3 py-2.5 text-[12px] font-medium tracking-[0.01em] lg:justify-start',
        'text-amply-textSecondary hover:neu-flat hover:text-amply-textPrimary',
      )}
    >
      <Icon name="overlay" size={18} />
      <span className="hidden min-w-0 flex-1 text-left lg:inline">{t('common.sidebar.miniPlayer')}</span>
      <span aria-hidden="true" data-checked={enabled} className="neu-toggle hidden scale-90 lg:block" />
    </button>
  );
};

const Sidebar = () => (
  <aside className="flex h-full min-h-0 w-full flex-col px-3 py-5 shadow-[inset_-1px_0_0_rgb(var(--amply-edge)/var(--edge-a))] lg:px-4">
    <div className="anim-rise mb-8 flex items-center justify-center gap-3 lg:justify-start lg:px-2">
      <img src={logoIcon} alt="Amply" className="h-10 w-10 shrink-0 object-contain" />
      <p className="hidden font-display text-[24px] font-black leading-none tracking-[-0.045em] text-amply-textPrimary lg:block">Amply</p>
    </div>
    <MetadataStatus />

    <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-visible px-1 pb-4">
      <div className="anim-stagger space-y-2">
        {primaryNav.map((item) => (
          <NavEntry key={item.path} item={item} />
        ))}
      </div>
      <div className="mt-auto pt-6">
        <Divider className="my-4" />
        <div className="space-y-2">
          <OverlayQuickToggle />
          {secondaryNav.map((item) => (
            <NavEntry key={item.path} item={item} />
          ))}
        </div>
      </div>
    </nav>
  </aside>
);

export default memo(Sidebar);
