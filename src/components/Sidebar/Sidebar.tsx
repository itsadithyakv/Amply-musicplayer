import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import logoIcon from '@/assets/icons/logo.png';
import homeIcon from '@/assets/icons/home.svg';
import searchIcon from '@/assets/icons/search.svg';
import libraryIcon from '@/assets/icons/library.svg';
import settingsIcon from '@/assets/icons/settings.svg';
import statsIcon from '@/assets/icons/stats.svg';

interface NavItem {
  label: string;
  path: string;
  icon: string;
}

const primaryNav: NavItem[] = [
  { label: 'Home', path: '/home', icon: homeIcon },
  { label: 'Search', path: '/search', icon: searchIcon },
  { label: 'Library', path: '/library', icon: libraryIcon },
];

const secondaryNav: NavItem[] = [
  { label: 'Stats', path: '/stats', icon: statsIcon },
  { label: 'Settings', path: '/settings', icon: settingsIcon },
];

const navIconClass = 'h-6 w-6 brightness-0 invert opacity-85 transition-opacity group-hover:opacity-100';

const Sidebar = () => {
  return (
    <aside className="flex h-full min-h-0 w-[240px] flex-col border-r border-amply-border bg-amply-bgPrimary p-4">
      <div className="mb-8 flex items-center gap-3 px-2">
        <img src={logoIcon} alt="Amply" className="h-10 w-10 rounded-md" />
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-amply-textMuted">Amply</p>
          <p className="text-xs text-amply-textSecondary">Offline Music Player</p>
        </div>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-4">
        <div className="space-y-2">
          {primaryNav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-200 ease-smooth',
                  isActive ? 'bg-amply-hover text-amply-textPrimary' : 'text-amply-textSecondary hover:bg-amply-hover',
                )
              }
            >
              <img src={item.icon} alt="" className={navIconClass} />
              <span className="text-[13px] font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="my-4 h-px bg-amply-border" />
        <div className="space-y-1">
          {secondaryNav.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                clsx(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 transition-all duration-200 ease-smooth',
                  isActive ? 'bg-amply-hover text-amply-textPrimary' : 'text-amply-textSecondary hover:bg-amply-hover',
                )
              }
            >
              <img src={item.icon} alt="" className={navIconClass} />
              <span className="text-[13px] font-medium">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </aside>
  );
};

export default Sidebar;
