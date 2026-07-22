// The unified data surface for every list screen. Instead of three detached blocks (a filter bar,
// a bordered table, a pagination row), a list is one elevated card: a toolbar (search + filters +
// live result count) on top, the table in the middle, and pagination in an attached footer. This is
// the difference between a generic admin grid and a Stripe/Linear data view. Presentation only — the
// table, filters and pagination are passed in by the page.
import { type ReactNode } from 'react';
import { useAppSelector } from '../../store';
import { useT } from '../../platform/localization/useT';
import { formatNumber } from '../lib/format';
import { CloseIcon } from './icons';

export const ListView = ({
  search,
  filters,
  actions,
  total,
  hasActiveFilters = false,
  onClear,
  pagination,
  children,
}: {
  /** The search box (rendered at the reading start of the toolbar). */
  search?: ReactNode;
  /** Filter controls (selects, toggles) following the search box. */
  filters?: ReactNode;
  /** Optional toolbar-level actions rendered at the end (most pages keep the primary action in the page header). */
  actions?: ReactNode;
  /** Live result count shown at the end of the toolbar. */
  total?: number | undefined;
  hasActiveFilters?: boolean;
  onClear?: (() => void) | undefined;
  /** Pagination controls, rendered in the attached footer only when present. */
  pagination?: ReactNode;
  /** The <DataTable embedded /> for this list. */
  children: ReactNode;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  const showToolbar =
    search !== undefined || filters !== undefined || actions !== undefined || total !== undefined;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card dark:border-slate-800 dark:bg-slate-900">
      {showToolbar && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-3 dark:border-slate-800">
          {search}
          {filters}
          {onClear !== undefined && hasActiveFilters && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <CloseIcon className="h-4 w-4" />
              {t('common.filters.clear')}
            </button>
          )}
          <div className="ms-auto flex items-center gap-3 ps-2">
            {total !== undefined && (
              <span className="whitespace-nowrap text-sm tabular-nums text-slate-500 dark:text-slate-400">
                {t('common.list.count', { count: formatNumber(total, locale) })}
              </span>
            )}
            {actions}
          </div>
        </div>
      )}
      {children}
      {pagination !== undefined && (
        <div className="border-t border-slate-100 px-3 dark:border-slate-800">{pagination}</div>
      )}
    </section>
  );
};
