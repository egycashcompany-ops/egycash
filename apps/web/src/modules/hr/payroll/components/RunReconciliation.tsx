// The run reconciled against its own payslips (P-HR-15-A), on the screen where a month is settled.
//
// WHY THIS IS NOT A NEW REPORT. P-HR-15 splits in two: the reconciliation, which is arithmetic over
// documents this system already wrote, and REPORTS, which are definitions nobody has given —
// which report, for whom, with which columns. This component defines nothing. Its rows are the
// merged `PayrollRunReconciliationDto`, its audience is the permission that already gates the
// endpoint, and its columns are that DTO's fields. It makes an approved API visible; it does not
// decide anything new.
//
// It lives INSIDE the run's payslips dialog rather than on a page of its own, and that is the whole
// reason it needs no permission and no page registry entry: a new page must declare a permission,
// and the answer here is the one the dialog already has.
//
// A DIFFERENCE IS NOT AN ERROR. The ordinary cause is an adjustment approved after the run issued
// its payslips — permitted by P-HR-04, with a forward path in P-HR-08. So it is shown as a stated
// figure, never as a failure, and nothing here is coloured red for being non-zero.
import { fromMinorUnits, type Locale, type PayrollRunReconciliationDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatMoney, formatNumber } from '../../../../shared/lib/format';
import { useRunReconciliation } from '../api/payroll-queries';

const Figure = ({ minor, currency }: { minor: number; currency: string }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <span dir="ltr" className="tabular-nums">
      {/*
        Through the SHARED conversion, never a local `/ 100`: the scale of a minor unit is a
        decision the money module owns, and a screen that hardcoded it would be a second answer to
        a question `fromMinorUnits` already answers everywhere else in payroll.
      */}
      {formatMoney(fromMinorUnits(minor), currency, locale)}
    </span>
  );
};

export const RunReconciliation = ({ runId }: { runId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const query = useRunReconciliation(runId);

  if (query.isLoading) {
    return <p className="text-xs text-slate-400">{t('common.loading')}</p>;
  }
  if (query.isError || query.data === undefined) {
    return (
      <p className="text-xs text-slate-400">{t('payroll.reconciliation.unavailable')}</p>
    );
  }

  const data: PayrollRunReconciliationDto = query.data;
  const count = (value: number): string => formatNumber(value, locale);

  return (
    <section
      className="space-y-3 rounded border border-slate-200 px-3 py-3 dark:border-slate-700"
      aria-label={t('payroll.reconciliation.title')}
    >
      <header className="space-y-0.5">
        <h3 className="text-sm font-medium">{t('payroll.reconciliation.title')}</h3>
        <p className="text-xs text-slate-500">{t('payroll.reconciliation.hint')}</p>
      </header>

      {/* R1 — per currency, never one summed number: nothing says two employees share a currency. */}
      <div className="space-y-1">
        {data.totals.length === 0 ? (
          <p className="text-xs text-slate-400">{t('payroll.reconciliation.nothingIssued')}</p>
        ) : (
          data.totals.map((row) => (
            <p key={row.currency} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
              <span className="font-mono" dir="ltr">
                {row.currency}
              </span>
              <span className="text-slate-500">
                {t('payroll.reconciliation.payslips', { count: count(row.payslips) })}
              </span>
              <span className="text-slate-500">
                {t('payroll.compensation.totalEarnings')}:{' '}
                <Figure minor={row.totalEarningsMinor} currency={row.currency} />
              </span>
              <span className="text-slate-500">
                {t('payroll.compensation.totalDeductions')}:{' '}
                <Figure minor={row.totalDeductionsMinor} currency={row.currency} />
              </span>
              <span className="font-semibold">
                {t('payroll.compensation.net')}:{' '}
                <Figure minor={row.netMinor} currency={row.currency} />
              </span>
            </p>
          ))
        )}
      </div>

      {/* R2 — the same population PY-7 issues from, so a gap is that batch's gap, not a second opinion. */}
      <p className="text-xs text-slate-500">
        {t('payroll.reconciliation.coverage', {
          employed: count(data.coverage.employedInPeriod),
          withPayslip: count(data.coverage.withPayslip),
          without: count(data.coverage.withoutPayslip),
        })}
      </p>

      {/* R3 — approved for the month against what actually reached a payslip. */}
      {data.adjustments.length > 0 && (
        <div className="space-y-1">
          {data.adjustments.map((row) => (
            <p key={row.currency} className="flex flex-wrap items-baseline gap-x-3 text-xs">
              <span className="font-mono" dir="ltr">
                {row.currency}
              </span>
              <span className="text-slate-500">
                {t('payroll.reconciliation.approved', { count: count(row.approvedForPeriod) })}:{' '}
                <Figure minor={row.approvedMinor} currency={row.currency} />
              </span>
              <span className="text-slate-500">
                {t('payroll.reconciliation.onPayslips')}:{' '}
                <Figure minor={row.onPayslipsMinor} currency={row.currency} />
              </span>
              {row.differenceMinor !== 0 && (
                <span className="text-slate-500">
                  {t('payroll.reconciliation.difference')}:{' '}
                  <Figure minor={row.differenceMinor} currency={row.currency} />
                </span>
              )}
            </p>
          ))}
          <p className="text-[11px] text-slate-400">
            {t('payroll.reconciliation.differenceHint')}
          </p>
        </div>
      )}
    </section>
  );
};
