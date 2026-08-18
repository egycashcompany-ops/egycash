// The captain's shell — deliberately NOT `AppShell`.
//
// `AppShell` is a console: a topbar, a navigation rail, a command palette bound to a keyboard
// shortcut. On a 360px phone held in one hand at a bank's back door, every one of those is a
// liability. This is a real mobile surface rather than the desktop one made narrow, which is what
// the phase brief asked for and what the work actually needs.
//
// IT IS STILL THE SAME APP AND THE SAME LOGIN. The route sits behind the same
// `RequirePermission` guard as every other page and the same session; what changes is the frame
// around it, not the identity inside it. The back link is here so the surface is a capability
// within the employee's console, not a place you get stranded in.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { ChevronStartIcon } from '../../../shared/ui/icons';

export const CaptainShell = ({
  title,
  subtitle,
  backTo = '/operations',
  children,
}: {
  title: string;
  subtitle?: string;
  /** Where the back arrow goes — the route's own parent: the day for a stop, the console for the day. */
  backTo?: string;
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  return (
    // `min-h-dvh`, not `min-h-screen`: on a phone the browser chrome comes and goes, and `vh` is
    // the tallest it ever gets — which leaves the last action button under the address bar.
    <div className="min-h-dvh bg-slate-50 pb-8 dark:bg-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <Link
            to={backTo}
            aria-label={t('operations.mobile.backToConsole')}
            className="-ms-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {/* Flips with the page direction, so in Arabic it points the way back. */}
            <ChevronStartIcon className="h-5 w-5 rtl:-scale-x-100" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold text-slate-900 dark:text-slate-50">
              {title}
            </h1>
            {subtitle !== undefined && (
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4">{children}</main>
    </div>
  );
};
