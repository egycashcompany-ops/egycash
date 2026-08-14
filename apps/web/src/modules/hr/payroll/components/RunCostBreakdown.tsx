// What a run cost, along the dimensions its lines already carry (P-HR-14 / U14-1).
//
// WHY THIS IS NOT A LEDGER SCREEN. There is no chart of accounts in this system, no mapping, no
// posting rule and no journal — six accounting decisions the owner has not made, and P-HR-14's
// discovery keeps them open. What this shows is the ARITHMETIC such a posting would one day
// consume: sums of payslip lines, grouped by the keys those lines already store. It names no
// account, and so it decides nothing.
//
// It rides the run's payslips dialog rather than a page of its own — which is also why it needs no
// permission: the dialog's gate already answers.
//
// NO NET AND NO CROSS-CURRENCY TOTAL. Earnings and deductions are shown side by side inside their
// own currency, never subtracted; direction is what `kind` means, and there is no exchange rate in
// this system.
import {
  fromMinorUnits,
  type Locale,
  type PayrollRunCostBreakdownDto,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { formatMoney, formatNumber } from '../../../../shared/lib/format';
import { useRunCostBreakdown } from '../api/payroll-queries';

/** Through the shared conversion, never a local `/ 100` — the money module owns that scale. */
const Figure = ({ minor, currency }: { minor: number; currency: string }): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <span dir="ltr" className="tabular-nums">
      {formatMoney(fromMinorUnits(minor), currency, locale)}
    </span>
  );
};

export const RunCostBreakdown = ({ runId }: { runId: string }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const query = useRunCostBreakdown(runId);

  if (query.isLoading) return <p className="text-xs text-slate-400">{t('common.loading')}</p>;
  if (query.isError || query.data === undefined) {
    return <p className="text-xs text-slate-400">{t('payroll.cost.unavailable')}</p>;
  }

  const data: PayrollRunCostBreakdownDto = query.data;
  const count = (value: number): string => formatNumber(value, locale);

  return (
    <section
      className="space-y-3 rounded border border-slate-200 px-3 py-3 dark:border-slate-700"
      aria-label={t('payroll.cost.title')}
    >
      <header className="space-y-0.5">
        <h3 className="text-sm font-medium">{t('payroll.cost.title')}</h3>
        <p className="text-xs text-slate-500">{t('payroll.cost.hint')}</p>
      </header>

      {data.byOrigin.length === 0 ? (
        <p className="text-xs text-slate-400">{t('payroll.cost.nothingIssued')}</p>
      ) : (
        <>
          {/* By what produced the line — the primary split, and closed vocabulary. */}
          <div className="space-y-1">
            <h4 className="text-xs font-medium text-slate-500">{t('payroll.cost.byOrigin')}</h4>
            {data.byOrigin.map((row) => (
              <p
                key={`${row.currency}-${row.kind}-${row.origin}`}
                className="flex flex-wrap items-baseline gap-x-3 text-xs"
              >
                <span className="font-mono" dir="ltr">
                  {row.currency}
                </span>
                <span>{t(`payroll.compensation.origin.${row.origin}`)}</span>
                <span className="text-slate-500">{t(`payroll.cost.kind.${row.kind}`)}</span>
                <span className="text-slate-400">{t('payroll.cost.lines', { count: count(row.lines) })}</span>
                <Figure minor={row.amountMinor} currency={row.currency} />
              </p>
            ))}
          </div>

          {/* By the catalog item behind the line — `origin` explains a line with no item. */}
          <div className="space-y-1">
            <h4 className="text-xs font-medium text-slate-500">{t('payroll.cost.byPayItem')}</h4>
            {data.byPayItem.map((row) => (
              <p
                key={`${row.currency}-${row.kind}-${row.origin}-${row.payItemId ?? row.code}`}
                className="flex flex-wrap items-baseline gap-x-3 text-xs"
              >
                <span className="font-mono" dir="ltr">
                  {row.currency}
                </span>
                <span className="font-mono" dir="ltr">
                  {row.code}
                </span>
                <span className="text-slate-500">{t(`payroll.cost.kind.${row.kind}`)}</span>
                <Figure minor={row.amountMinor} currency={row.currency} />
              </p>
            ))}
          </div>

          {/* By the branch the payslip was issued in — as it stood then (ADR-015). */}
          <div className="space-y-1">
            <h4 className="text-xs font-medium text-slate-500">{t('payroll.cost.byBranch')}</h4>
            {data.byBranch.map((row) => (
              <p
                key={`${row.currency}-${row.kind}-${row.branchId ?? 'none'}`}
                className="flex flex-wrap items-baseline gap-x-3 text-xs"
              >
                <span className="font-mono" dir="ltr">
                  {row.currency}
                </span>
                <span>
                  {row.branchName === null
                    ? t('payroll.cost.noBranch')
                    : row.branchName[locale === 'ar' ? 'ar' : 'en']}
                </span>
                <span className="text-slate-500">{t(`payroll.cost.kind.${row.kind}`)}</span>
                <Figure minor={row.amountMinor} currency={row.currency} />
              </p>
            ))}
          </div>
        </>
      )}
    </section>
  );
};
