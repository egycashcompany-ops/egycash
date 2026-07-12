// Contextual action bar shown when rows are selected in a DataTable. Renders nothing when the
// selection is empty. Actions (gated by permission at the call site) go in `children`.
import { type ReactNode } from 'react';
import { useAppSelector } from '../../store';
import { useT } from '../../platform/localization/useT';
import { formatNumber } from '../lib/format';

export const BulkActions = ({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children?: ReactNode;
}): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state) => state.locale.locale);
  if (count === 0) return null;
  return (
    <div className="flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2 text-sm dark:border-brand-800 dark:bg-brand-950/60">
      <span className="font-medium text-brand-800 dark:text-brand-200">
        {t('common.bulk.selected', { count: formatNumber(count, locale) })}
      </span>
      <div className="ms-auto flex items-center gap-2">
        {children}
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg px-2.5 py-1.5 font-medium text-slate-500 hover:bg-white hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {t('common.bulk.clear')}
        </button>
      </div>
    </div>
  );
};
