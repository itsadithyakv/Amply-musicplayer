import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import logoIcon from '@/assets/icons/logo.png';
import homeIcon from '@/assets/icons/home.svg';
import searchIcon from '@/assets/icons/search.svg';
import libraryIcon from '@/assets/icons/library.svg';
import playlistsIcon from '@/assets/icons/playlists.svg';
import settingsIcon from '@/assets/icons/settings.svg';
import statsIcon from '@/assets/icons/stats.svg';
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
  { label: 'Stats', path: '/stats', icon: statsIcon },
  { label: 'Settings', path: '/settings', icon: settingsIcon },
];

const navIconClass = 'h-5 w-5 brightness-0 invert opacity-80 transition-opacity group-hover:opacity-100';

const Sidebar = () => {
  const metadataFetch = useLibraryStore((state) => state.metadataFetch);

  return (
    <aside className="panel-surface flex h-full min-h-0 w-[240px] flex-col border-r border-amply-border/60 p-5">
      <div className="mb-10 flex items-center gap-3 px-2">
        <img src={logoIcon} alt="Amply" className="h-10 w-10 rounded-lg shadow-card" />
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.24em] text-amply-textMuted">Amply</p>
        </div>
      </div>
      {metadataFetch.running ? (
        <div className="mb-6 rounded-lg border border-amply-border/60 bg-amply-bgSecondary px-3 py-2 text-[11px] text-amply-textSecondary">
          {metadataFetch.total > 0
            ? `Fetching metadata... ${metadataFetch.done}/${metadataFetch.total} pending`
            : 'Checking metadata cache...'}
        </div>
      ) : null}

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        <div className="space-y-2">
          {primaryNav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 ease-smooth',
                  isActive
                    ? 'bg-amply-surface text-amply-textPrimary'
                    : 'text-amply-textSecondary hover:bg-amply-hover/80 hover:text-amply-textPrimary',
                )
              }
            >
              <img src={item.icon} alt="" className={navIconClass} />
              <span className="text-[13px] font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="mt-auto pt-6">
          <div className="my-5 h-px bg-amply-border/60" />
          <div className="space-y-1">
            {secondaryNav.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  clsx(
                    'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-200 ease-smooth',
                    isActive
                      ? 'bg-amply-surface text-amply-textPrimary'
                      : 'text-amply-textSecondary hover:bg-amply-hover/80 hover:text-amply-textPrimary',
                  )
                }
              >
                <img src={item.icon} alt="" className={navIconClass} />
                <span className="text-[13px] font-medium">{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar;
