// Generic, RTL-safe data table with built-in loading (skeleton), error (retry), and empty
// states, optional column sorting, row selection (bulk), and row-click. Presentation only —
// data fetching/paging is the caller's (a feature api/ hook via TanStack Query).
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { hasError } from '../lib/errors';
import { Skeleton } from './Skeleton';
import { ChevronIcon } from './icons';
import { EmptyState } from './states/EmptyState';
import { ErrorState } from './states/ErrorState';
import { type TableSelection } from './useTableSelection';

export interface Column<T> {
  key: string;
  header: string;
  /**
   * `index` is the row's position in THIS page, 0-based — a serial column turns it into a number
   * a reader can call a row by. It is deliberately page-local: the table is handed one page and
   * knows nothing about the paging around it, so a column that must count from the start of the
   * whole list adds its own offset from the pagination meta.
   */
  render: (row: T, index: number) => ReactNode;
  sortable?: boolean;
  /**
   * What the SERVER calls this column, when that is not what the table calls it.
   *
   * A column's `key` is a React key and a name for the cell; the sort parameter is an API field.
   * Usually they are the same word and this stays unset. They part company where the column shows
   * something DERIVED from what is stored — «النوع» renders a name and is ordered by `typeName`,
   * which is joined in from the vehicle types — and then the screen must be able to say so.
   */
  sortKey?: string;
  align?: 'start' | 'center' | 'end';
  className?: string;
  headerClassName?: string;
}

export interface SortState {
  by: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  /**
   * The thrown value, if the fetch failed. Pass a TanStack Query `error` straight through:
   * `null` (its "no failure" value) and `undefined` both mean no error — see `hasError`.
   */
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  /**
   * What the table is sorted by. ONE column, or SEVERAL in precedence order — «انا عاوز اقدر
   * اعمل الاتنين مع بعض»: a registry is read by more than one question at a time, and a header
   * that can only hold one answer throws the last one away on every click.
   *
   * An array is rendered with a small ordinal beside each arrow, so the reader can see that the
   * table is on «code, then expiry» rather than guessing from two identical arrows. Passing a
   * single object is exactly what it always was: no badge, no change. What a CLICK does — replace
   * or add — is the caller's rule, not this table's (Fleet's lives in `lib/table-sort`).
   */
  sort?: SortState | readonly SortState[];
  onSortChange?: (key: string) => void;
  onRowClick?: (row: T) => void;
  /**
   * The whole selection model in one prop — pass `useTableSelection(rows.map(rowKey))` and the
   * table is selectable (RW17). Its presence is what makes the table selectable.
   */
  selection?: TableSelection;
  /** Drop the table's own border/rounding/background when it sits inside a ListView surface. */
  embedded?: boolean;
  /**
   * Highlight the row under the pointer even though it is not clickable. A row full of buttons is
   * still a row you track with your eyes across eight columns; the highlight is for reading, not
   * for promising navigation, which is why it is separate from `onRowClick`.
   */
  hoverable?: boolean;
  /**
   * A tighter grid, for a table whose cells carry avatars, chips and inline controls: those set
   * the row's height on their own, so the padding around them is doing nothing but pushing rows
   * off the screen. Trims both gutters and lands a 40px-avatar row at about 60px — the height the
   * rest of the system's tables sit at.
   */
  dense?: boolean;
  /**
   * Extra classes for ONE row, from the row itself — a state the reader should be able to see
   * without reading the cell that carries it.
   *
   * Opt-in, and colour is never allowed to be the only carrier of that state: a row tinted here
   * must still say what it is in a cell, or the state is invisible to anyone who cannot separate
   * the two tints. Returning `undefined` leaves the row exactly as it was.
   */
  rowClassName?: (row: T) => string | undefined;
  /**
   * How big the table's own text is. Orthogonal to `dense`, which is about PADDING: a table can be
   * tight and legible, or roomy and small, and the two questions have different answers.
   *
   * `compact` is the default and what every table has always been. `comfortable` is one step up
   * the scale for a screen that is read rather than scanned — a register of files somebody works
   * through for an hour, where `text-xs` headers over `text-sm` cells is a squint, not a density
   * saving. It moves only the type; the gutters and the row heights follow the text, not a second
   * decision.
   */
  textScale?: 'compact' | 'comfortable';
  /**
   * KEEP THE HEAD IN VIEW while the rows scroll under it — for a board somebody works down for a
   * while, where losing the column names forty rows in means scrolling back to read one cell.
   *
   * It makes THIS table the thing that scrolls: the wrapper takes the height its parent gives it
   * (`h-full`, so the caller sizes it — `min-h-0 flex-1` in a column) and scrolls in both axes.
   * That is not a style preference but the mechanism: `position: sticky` sticks to the nearest
   * scrolling ancestor, so a head inside a wrapper that does not scroll vertically would simply
   * ride away with the parent that does.
   *
   * The head also turns OPAQUE. It is drawn over the rows, and at `dark:bg-slate-800/60` they show
   * through it — which reads as a broken header rather than as a translucent one.
   */
  stickyHead?: boolean;
}

