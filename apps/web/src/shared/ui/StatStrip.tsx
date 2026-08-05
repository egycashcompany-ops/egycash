// A row of metrics as ONE band rather than a row of cards.
//
// Four bordered cards above a list read as four panels the eye has to visit; a band divided by
// hairlines reads as one summary of the thing below it, and costs a fraction of the height —
// which is the difference between a screen that shows six rows and one that shows nine. It is the
// shape GitHub Insights, Azure's overview blades and Linear's dashboards all settle on.
//
// Pair it with `ListView`'s `summary` slot: the band then sits INSIDE the list's surface, sharing
// its border, so a page has one card instead of two blocks with a gap between them.
//
// `StatCard` is still the right thing for a module home page, where a metric is the content rather
// than a heading for a table. This is for a list screen.
import { type ComponentType, type SVGProps } from 'react';
import { cn } from '../lib/cn';
import { Skeleton } from './Skeleton';

export interface StatStripItem {
  key: string;
  label: string;
  /** Omit while unknown — the cell shows a muted dash rather than inventing a zero. */
  value?: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
  /**
   * Makes the cell a button — for a metric that is also a VIEW of the list below ("active" →
   * filter to active). Without it the cell is a plain readout, which is what a metric that
   * filters nothing should look like.
   */
  onClick?: () => void;
  /** Draw it as the view currently applied. */
  active?: boolean;
  /** Hold the number's space with a skeleton instead of a dash while it is in flight. */
  loading?: boolean;
}

export const StatStrip = ({ items }: { items: StatStripItem[] }): JSX.Element => (
  // `gap-px` over a coloured background draws the hairlines — one rule that works in both
  // directions, wraps with the grid, and needs no RTL mirror the way `divide-x` would.
  <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4 dark:bg-slate-800">
    {items.map((item) => {
      const Icon = item.icon;
      const body = (
        <>
          {Icon !== undefined && (
            <Icon
              className={cn(
                'h-4 w-4 shrink-0',
                item.active === true
                  ? 'text-brand-500 dark:text-brand-400'
                  : 'text-slate-400 dark:text-slate-500',
              )}
            />
          )}
          <span className="min-w-0">
            {item.loading === true ? (
              <Skeleton className="h-5 w-10" />
            ) : (
              <span
                className={cn(
                  'block text-xl font-semibold leading-tight tabular-nums',
                  item.value === undefined
                    ? 'text-slate-300 dark:text-slate-600'
                    : item.active === true
                      ? 'text-brand-700 dark:text-brand-300'
                      : 'text-slate-900 dark:text-white',
                )}
              >
                {item.value ?? '—'}
              </span>
            )}
            <span className="block truncate text-[11px] leading-tight text-slate-500 dark:text-slate-400">
              {item.label}
            </span>
          </span>
        </>
      );

      const shell = cn(
        'flex items-center gap-2.5 px-4 py-2.5 text-start',
        item.active === true ? 'bg-brand-50/70 dark:bg-brand-950/40' : 'bg-white dark:bg-slate-900',
      );

      // A real <button> where it filters: keyboard focus, Enter/Space and the pressed state come
      // free, and a metric that does nothing never pretends to be pressable.
      return item.onClick === undefined ? (
        <div key={item.key} className={shell}>
          {body}
        </div>
      ) : (
        <button
          key={item.key}
          type="button"
          onClick={item.onClick}
          aria-pressed={item.active === true}
          className={cn(
            shell,
            'transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-600/40 dark:hover:bg-slate-800/60',
            item.active === true && 'hover:bg-brand-50 dark:hover:bg-brand-950/60',
          )}
        >
          {body}
        </button>
      );
    })}
  </div>
);
