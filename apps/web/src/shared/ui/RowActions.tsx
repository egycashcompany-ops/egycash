// Secondary row controls: present, but not shouting from every row at once.
//
// A table where every row carries four visible buttons stops looking like a list of records and
// starts looking like a control panel — the buttons repeat down the page and out-weigh the data
// they belong to. GitHub, Linear and Vercel all solve it the same way: the row's secondary actions
// appear when the pointer is on the row, and the row itself stays readable until then.
//
// Not a menu. Everything stays in the DOM, in the tab order and reachable — this only changes when
// the controls are PAINTED, never whether they exist:
//
//   • below `sm` there is no pointer to hover with, so they are simply always visible;
//   • `group-focus-within` brings them back the moment anything inside the row takes focus, so a
//     keyboard user never chases an invisible button.
//
// Requires the row to be a `group` — `DataTable` marks every row as one.
//
// `always` paints them on every row, all the time — for a board whose row buttons ARE its work
// (the ATM open boards: «خلى زراير إغلاق والتعديل والحذف ظاهرين على طول مش بهوفر», 2026-10-27).
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';

export const RowActions = ({
  children,
  className,
  always = false,
}: {
  children: ReactNode;
  className?: string;
  /** Shown on every row at all times, not only under the pointer. */
  always?: boolean;
}): JSX.Element => (
  <span
    className={cn(
      'flex items-center gap-0.5 transition-opacity',
      !always && 'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
      className,
    )}
    data-row-actions={always ? 'always' : 'hover'}
  >
    {children}
  </span>
);

/**
 * Pin a table's actions column to the row's END edge, so its buttons stay on screen when a wide
 * table scrolls sideways — «خلى زراير إغلاق والتعديل والحذف ظاهرين على طول» on a board whose
 * columns outgrow a laptop's width. Pass `cell` as the column's `className` and `head` as its
 * `headerClassName`. The cell is opaque, or the rows scrolling under it would show through.
 */
export const PINNED_ACTIONS = {
  // The checked row's tint, layered over the opaque base — the same colour the rest of the row shows.
  cell: [
    'sticky end-0 z-[1] border-s border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900',
    'group-data-[selected=true]:bg-[image:linear-gradient(rgb(var(--brand-50)/0.6),rgb(var(--brand-50)/0.6))]',
    'dark:group-data-[selected=true]:bg-[image:linear-gradient(rgb(var(--brand-950)/0.4),rgb(var(--brand-950)/0.4))]',
  ].join(' '),
  head: 'sticky end-0 z-[1] border-s border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800',
} as const;
