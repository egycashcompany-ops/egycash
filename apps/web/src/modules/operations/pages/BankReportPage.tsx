// Bank report (B5) — the legacy `/ops_bank_report` screen.
//
// The captain report's twin: the same completed-shipment set over the same range, keyed on the
// BANK instead of the captain (contad_app.js:5173-5440). It shares `ReportView` for that reason —
// the two reports must always agree about the same month.
//
// Q31 also lands here: the legacy report sorted banks by a hardcoded 22-name `$switch` written
// into the aggregation (:1449), so a new bank fell to the bottom in creation order and renaming
// one silently moved it. Ordering is the bank's own `sortOrder` field now, maintained in the
// catalogs screen, so it is data rather than code.
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useBankReport } from '../api/operations-queries';
import { ReportRangePicker } from '../components/ReportRangePicker';
import { ReportView, type ReportRow } from '../components/ReportView';
import { isRangeValid, rangeFromParams, type ReportRange } from '../lib/report-range';

export const BankReportPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const range = rangeFromParams({ from: sp.get('from'), to: sp.get('to') }, new Date());
  const valid = isRangeValid(range);

  const report = useBankReport(range, valid);

  const setRange = (next: ReportRange): void => {
    const params = new URLSearchParams(sp);
    params.set('from', next.from);
    params.set('to', next.to);
    setSp(params);
  };

  const rows: ReportRow[] = (report.data?.rows ?? []).map((row) => ({
    key: row.bankId ?? 'unattributed',
    label: row.bankName,
    unattributed: row.bankId === null,
    totals: row.totals,
  }));

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.reports.banks.title')}
        description={t('operations.reports.banks.subtitle')}
      />
      <ReportRangePicker range={range} onChange={setRange} />
      <ReportView
        keyHeader={t('operations.reports.bank')}
        rows={rows}
        grandTotal={report.data?.grandTotal}
        loading={valid && report.isLoading}
        error={report.error}
        onRetry={() => void report.refetch()}
        empty={t('operations.reports.empty')}
      />
    </PageContainer>
  );
};
