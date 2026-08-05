// Layout container for a screen's filter controls (search, selects, date ranges…). Presents a
// consistent bar and a reset affordance shown only when filters are actually active.
//
// Reset is an ICON, and a coloured one. The old text button sat in a row of grey controls and read
// as one more filter rather than the way out of them — and "clear" next to a list of filters is
// ambiguous about which one it clears. An amber circular-arrow is unmistakably "undo all of this",
// and it stays labelled for screen readers and on hover.
import { type ReactNode } from 'react';
import { useT } from '../../platform/localization/useT';
import { ResetIcon } from './icons';

export const FilterBar = ({
  children,
  onClear,
  hasActiveFilters = false,
}: {
  children: ReactNode;
  onClear?: () => void;
  hasActiveFilters?: boolean;
}): JSX.Element => {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      {children}
      {onClear !== undefined && hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          aria-label={t('common.filters.clear')}
          title={t('common.filters.clear')}
          className="ms-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-50 text-amber-700 transition-colors hover:bg-amber-100 hover:text-amber-900 focus:outline-none focus:ring-2 focus:ring-amber-400 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900"
        >
          <ResetIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
