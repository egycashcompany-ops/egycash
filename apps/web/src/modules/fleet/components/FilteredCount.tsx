// HOW MANY ROWS THE FILTER LEFT — «رقم الاجمالى الموجود فى الجدول بعد الفلاتر ... زى دا اللى فى
// شاشه مخالفات».
//
// ONE BADGE, ONE NUMBER, ON THE FILTER BAR'S OWN LINE. It replaced a four-cell strip that sat
// above the table describing the filtered set from several angles at once; the owner's answer to
// it was «انا مش فاهم». A reader looking at a filtered table has one question about the set as a
// whole — how many — and the violations board had been answering it in a single badge beside the
// reset all along. This is that badge, so the screens read alike.
//
// It counts the WHOLE filtered set, never the page: it is handed `meta.totalItems`, so turning a
// page cannot move it. Nothing is drawn while the answer is in flight — a 0 there would be a
// claim, and it would be wrong as often as it was right.
import { type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { formatNumber } from '../../../shared/lib/format';

export const FilteredCount = ({ value }: { value: number | undefined }): JSX.Element | null => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  if (value === undefined) return null;
  return (
    <span
      data-filtered-count
      role="status"
      title={t('fleet.filters.matchedRows')}
      className="whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-sm font-medium tabular-nums text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
    >
      {formatNumber(value, locale)}
    </span>
  );
};
