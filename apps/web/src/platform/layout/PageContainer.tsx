// Standard page frame every screen reuses: a padded, full-width container plus a unified page header
// (breadcrumbs + title + actions slot). Refining these two primitives standardizes the header and
// spacing across every page at once — the single source of truth for page layout.
//
// Owner decision: every screen spans the full available width, the way the interviews board always
// did. There is no max-width cap and therefore no per-page opt-out — padding is unchanged.
//
// A PAGE HEADER CARRIES NO SUBTITLE, and that is an owner decision rather than an omission. Every
// screen used to explain itself in a sentence under its own title, and the owner asked for all of
// them gone — on the screens that had them and on every screen built from here on. There is
// deliberately NO prop to pass one through: a `description` that rendered nothing would be a trap
// for the next author, and one that rendered something would put the sentences back a page at a
// time. `page-header-has-no-subtitle.spec.ts` is what keeps that true.
import { type ReactNode } from 'react';
import { cn } from '../../shared/lib/cn';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';

export const PageContainer = ({
  children,
  fullHeight = false,
}: {
  children: ReactNode;
  /**
   * Fill the shell's viewport exactly, and let the page's own regions scroll instead of the page.
   *
   * Off by default, because a page that grows down the screen is the right shape for almost every
   * screen here. Turn it on for a board a reader works ACROSS rather than reads down — two ledgers
   * side by side, where scrolling the page would take the second one's totals off screen while you
   * are comparing them to the first one's. A caller that opts in owes its own `min-h-0 flex-1` on
   * whichever region is meant to scroll; without that the content simply overflows, because the
   * container caps the height and nothing below it has been told where the give is.
   */
  fullHeight?: boolean;
}): JSX.Element => (
  <div
    className={cn(
      'mx-auto w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8',
      // `shrink-0` is what keeps every OTHER page exactly as it was: `main` is a flex column now,
      // and without it a page taller than the viewport would be squashed to fit instead of
      // scrolling. Only a page that asks takes the give.
      fullHeight ? 'flex min-h-0 flex-1 flex-col' : 'shrink-0',
    )}
  >
    {children}
  </div>
);

export const PageHeader = ({
  title,
  breadcrumbs,
  actions,
  aside,
}: {
  title: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  /**
   * Sits on the breadcrumb row, opposite the trail — for status about the record rather than about
   * navigation. Wraps below on narrow screens rather than squeezing the breadcrumb.
   */
  aside?: ReactNode;
}): JSX.Element => (
  <div className="mb-6 border-b border-slate-200/80 pb-5 dark:border-slate-800">
    {(breadcrumbs !== undefined && breadcrumbs.length > 0) || aside !== undefined ? (
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        {breadcrumbs !== undefined && breadcrumbs.length > 0 ? (
          <Breadcrumbs items={breadcrumbs} />
        ) : (
          <span />
        )}
        {aside !== undefined && <div className="min-w-0">{aside}</div>}
      </div>
    ) : null}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h1>
      </div>
      {actions !== undefined && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  </div>
);
