// The phone frame — deliberately NOT `AppShell`.
//
// `AppShell` is a console: a topbar, a navigation rail, a command palette bound to a keyboard
// shortcut. On a 360px phone held in one hand at a bank's back door, every one of those is a
// liability. This is a real mobile surface rather than the desktop one made narrow.
//
// It began as the Operations captain's frame («يوم القائد», `operations/mobile/CaptainShell.tsx`)
// and moved here when IT's «فحص أجهزة السيارة» became the second phone screen
// (docs/12-planning/it-vehicle-checks-design.md §6.3). `CaptainShell` is now a thin wrapper that
// passes the Operations defaults.
//
// IT IS STILL THE SAME APP AND THE SAME LOGIN. The route sits behind the same `RequirePermission`
// guard as every other page and the same session; what changes is the frame around it, not the
// identity inside it. The back link is here so the surface is a capability within the employee's
// console, not a place you get stranded in.
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppVersion } from '../../platform/app/AppVersion';
import { cn } from '../lib/cn';
import { ChevronStartIcon } from './icons';

export const PhoneShell = ({
  title,
  subtitle,
  backTo,
  backLabel,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Where the back arrow goes — the route's own parent, or the home page. */
  backTo: string;
  /** The back arrow's name: it is the one control here with no visible text. */
  backLabel: string;
  /**
   * A bar fixed at the foot of the screen — the count and the one action, under the thumb. Its
   * height is known (one line that never wraps and a 48px button), so the page is padded by that
   * much plus the phone's bottom safe area and the bar never covers the last row.
   */
  footer?: ReactNode;
  children: ReactNode;
}): JSX.Element => (
  // `min-h-dvh`, not `min-h-screen`: on a phone the browser chrome comes and goes, and `vh` is
  // the tallest it ever gets — which leaves the last action button under the address bar.
  <div
    className={cn(
      'min-h-dvh bg-slate-50 dark:bg-slate-950',
      footer === undefined ? 'pb-8' : 'pb-[calc(8rem+env(safe-area-inset-bottom))]',
    )}
  >
    {/* z-20: a photo box's file input is `absolute z-10`, and scrolled under a header of the same
        z-index it would take the tap meant for the back arrow. */}
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
      <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
        <Link
          to={backTo}
          aria-label={backLabel}
          title={backLabel}
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
    {/* No top bar or user menu here, so the build being run is said at the foot of the page. */}
    <AppVersion className="mx-auto max-w-2xl px-4 pt-4 text-center" />
    {footer !== undefined && (
      <div
        data-phone-footer="true"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-slate-900/95"
      >
        {footer}
      </div>
    )}
  </div>
);
