// The ECMS shell bar (full width, top): product identity, the global ⌘K search/jump trigger, and the
// account utilities (theme, language, notifications, user). The page's own title/breadcrumbs live in
// the page header, so the shell bar stays a clean command surface.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '../../store';
import { signedOut } from '../../store/authSlice';
import { toggleSidebar } from '../../store/uiSlice';
import { logoutRequest } from '../auth/api';
import { useT } from '../localization/useT';
import { fullName } from '../../shared/lib/format';
import { useOnClickOutside } from '../../shared/lib/useOnClickOutside';
import { cn } from '../../shared/lib/cn';
import { NotificationBell } from '../notifications/NotificationBell';
import { BrandMark } from '../../shared/ui';
import { CogIcon, LogOutIcon, ShieldIcon, MenuIcon, SearchIcon } from '../../shared/ui/icons';
import { ThemeToggle } from './ThemeToggle';
import { LanguageToggle } from './LanguageToggle';
import { NavLayoutToggle } from './NavLayoutToggle';
import { BranchSwitcher } from './BranchSwitcher';

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
          className="absolute end-0 mt-2 w-56 origin-top animate-menu-in rounded-lg border border-slate-200 bg-white py-1 shadow-elevated dark:border-slate-700 dark:bg-slate-800"
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
            onClick={() => { setOpen(false); navigate('/account/preferences'); }}
            className={cn(
              'flex w-full items-center gap-2 px-4 py-2 text-start text-sm text-slate-700 hover:bg-slate-50',
              'dark:text-slate-200 dark:hover:bg-slate-700',
            )}
          >
            <CogIcon className="h-4 w-4" />
            {t('account.preferences.title')}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); navigate('/account/security'); }}
            className={cn(
              'flex w-full items-center gap-2 px-4 py-2 text-start text-sm text-slate-700 hover:bg-slate-50',
              'dark:text-slate-200 dark:hover:bg-slate-700',
            )}
          >
            <ShieldIcon className="h-4 w-4" />
            {t('platform.shell.security')}
          </button>
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
    // ONE ROW ON DESKTOP, TWO ON A PHONE.
    //
    // The bar carries a fixed set of controls that do not shrink — the menu, the identity, the
    // branch switcher and five utilities — plus a search field that wants the rest. Below about
    // 510px that is more than there is, and a nowrap row does not report the problem: it just runs
    // off the end. On a 360px phone 150px of it was past the edge, which took the notification
    // bell and the account menu with it, unreachable at any scroll position.
    //
    // So the row WRAPS below `md`, and the utilities take a line of their own — identity and
    // search on top, the controls beneath, the shape a phone toolbar already has. Above `md` it is
    // `flex-nowrap` and `h-14` again: one row, same order, same everything. Nothing here is
    // conditional on a device — it is the width that decides, so a narrow desktop window gets the
    // two-row bar too rather than the clipping.
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900 md:h-14 md:flex-nowrap md:py-0">
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
        <BrandMark size="sm" />
        <span className="hidden text-base font-semibold tracking-tight text-slate-800 dark:text-slate-100 sm:block">
          ECMS
        </span>
      </div>

      {/* Global command / search trigger */}
      <button
        type="button"
        onClick={onOpenSearch}
        // `flex-1 min-w-0` rather than `w-full`: it must TAKE the space left on its line, not ask
        // for a line of its own — a `w-full` flex item in a wrapping row wraps itself, which would
        // have made three rows out of two. On one row `max-w-md` and the auto margins still centre
        // it at exactly the width they always did.
        className="mx-auto flex h-9 w-full min-w-0 max-w-md flex-1 items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:bg-white dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-slate-600 dark:hover:bg-slate-800"
      >
        <SearchIcon className="h-4 w-4 shrink-0" />
        <span className="flex-1 truncate text-start">{t('nav.search')}</span>
        <kbd className="hidden shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-400 dark:border-slate-600 sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Utilities. The branch switcher leads them: it changes what every other screen MEANS, so
          it belongs beside the identity rather than buried in a page's own filters.

          `w-full` below `md` is what claims the second line — the group stays exactly as it is,
          in the same order, and only the line it sits on changes. Spread across that line rather
          than bunched at one end: six controls at thumb distance from each other, and no lopsided
          gap where the search used to be. The two `sm:block` dividers are `display:none` at this
          width, so they take no slot in the distribution. */}
      <div className="flex w-full shrink-0 items-center justify-between gap-0.5 md:w-auto md:justify-normal">
        <BranchSwitcher />
        <div className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
        <NavLayoutToggle />
        <ThemeToggle />
        <LanguageToggle />
        <NotificationBell />
        <div className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-slate-700 sm:block" />
        <UserMenu />
      </div>
    </header>
  );
};
