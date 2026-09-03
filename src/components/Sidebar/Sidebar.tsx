import { memo } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import logoIcon from '@/assets/icons/LogoAmply.png';
import homeIcon from '@/assets/icons/home.svg';
import searchIcon from '@/assets/icons/search.svg';
import libraryIcon from '@/assets/icons/library.svg';
import playlistsIcon from '@/assets/icons/playlists.svg';
import settingsIcon from '@/assets/icons/settings.svg';
import { useLibraryStore } from '@/store/libraryStore';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

const primaryNav: NavItem[] = [
  { label: 'Home', path: '/home', icon: homeIcon },
  { label: 'Search', path: '/search', icon: searchIcon },
  { label: 'Library', path: '/library', icon: libraryIcon },
  { label: 'Playlists', path: '/playlists', icon: playlistsIcon },
];

const secondaryNav: NavItem[] = [
  { label: 'Settings', path: '/settings', icon: settingsIcon },
];

const navIconClass = 'ui-icon ui-icon--muted h-[18px] w-[18px] transition-opacity group-hover:opacity-100';

const Sidebar = () => {
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);

  return (
    <aside className="panel-surface flex h-full min-h-0 w-[72px] flex-col border-r border-amply-border/40 px-3 py-5 lg:w-[244px] lg:px-4">
      <div className="mb-9 flex items-center justify-center gap-3 px-0 lg:justify-start lg:px-2">
        <img src={logoIcon} alt="Amply" className="h-9 w-9 object-contain" />
        <p className="hidden font-display text-[23px] font-black tracking-[-0.045em] text-amply-textPrimary lg:block">Amply</p>
      </div>
      {metadataFetch.running ? (
        <div className="ui-control-surface mb-6 hidden rounded-2xl px-3 py-2 text-[11px] text-amply-textSecondary lg:block">
          {metadataFetch.total > 0
            ? `Fetching metadata... ${metadataFetch.done}/${metadataFetch.total} pending`
            : 'Checking metadata cache...'}
        </div>
      ) : null}

      <nav className="mx-[-8px] flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-visible px-2 pb-4">
        <div className="space-y-2">
          {primaryNav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'group relative flex items-center justify-center gap-3 rounded-[14px] px-3 py-2.5 transition-[background-color,color,box-shadow] duration-150 lg:justify-start',
                  isActive
                    ? 'sidebar-nav-active text-amply-textPrimary'
                    : 'text-amply-textSecondary hover:bg-[var(--sidebar-hover)] hover:text-amply-textPrimary',
                )
              }
              title={item.label}
            >
              <img src={item.icon} alt="" className={navIconClass} />
              <span className="hidden text-[12px] font-medium tracking-[0.01em] lg:inline">{item.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="mt-auto pt-6">
          <div className="ui-section-divider my-4 h-px border-t" />
          <div className="space-y-1">
            {secondaryNav.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  clsx(
                  'group relative flex items-center justify-center gap-3 rounded-[14px] px-3 py-2.5 transition-[background-color,color,box-shadow] duration-150 lg:justify-start',
                  isActive
                      ? 'sidebar-nav-active text-amply-textPrimary'
                      : 'text-amply-textSecondary hover:bg-[var(--sidebar-hover)] hover:text-amply-textPrimary',
                )
              }
              title={item.label}
            >
              <img src={item.icon} alt="" className={navIconClass} />
                <span className="hidden text-[12px] font-medium tracking-[0.01em] lg:inline">{item.label}</span>
            </NavLink>
            ))}
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default memo(Sidebar);
