// The ECMS shell bar (full width, top): product identity, the global ⌘K search/jump trigger, and the
// account utilities (theme, language, notifications, user). The page's own title/breadcrumbs live in
// the page header, so the shell bar stays a clean command surface.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedOut } from '../../store/authSlice';
import { setLocale } from '../../store/localeSlice';
import { toggleSidebar } from '../../store/uiSlice';
import { logoutRequest } from '../auth/api';
import { useT } from '../localization/useT';
import { useTheme } from '../theme/useTheme';
import { fullName } from '../../shared/lib/format';
import { useOnClickOutside } from '../../shared/lib/useOnClickOutside';
import { cn } from '../../shared/lib/cn';
import { NotificationBell } from '../notifications/NotificationBell';
import {
  GlobeIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  SearchIcon,
  SunIcon,
} from '../../shared/ui/icons';

const ThemeToggle = (): JSX.Element => {
  const { theme, cycle } = useTheme();
  const t = useT();
  const Icon = theme === 'light' ? SunIcon : theme === 'dark' ? MoonIcon : MonitorIcon;
  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      aria-label={t(`common.theme.${theme}`)}
      title={t(`common.theme.${theme}`)}
    >
      <Icon />
    </button>
  );
};

const LanguageToggle = (): JSX.Element => {
  const dispatch = useAppDispatch();
  const locale = useAppSelector((state) => state.locale.locale);
  return (
    <button
      type="button"
      onClick={() => dispatch(setLocale(locale === 'ar' ? 'en' : 'ar'))}
      className="flex items-center gap-1.5 rounded-lg p-2 text-sm text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      aria-label={locale === 'ar' ? 'English' : 'العربية'}
    >
      <GlobeIcon className="h-5 w-5" />
      <span className="hidden font-medium sm:inline">{locale === 'ar' ? 'EN' : 'ع'}</span>
    </button>
  );
};

const UserMenu = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const me = useAppSelector((state) => state.auth.me);
  const locale = useAppSelector((state) => state.locale.locale);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOnClickOutside(ref, () => setOpen(false), open);

  if (me === null) return <></>;
  const name = fullName(me.name, locale);

  const signOut = async (): Promise<void> => {
    try {
      await logoutRequest();
    } finally {
      dispatch(signedOut());
      navigate('/login');
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700 dark:bg-brand-900 dark:text-brand-200">
          {name.charAt(0) || '؟'}
        </span>
        <span className="hidden text-sm font-medium text-slate-700 dark:text-slate-200 sm:inline">{name}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute end-0 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
        >
          <div className="border-b border-slate-100 px-4 py-3 dark:border-slate-700">
            <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{name}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400" dir="ltr">
              {me.email}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void signOut()}
            className={cn(
              'flex w-full items-center gap-2 px-4 py-2 text-start text-sm text-slate-700 hover:bg-slate-50',
              'dark:text-slate-200 dark:hover:bg-slate-700',
            )}
          >
            <LogOutIcon className="h-4 w-4" />
            {t('platform.shell.signOut')}
          </button>
        </div>
      )}
    </div>
  );
};

export const Topbar = ({ onOpenSearch }: { onOpenSearch: () => void }): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900">
      <button
        type="button"
        onClick={() => dispatch(toggleSidebar())}
        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 lg:hidden"
        aria-label={t('common.menu')}
      >
        <MenuIcon />
      </button>

      {/* Product identity */}
      <div className="flex shrink-0 items-center gap-2.5 ps-1">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-sm font-bold text-white shadow-sm">
          E
        </span>
        <span className="hidden text-base font-semibold tracking-tight text-slate-800 dark:text-slate-100 sm:block">
          ECMS
        </span>
      </div>

      {/* Global command / search trigger */}
      <button
        type="button"
        onClick={onOpenSearch}
        className="mx-auto flex h-9 w-full max-w-md items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600 dark:hover:bg-slate-800"
      >
        <SearchIcon className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-start">{t('nav.search')}</span>
        <kbd className="hidden shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:border-slate-600 sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Utilities */}
      <div className="flex shrink-0 items-center gap-0.5">
        <ThemeToggle />
        <LanguageToggle />
        <NotificationBell />
        <div className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
        <UserMenu />
      </div>
    </header>
  );
};
