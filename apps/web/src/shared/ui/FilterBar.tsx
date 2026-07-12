// Layout container for a screen's filter controls (search, selects, date ranges…). Presents a
// consistent bar and an optional "clear filters" affordance shown only when filters are active.
import { type ReactNode } from 'react';
import { useT } from '../../platform/localization/useT';
import { CloseIcon } from './icons';

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
          className="ms-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <CloseIcon className="h-4 w-4" />
          {t('common.filters.clear')}
        </button>
      )}
    </div>
  );
};
