// The date-range control both reports share.
//
// It refuses an inverted range rather than swapping the bounds (`isRangeValid`), because a report
// whose header reads back what the user typed while showing a different period is worse than no
// report. The range lives in the URL so a report can be linked and reloaded.
import { useT } from '../../../platform/localization/useT';
import { type ReportRange, isRangeValid } from '../lib/report-range';

export interface ReportRangePickerProps {
  range: ReportRange;
  onChange: (next: ReportRange) => void;
}

export const ReportRangePicker = ({ range, onChange }: ReportRangePickerProps): JSX.Element => {
  const t = useT();
  const invalid = !isRangeValid(range);

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">{t('operations.reports.from')}</span>
          <input
            type="date"
            value={range.from}
            onChange={(e) => onChange({ ...range, from: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-1.5 dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-slate-600 dark:text-slate-300">{t('operations.reports.to')}</span>
          <input
            type="date"
            value={range.to}
            onChange={(e) => onChange({ ...range, to: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-1.5 dark:border-slate-600 dark:bg-slate-800"
          />
        </label>
      </div>
      {invalid && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {t('operations.reports.invalidRange')}
        </p>
      )}
    </div>
  );
};
