// Captain report (B5) — the legacy `/ops_report` screen.
//
// WHAT IT REPORTS (discovery §D, contad_app.js:4837-5170): completed shipments in a date range,
// grouped by the captain who ran them — daily shipments attributed by COLLECTION date, secured
// ones by DELIVERY date. The range defaults to the current month, exactly as legacy did (:4862).
//
// NUMBERS WILL DIFFER FROM THE LEGACY REPORT, deliberately and in one direction: package counts
// were multiplied by the number of currencies on each shipment (Q26), so a multi-currency
// shipment's bags were counted two or three times. Corrected server-side; totals here read lower
// and right. The other two fixes (Q27's grand total, Q28's dropped zero-currency shipments) are
// also the server's — this page renders what it is given and computes no totals of its own.
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { useCaptainReport } from '../api/operations-queries';
import { ReportRangePicker } from '../components/ReportRangePicker';
import { ReportView, type ReportRow } from '../components/ReportView';
import { isRangeValid, rangeFromParams, type ReportRange } from '../lib/report-range';

export const CaptainReportPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const range = rangeFromParams({ from: sp.get('from'), to: sp.get('to') }, new Date());
  const valid = isRangeValid(range);

  const report = useCaptainReport(range, valid);

  const setRange = (next: ReportRange): void => {
    const params = new URLSearchParams(sp);
    params.set('from', next.from);
    params.set('to', next.to);
    setSp(params);
  };

  const rows: ReportRow[] = (report.data?.rows ?? []).map((row) => ({
    key: row.captainEmployeeId ?? 'unassigned',
    label: row.captainName,
    unattributed: row.captainEmployeeId === null,
    totals: row.totals,
  }));

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.reports.captains.title')}
        description={t('operations.reports.captains.subtitle')}
      />
      <ReportRangePicker range={range} onChange={setRange} />
      <ReportView
        keyHeader={t('operations.reports.captain')}
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
