// The shared body of both Operations reports.
//
// The two legacy reports (`/ops_report`, `/ops_bank_report`) were structurally identical — the
// same `$facet`, the same totals, keyed on a different field (discovery §D). They are ONE
// component here for the same reason they were one aggregation there: the day the totals row
// changes, it must change in both, and two copies is how a captain report and a bank report start
// disagreeing about the same month.
//
// THREE THINGS THIS COMPONENT WILL NOT DO, each a legacy defect the backend already fixed and the
// UI must not reintroduce:
//   · it never sums `rows` to produce the total — `grandTotal` comes from the server (Q27);
//   · it never multiplies package counts by currency lines (Q26);
//   · it never hides a row whose money is zero — a shipment with no currency lines still happened
//     and is still counted (Q28).
import { type ReactNode } from 'react';
import {
  type OperationsReportCurrencyTotalDto,
  type OperationsReportTotalsDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';

export interface ReportRow {
  key: string;
  label: string;
  /** True for the row the server could not attribute — rendered as such, never dropped. */
  unattributed: boolean;
  totals: OperationsReportTotalsDto;
}

/** One row's per-currency figures, stacked. Every currency the row carries is shown. */
const CurrencyCell = ({
  currencies,
}: {
  currencies: OperationsReportCurrencyTotalDto[];
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((s) => s.locale.locale);
  if (currencies.length === 0) {
    // Q28: a completed shipment with no currency lines is counted, so this cell must say
    // "no money recorded" rather than render an empty box that reads like missing data.
    return <span className="text-xs text-slate-500">{t('operations.reports.noCurrency')}</span>;
  }
  return (
    <div className="space-y-0.5">
      {currencies.map((line) => (
        <div key={line.currencyId ?? line.currencyName} className="flex gap-2 text-sm">
          <span className="tabular-nums">{formatAmount(line.amount, locale)}</span>
          <span className="text-slate-500">{line.currencyName}</span>
        </div>
      ))}
    </div>
  );
};

export interface ReportViewProps {
  /** The column header for the key the report is grouped on — captain, or bank. */
  keyHeader: string;
  rows: ReportRow[];
  grandTotal: OperationsReportTotalsDto | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: ReactNode;
}

export const ReportView = ({
  keyHeader,
  rows,
  grandTotal,
  loading,
  error,
  onRetry,
  empty,
}: ReportViewProps): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((s) => s.locale.locale);

  const columns: Column<ReportRow>[] = [
    {
      key: 'label',
      header: keyHeader,
      render: (row) =>
        row.unattributed ? (
          <span className="text-slate-500">{t('operations.reports.unattributed')}</span>
        ) : (
          row.label
        ),
    },
    {
      key: 'shipments',
      header: t('operations.reports.shipmentCount'),
      align: 'end',
      render: (row) => (
        <span className="tabular-nums">{formatNumber(row.totals.shipmentCount, locale)}</span>
      ),
    },
    {
      key: 'packages',
      header: t('operations.reports.packages'),
      render: (row) => (
        <span className="tabular-nums text-sm">
          {t('operations.vault.packageCounts', {
            bags: row.totals.bagCount,
            cartons: row.totals.cartonCount,
            boxes: row.totals.boxCount,
          })}
        </span>
      ),
    },
    {
      key: 'currencies',
      header: t('operations.reports.amounts'),
      render: (row) => <CurrencyCell currencies={row.totals.currencies} />,
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        loading={loading}
        error={error}
        onRetry={onRetry}
        empty={empty}
      />
      {grandTotal !== undefined && rows.length > 0 && (
        // The server's own total, NOT a sum of the rows above (Q27). Rendered apart from the table
        // so it cannot be mistaken for one more row — which is exactly how legacy lost it.
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="mb-2 text-sm font-semibold">{t('operations.reports.grandTotal')}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <div className="text-xs text-slate-500">{t('operations.reports.shipmentCount')}</div>
              <div className="tabular-nums">
                {formatNumber(grandTotal.shipmentCount, locale)}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('operations.reports.packages')}</div>
              <div className="tabular-nums text-sm">
                {t('operations.vault.packageCounts', {
                  bags: grandTotal.bagCount,
                  cartons: grandTotal.cartonCount,
                  boxes: grandTotal.boxCount,
                })}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500">{t('operations.reports.amounts')}</div>
              <CurrencyCell currencies={grandTotal.currencies} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
