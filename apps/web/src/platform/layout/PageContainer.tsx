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
  figures,
  toolbar,
  leading,
}: {
  title: string;
  breadcrumbs?: Crumb[];
  actions?: ReactNode;
  /**
   * THE PAGE'S OWN ROW, ON THE TITLE'S LINE — a form, a filter band, a date bar — so the table
   * under it gets that row's height back. The ATM screens: «عايز تطلع الصف بتاع الـ Form يبقي
   * بجانب العنوان عشان نستفيد بالمساحة» (2026-11-02).
   *
   * From `lg` it sits between the title and the actions and takes the width left; its content
   * wraps INSIDE it when that width runs short, so the band never jumps under the title as a
   * reader fills it in. Below `lg` it takes a full line of its own under the title, as the row did
   * before. A header without one is exactly what it always was.
   */
  toolbar?: ReactNode;
  /**
   * Sits on the breadcrumb row, opposite the trail — for status about the record rather than about
   * navigation. Wraps below on narrow screens rather than squeezing the breadcrumb.
   */
  aside?: ReactNode;
  /**
   * Counts on the title's own line, right after it — how many of what the screen lists. Figures,
   * never a sentence: the header still has no subtitle. Wraps under the title on a narrow screen.
   */
  figures?: ReactNode;
  /**
   * Before the title, on its line — a record's face: the employee's photo on their profile. Only
   * the header without a toolbar takes one.
   */
  leading?: ReactNode;
}): JSX.Element => (
  // With a toolbar the header already holds the page's row, so it keeps less space under itself:
  // the point of moving the row up is the height it gives back to the table.
  <div
    className={cn(
      'border-b border-slate-200/80 dark:border-slate-800',
      toolbar === undefined ? 'mb-6 pb-5' : 'mb-2 pb-4',
    )}
  >
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
    {toolbar !== undefined ? (
      // The title, the page's row and the actions on ONE line from `lg`, in that DOM order — so
      // the Tab key walks them as the eye reads them. Below `lg`, `order` alone moves the row
      // after the actions: the title and the actions share the first line and the row takes the
      // next one whole (`basis-full`). From `lg` the row grows into the width left (`basis-0
      // flex-1`), wrapping its own content as it narrows — but never below 24rem: a header whose
      // title, figures and actions leave less than that (the settlement plan's four prints) wraps
      // instead, the actions taking a line of their own, rather than squeezing the row to nothing.
      <div className="flex flex-wrap items-center gap-3 lg:gap-4">
        <div className="order-1 flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-2 lg:order-none lg:shrink-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            {title}
          </h1>
          {figures}
        </div>
        <div
          className="order-3 min-w-0 basis-full lg:order-none lg:min-w-[24rem] lg:flex-1 lg:basis-0"
          data-page-toolbar="true"
        >
          {toolbar}
        </div>
        {actions !== undefined && (
          <div className="order-2 ms-auto flex min-w-0 flex-wrap items-center justify-end gap-2 lg:order-none">
            {actions}
          </div>
        )}
      </div>
    ) : (
      /* The title line WRAPS: actions that do not fit beside the whole title go to a line of their
        own, at its end, and wrap there — instead of squeezing the title to nothing and running off
        the screen (a `shrink-0` action row cannot wrap). The title column claims only the title's
        own width (`flex-1` from 0, its minimum is its content, capped at the line): figures wrap
        under the title before the actions move, so a header that fit before looks the same. */
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div
          className={cn(
            figures === undefined
              ? 'min-w-0 sm:min-w-[auto] sm:max-w-full sm:flex-1'
              : 'flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 sm:min-w-[auto] sm:max-w-full sm:flex-1',
            leading !== undefined && 'flex min-w-0 items-center gap-4',
          )}
        >
          {leading}
          {leading === undefined ? (
            <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
              {title}
            </h1>
          ) : (
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
                {title}
              </h1>
              {figures}
            </div>
          )}
          {leading === undefined && figures}
        </div>
        {actions !== undefined && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:ms-auto sm:justify-end">
            {actions}
          </div>
        )}
      </div>
    )}
  </div>
);
