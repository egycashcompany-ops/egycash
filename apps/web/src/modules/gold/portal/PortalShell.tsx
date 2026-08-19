// The chrome a CUSTOMER sees. Not the ECMS shell.
//
// A customer holds one permission and has no place in the org tree, so the staff shell would give
// them an icon rail with nothing in it, a launcher with nothing to launch and a command palette
// over an empty catalog. The portal is its own frame instead: their organisation's name and logo,
// the nine tabs, and a way out.
//
// Nothing here is forked from the platform's layout — the theme and language toggles are the same
// standalone components the login screen uses, and everything else is a handful of divs.
import { NavLink, Outlet } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from '../../../store';
import { signedOut } from '../../../store/authSlice';
import { logoutRequest } from '../../../platform/auth/api';
import { useT } from '../../../platform/localization/useT';
import { ThemeToggle } from '../../../platform/layout/ThemeToggle';
import { LanguageToggle } from '../../../platform/layout/LanguageToggle';
import { Button } from '../../../shared/ui';
import { CompanyLogo } from '../components/CompanyLogo';
import { useGoldPortalMe } from './api/portal-queries';

const TABS = [
  { to: '/portal', end: true, key: 'overview' },
  { to: '/portal/bars', end: false, key: 'bars' },
  { to: '/portal/drawers', end: false, key: 'drawers' },
  { to: '/portal/receiving', end: false, key: 'receiving' },
  { to: '/portal/delivery', end: false, key: 'delivery' },
  { to: '/portal/transfers', end: false, key: 'transfers' },
  { to: '/portal/keys', end: false, key: 'keys' },
  { to: '/portal/representatives', end: false, key: 'representatives' },
  { to: '/portal/reports', end: false, key: 'reports' },
] as const;

export const PortalShell = (): JSX.Element => {
  const t = useT();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const me = useGoldPortalMe();

  const signOut = async (): Promise<void> => {
    // The request is best-effort; the local session is dropped either way, so a network failure
    // cannot strand somebody signed in on a shared machine.
    await logoutRequest().catch(() => undefined);
    dispatch(signedOut());
    navigate('/portal/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <CompanyLogo fileId={me.data?.logoFileId ?? null} name={me.data?.companyName ?? ''} />
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">
                {me.data?.companyName ?? '—'}
              </h1>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                {t('gold.portal.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <LanguageToggle />
            <Button
              variant="secondary"
              onClick={() => {
                void signOut();
              }}
            >
              {t('gold.portal.signOut')}
            </Button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-5 pb-2">
          {TABS.map((tab) => (
            <NavLink
              key={tab.key}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition ${
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`
              }
            >
              {t(`gold.portal.tabs.${tab.key}`)}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-7xl px-5 py-6">
        <Outlet />
      </main>
    </div>
  );
};
