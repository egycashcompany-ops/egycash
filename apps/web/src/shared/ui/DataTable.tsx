// Generic, RTL-safe data table with built-in loading (skeleton), error (retry), and empty
// states, optional column sorting, row selection (bulk), and row-click. Presentation only —
// data fetching/paging is the caller's (a feature api/ hook via TanStack Query).
import { type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Skeleton } from './Skeleton';
import { ChevronIcon } from './icons';
import { EmptyState } from './states/EmptyState';
import { ErrorState } from './states/ErrorState';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
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
  error?: unknown;
  onRetry?: () => void;
  empty?: ReactNode;
  sort?: SortState;
  onSortChange?: (key: string) => void;
  onRowClick?: (row: T) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: (checked: boolean) => void;
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
  selectable = false,
  selectedIds,
  onToggleRow,
  onToggleAll,
}: DataTableProps<T>): JSX.Element => {
  const colCount = columns.length + (selectable ? 1 : 0);
  const selected = selectedIds ?? new Set<string>();
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
  const someSelected = rows.some((r) => selected.has(rowKey(r)));

  const body = ((): ReactNode => {
    if (error !== undefined && !loading) {
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
          {selectable && (
            <td className="px-4 py-3">
              <Skeleton className="h-4 w-4" />
            </td>
          )}
          {columns.map((c) => (
            <td key={c.key} className="px-4 py-3">
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
    return rows.map((row) => {
      const id = rowKey(row);
      const isSelected = selected.has(id);
      return (
        <tr
          key={id}
          onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
          className={cn(
            'border-t border-slate-100 dark:border-slate-800',
            onRowClick !== undefined && 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50',
            isSelected && 'bg-brand-50/60 dark:bg-brand-950/40',
          )}
        >
          {selectable && (
            <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                checked={isSelected}
                onChange={() => onToggleRow?.(id)}
                aria-label="select row"
              />
            </td>
          )}
          {columns.map((c) => (
            <td
              key={c.key}
              className={cn(
                'px-4 py-3 text-sm text-slate-700 dark:text-slate-200',
                alignClass[c.align ?? 'start'],
                // Numeric (end-aligned) columns line up cleanly with lining figures.
                c.align === 'end' && 'tabular-nums',
                c.className,
              )}
            >
              {c.render(row)}
            </td>
          ))}
        </tr>
      );
    });
  })();

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <table className="w-full min-w-[40rem] border-collapse">
        <thead>
          <tr className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            {selectable && (
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  checked={allSelected}
                  ref={(el) => {
                    if (el !== null) el.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={(e) => onToggleAll?.(e.target.checked)}
                  aria-label="select all"
                />
              </th>
            )}
            {columns.map((c) => {
              const active = sort?.by === c.key;
              return (
                <th
                  key={c.key}
                  className={cn(
                    'px-4 py-3 font-semibold',
                    // Emphasize the column the table is currently sorted by.
                    active && 'text-slate-700 dark:text-slate-200',
                    alignClass[c.align ?? 'start'],
                    c.headerClassName,
                  )}
                >
                  {c.sortable === true && onSortChange !== undefined ? (
                    <button
                      type="button"
                      onClick={() => onSortChange(c.key)}
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
                          active && sort?.dir === 'asc' && 'rotate-180',
                        )}
                      />
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
