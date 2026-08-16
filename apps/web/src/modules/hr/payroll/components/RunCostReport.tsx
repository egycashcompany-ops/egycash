// The same money, along one axis the reader chooses (P-HR-25).
//
// WHY THIS SITS BESIDE THE BREAKDOWN RATHER THAN REPLACING IT. `RunCostBreakdown` answers a
// question with no parameters — "what did this run cost, along every dimension the lines already
// carry" — and it still answers it in full. This answers a different one: "show me that money
// arranged by X". Neither is a better version of the other, and the breakdown's guarantee that the
// caller chooses nothing is worth keeping intact.
//
// IT PROPOSES NO COLUMN. The endpoint accepts calculated columns as expression trees, and this
// screen sends none: which derived figure is worth showing is a REPORT DEFINITION, and P-HR-15's
// rule is that this system does not invent one. When a caller sends columns, their keys and values
// are rendered as they arrive — named by whoever asked for them, not by us.
//
// It rides the run's payslips dialog, which is why it needs no permission of its own: the dialog's
// gate already answers, and the endpoint sits behind the same compensation key.
import { useState } from 'react';
import {
  PAYROLL_REPORT_GROUP_BY,
  fromMinorUnits,
  type Locale,
  type PayrollReportGroupBy,
  type PayrollRunCostReportDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatMoney, formatNumber } from '../../../../shared/lib/format';
import { useRunCostReport } from '../api/payroll-queries';

/** Through the shared conversion, never a local `/ 100` — the money module owns that scale. */
const Figure = ({ minor, currency }: { minor: number; currency: string }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <span dir="ltr" className="tabular-nums">
      {formatMoney(fromMinorUnits(minor), currency, locale)}
    </span>
  );
};

export const RunCostReport = ({ runId }: { runId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [groupBy, setGroupBy] = useState<PayrollReportGroupBy>('origin');
  const query = useRunCostReport(runId, groupBy);

  const data: PayrollRunCostReportDto | undefined = query.data;

  return (
    <section
      className="space-y-3 rounded border border-slate-200 px-3 py-3 dark:border-slate-700"
      aria-label={t('payroll.costReport.title')}
    >
      <header className="space-y-0.5">
        <h3 className="text-sm font-medium">{t('payroll.costReport.title')}</h3>
        <p className="text-xs text-slate-500">{t('payroll.costReport.hint')}</p>
      </header>

      <label className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">{t('payroll.costReport.groupBy')}</span>
        <select
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs dark:border-slate-600 dark:bg-slate-800"
          value={groupBy}
          onChange={(event) => {
            setGroupBy(event.target.value as PayrollReportGroupBy);
          }}
        >
          {PAYROLL_REPORT_GROUP_BY.map((axis) => (
            <option key={axis} value={axis}>
              {t(`payroll.costReport.axis.${axis}`)}
            </option>
          ))}
        </select>
      </label>

      {query.isError ? <p className="text-xs text-slate-400">{t('payroll.cost.unavailable')}</p> : null}
      {data === undefined && !query.isError ? (
        <p className="text-xs text-slate-400">{t('common.loading')}</p>
      ) : null}

      {data !== undefined && data.rows.length === 0 ? (
        <p className="text-xs text-slate-400">{t('payroll.cost.nothingIssued')}</p>
      ) : null}

      {data !== undefined && data.rows.length > 0 ? (
        <div className="space-y-1">
          {data.rows.map((row) => (
            <p
              key={`${row.currency}-${row.kind}-${row.axisId ?? 'none'}`}
              className="flex flex-wrap items-baseline gap-x-3 text-xs"
            >
              <span className="font-mono" dir="ltr">
                {row.currency}
              </span>
              <span>
                {/* An axis value with no label is a REAL group, not a gap: a line with no pay item,
                    or a payslip issued before cost centres existed. It is named, never hidden. */}
                {row.axisLabel === null
                  ? data.groupBy === 'origin' && row.axisId !== null
                    ? t(`payroll.compensation.origin.${row.axisId}`)
                    : (row.axisCode ?? t('payroll.costReport.unassigned'))
                  : row.axisLabel[locale === 'ar' ? 'ar' : 'en']}
              </span>
              <span className="text-slate-500">{t(`payroll.cost.kind.${row.kind}`)}</span>
              <span className="text-slate-400">
                {t('payroll.cost.lines', { count: formatNumber(row.lines, locale) })}
              </span>
              <Figure minor={row.amountMinor} currency={row.currency} />
              {/* Calculated columns, named by whoever asked for them. An empty cell is `null` — the
                  column could not be computed — and the row stays (D-REPORT-7). */}
              {data.columns.map((key) => (
                <span key={key} className="text-slate-500" dir="ltr">
                  {key}:{' '}
                  {row.calculated[key] === null || row.calculated[key] === undefined
                    ? '—'
                    : formatNumber(row.calculated[key] as number, locale)}
                </span>
              ))}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
};
