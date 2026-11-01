// The candidate's shell — and it is deliberately almost nothing.
//
// Not `AppShell`: no icon rail, no launcher, no command palette, no notification bell, no branch
// switcher. A candidate has one page and one thing to do on it, and every one of those affordances
// exists to move between things they do not have.
//
// What is here is a header with their name and a way out, because a portal you cannot sign out of
// on a shared phone is worse than no portal.
import { Outlet } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useAppDispatch, useAppSelector } from '../../../../store';
import { signedOut } from '../../../../store/authSlice';
import { logoutRequest } from '../../../../platform/auth/api';
import { useT } from '../../../../platform/localization/useT';
import { useDocumentTitle } from '../../../../shared/lib/useDocumentTitle';
import { ThemeToggle } from '../../../../platform/layout/ThemeToggle';
import { fullName } from '../../../../shared/lib/format';
import { LanguageToggle } from '../../../../platform/layout/LanguageToggle';
import { BrandMark } from '../../../../shared/ui/BrandMark';

export const ApplicantPortalShell = (): JSX.Element => {
  const t = useT();
  useDocumentTitle('EGYCASH');
  const dispatch = useAppDispatch();
  const me = useAppSelector((state) => state.auth.me);
  const locale = useAppSelector((state): Locale => state.locale.locale);

  const signOut = async (): Promise<void> => {
    // The refusal is swallowed on purpose: a session the server already dropped must still clear
    // on this device, and leaving somebody signed in because the network blinked is the failure
    // that matters on a shared phone.
    await logoutRequest().catch(() => undefined);
    dispatch(signedOut());
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* The mark is decorative and the only words here are the candidate's own name, so the
                company is named for screen readers alone. */}
            <BrandMark size="sm" />
            <span className="sr-only">EGYCASH</span>
            <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {me === null ? '' : fullName(me.name, locale)}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <ThemeToggle />
            <button
              type="button"
              className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              onClick={() => {
                void signOut();
              }}
            >
              {t('hr.applicantPortal.signOut')}
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
};
