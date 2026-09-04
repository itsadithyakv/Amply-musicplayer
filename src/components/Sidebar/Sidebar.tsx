import { memo } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import logoIcon from '@/assets/icons/LogoAmply.png';
import { Icon, type IconName } from '@/components/ui/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Divider } from '@/components/ui/Divider';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';

interface NavItem {
  label: string;
  path: string;
  icon: IconName;
}

const primaryNav: NavItem[] = [
  { label: 'Home', path: '/home', icon: 'home' },
  { label: 'Search', path: '/search', icon: 'search' },
  { label: 'Library', path: '/library', icon: 'library' },
  { label: 'Playlists', path: '/playlists', icon: 'playlists' },
];

const secondaryNav: NavItem[] = [{ label: 'Settings', path: '/settings', icon: 'settings' }];

const navClass = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'neu-interactive sidebar-nav group relative flex items-center justify-center gap-3 rounded-full px-3 py-2.5 text-[12px] font-medium tracking-[0.01em] lg:justify-start',
    isActive ? 'neu-pressed-sm text-amply-textPrimary' : 'neu-flat text-amply-textSecondary hover:text-amply-textPrimary',
  );

const NavEntry = ({ item }: { item: NavItem }) => (
  <NavLink to={item.path} className={navClass} title={item.label} end={false}>
    <Icon name={item.icon} size={18} />
    <span className="hidden lg:inline">{item.label}</span>
  </NavLink>
);

const MetadataStatus = () => {
  const running = useLibraryStore((state) => state.metadataFetch.running);
  const done = useLibraryStore((state) => state.metadataFetch.done);
  const total = useLibraryStore((state) => state.metadataFetch.total);
  if (!running) {
    return null;
  }
  return (
    <div className="neu-pressed-sm mb-6 hidden rounded-md px-3 py-2.5 lg:block">
      <p className="mb-2 text-[11px] text-amply-textSecondary">
        {total > 0 ? `Fetching metadata ${done}/${total}` : 'Checking metadata cache…'}
      </p>
      <ProgressBar value={total > 0 ? done / total : 0} indeterminate={total === 0} ariaLabel="Metadata fetch progress" />
    </div>
  );
};

/** One-click mini player switch so the overlay can be toggled without opening Settings. */
const OverlayQuickToggle = () => {
  const enabled = usePlayerStore((state) => state.settings.miniNowPlayingOverlay);
  const setEnabled = usePlayerStore((state) => state.setMiniNowPlayingOverlay);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      title={enabled ? 'Hide mini player' : 'Show mini player'}
      onClick={() => void setEnabled(!enabled)}
      className={clsx(
        'neu-interactive sidebar-nav flex w-full items-center justify-center gap-3 rounded-full px-3 py-2.5 text-[12px] font-medium tracking-[0.01em] lg:justify-start',
        enabled ? 'neu-pressed-sm text-amply-textPrimary' : 'neu-flat text-amply-textSecondary hover:text-amply-textPrimary',
      )}
    >
      <Icon name="overlay" size={18} />
      <span className="hidden min-w-0 flex-1 text-left lg:inline">Mini player</span>
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
