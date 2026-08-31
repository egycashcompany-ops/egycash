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

/**
 * How many cells share a row on a wide screen. Four is the shape most strips are, and stays the
 * default; a five-metric strip needs its own, or the fifth drops to a row of its own and reads as
 * an afterthought rather than one of the five. Spelled out rather than interpolated because
 * Tailwind scans source text for class names and never sees a built string.
 */
const wideColumns: Record<3 | 4 | 5, string> = {
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5',
};

export const StatStrip = ({
  items,
  columns = 4,
  labelFirst = false,
}: {
  items: StatStripItem[];
  columns?: 3 | 4 | 5;
  /**
   * Put the LABEL above the figure and give both a size you can read across a desk.
   *
   * The default puts the number first and aligns everything to the reading edge, which is right
   * for a band the reader glances at while their attention is on the list below it. It is wrong
   * for a strip that is being READ — five money totals whose only difference is which word sits
   * beside them. Leading with the number there asks the reader to find the figure and then hunt
   * for what it counts; leading with the label reads as a sentence and lands the figure where the
   * eye already is.
   *
   * This also CENTRES each tile, horizontally and vertically. Edge-aligned tiles of five different
   * label lengths give five ragged columns of numbers with nothing to line them up; centred, each
   * figure sits under its own label and the row reads as five of one thing. The tiles are grid
   * cells and stretch to the tallest, so `justify-center` keeps every figure on the same line even
   * when one label wraps and the others do not.
   */
  labelFirst?: boolean;
}): JSX.Element => (
  // `gap-px` over a coloured background draws the hairlines — one rule that works in both
  // directions, wraps with the grid, and needs no RTL mirror the way `divide-x` would.
  <div
    className={cn('grid grid-cols-2 gap-px bg-slate-100 dark:bg-slate-800', wideColumns[columns])}
  >
    {items.map((item) => {
      const Icon = item.icon;
      const figure =
        item.loading === true ? (
          <Skeleton className={cn('w-10', labelFirst ? 'h-7' : 'h-5')} />
        ) : (
          <span
            className={cn(
              'block font-semibold leading-tight tabular-nums',
              labelFirst ? 'text-2xl' : 'text-xl',
              item.value === undefined
                ? 'text-slate-300 dark:text-slate-600'
                : item.active === true
                  ? 'text-brand-700 dark:text-brand-300'
                  : 'text-slate-900 dark:text-white',
            )}
          >
            {item.value ?? '—'}
          </span>
        );
      const label = (
        <span
          className={cn(
            'block truncate leading-tight',
            labelFirst
              ? // First line of a tile that is being read, not glanced at: big enough to name the
                // figure under it without competing with it, and darker than a caption would be.
                'text-sm font-medium text-slate-600 dark:text-slate-300'
              : 'text-[11px] text-slate-500 dark:text-slate-400',
          )}
        >
          {item.label}
        </span>
      );
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
          {/* Both orders are drawn from the same two spans — only their sequence differs. */}
          <span className={cn('min-w-0', labelFirst && 'flex w-full flex-col items-center gap-2')}>
            {labelFirst ? (
              <>
                {label}
                {figure}
              </>
            ) : (
              <>
                {figure}
                {label}
              </>
            )}
          </span>
        </>
      );

      const shell = cn(
        'flex gap-2.5',
        labelFirst
          ? 'flex-col items-center justify-center px-5 py-4 text-center'
          : 'items-center px-4 py-2.5 text-start',
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