const alignClass: Record<'start' | 'center' | 'end', string> = {
  start: 'text-start',
  center: 'text-center',
  end: 'text-end',
};

export const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  empty,
  sort,
  onSortChange,
  onRowClick,
  selection,
  embedded = false,
  hoverable = false,
  dense = false,
  rowClassName,
  textScale = 'compact',
  stickyHead = false,
}: DataTableProps<T>): JSX.Element => {
  // One shape inside, whichever shape came in: the single-column callers (every module but Fleet)
  // and the multi-column ones read the same way from here down.
  const sorts: readonly SortState[] = sort === undefined ? [] : Array.isArray(sort) ? sort : [sort];
  const roomy = textScale === 'comfortable';
  const cellPadding = dense ? 'px-3 py-2' : roomy ? 'px-4 py-3.5' : 'px-4 py-3';
  const cellText = roomy ? 'text-base' : 'text-sm';
  const headerText = roomy ? 'text-sm' : 'text-xs';
  // One prop wins; the loose props remain as the deprecated form.
  const isSelectable = selection !== undefined;
  const selected = selection?.selectedIds ?? new Set<string>();
  const toggleRow = selection?.toggleRow;
  const toggleAll = selection?.toggleAll;
  const colCount = columns.length + (isSelectable ? 1 : 0);

  /**
   * HOW NARROW THE TABLE MAY GET BEFORE ITS WRAPPER SCROLLS — by how many columns it has.
   *
   * It was a flat `min-w-[40rem]`, chosen when no table in the app carried more than about six
   * columns. The Fleet registers now carry thirteen: below the floor the browser stops scrolling
   * and starts SQUEEZING, so every column shrinks to fit and a driver's name, a date and a
   * six-digit reading each wrap onto two or three lines. The grid is still all there and is no
   * longer readable — «ظبط عرض الجداول بعد الأعمدة الجديدة».
   *
   * A floor PER COLUMN instead: ~7.5rem is a date, a three-word Arabic name or a reading plus the
   * cell's own gutters, which is what these columns actually hold. The old 40rem stays as the
   * minimum, so every table of five columns or fewer is exactly as wide as it was today and only
   * the ones that outgrew the wrapper start using it.
   *
   * Inline rather than a class because Tailwind cannot build a class name from a count, and the
   * alternative — a handful of fixed buckets — would be the same arithmetic with worse rounding.
   */
  const minTableWidth = Math.max(40, colCount * 7.5);
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
  const someSelected = rows.some((r) => selected.has(rowKey(r)));

  const body = ((): ReactNode => {
    if (hasError(error) && !loading) {
      return (
        <tr>
          <td colSpan={colCount}>
            <ErrorState error={error} {...(onRetry === undefined ? {} : { onRetry })} />
          </td>
        </tr>
      );
    }
    if (loading) {
      return Array.from({ length: 5 }).map((_, i) => (
        <tr key={`sk-${i}`} className="border-t border-slate-100 dark:border-slate-800">
          {isSelectable && (
            <td className="px-4 py-3">
              <Skeleton className="h-4 w-4" />
            </td>
          )}
          {columns.map((c) => (
            <td key={c.key} className={cellPadding}>
              <Skeleton className="h-4 w-full max-w-[12rem]" />
            </td>
          ))}
        </tr>
      ));
    }
    if (rows.length === 0) {
      return (
        <tr>
          <td colSpan={colCount}>{empty ?? <EmptyState />}</td>
        </tr>
      );
    }
    return rows.map((row, index) => {
      const id = rowKey(row);
      const isSelected = selected.has(id);
      return (
        <tr
          key={id}
          onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
          className={cn(
            // `group` so a cell can reveal its secondary controls when the pointer is on the row —
            // see `RowActions`. Costs nothing on a row that does not use it.
            'group border-t border-slate-100 transition-colors dark:border-slate-800',
            // Enough to feel which row you are on across a wide table, and no more: one step of
            // the neutral ramp, not a tint that competes with the badges sitting in the row.
            (onRowClick !== undefined || hoverable) &&
              'hover:bg-slate-100/70 dark:hover:bg-slate-800/70',
            onRowClick !== undefined && 'cursor-pointer',
            isSelected && 'bg-brand-50/60 dark:bg-brand-950/40',
            // Last, so a row that names its own tone wins over the neutral default.
            rowClassName?.(row),
          )}
        >
          {isSelectable && (
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={isSelected}
                onChange={() => toggleRow?.(id)}
                aria-label="select row"
              />
            </td>
          )}
          {columns.map((c) => (
            <td
              key={c.key}
              className={cn(
                cellPadding,
                cellText,
                'text-slate-700 dark:text-slate-200',
                alignClass[c.align ?? 'start'],
                // Numeric (end-aligned) columns line up cleanly with lining figures.
                c.align === 'end' && 'tabular-nums',
                c.className,
              )}
            >
              {c.render(row, index)}
            </td>
          ))}
        </tr>
      );
    });
  })();

  return (
    <div
      className={cn(
        stickyHead ? 'h-full overflow-auto' : 'overflow-x-auto',
        !embedded &&
          'rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      <table className="w-full border-collapse" style={{ minWidth: `${minTableWidth}rem` }}>
        {/* `undefined`, not `cn(false && …)`: that renders `class=""` on every table in the app
            and turns a plain `<thead>` into one nothing else can match on. */}
        <thead className={stickyHead ? 'sticky top-0 z-10' : undefined}>
          <tr
            className={cn(
              'bg-slate-50 uppercase tracking-wide text-slate-500 dark:text-slate-400',
              // See-through only where nothing scrolls under it.
              stickyHead ? 'dark:bg-slate-800' : 'dark:bg-slate-800/60',
              headerText,
            )}
          >
            {isSelectable && (
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={allSelected}
                  ref={(el) => {
                    if (el !== null) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={(e) => toggleAll?.(e.target.checked)}
                  aria-label="select all"
                />
              </th>
            )}
            {columns.map((c) => {
              const sortKey = c.sortKey ?? c.key;
              const at = sorts.findIndex((entry) => entry.by === sortKey);
              const active = at !== -1;
              const dir = active ? sorts[at]?.dir : undefined;
              return (
                <th
                  key={c.key}
                  className={cn(
                    // Same gutter as the cells below it, or the header stops lining up with them.
                    cellPadding,
                    'font-semibold',
                    // Emphasize the column the table is currently sorted by.
                    active && 'text-slate-700 dark:text-slate-200',
                    alignClass[c.align ?? 'start'],
                    c.headerClassName,
                  )}
                >
                  {c.sortable === true && onSortChange !== undefined ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(sortKey)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/30 dark:hover:text-slate-200',
                        active && 'text-slate-700 dark:text-slate-200',
                      )}
                    >
                      {c.header}
                      <ChevronIcon
                        className={cn(
                          'h-3.5 w-3.5 transition-transform',
                          active ? 'opacity-100' : 'opacity-30',
                          active && dir === 'asc' && 'rotate-180',
                        )}
                      />
                      {/* WHICH column decides first, when more than one does. Plain digits: this
                          is an ordinal marker on a control, read beside an arrow rather than in a
                          sentence, and the table is shared by every module and holds no locale. */}
                      {active && sorts.length > 1 && (
                        <span
                          data-sort-order={at + 1}
                          className="rounded-sm bg-slate-200 px-1 text-[0.625rem] font-bold leading-4 text-slate-600 dark:bg-slate-700 dark:text-slate-200"
                        >
                          {at + 1}
                        </span>
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
};
