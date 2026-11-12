// Vault roll-up (B6) — the legacy `/vault1_reports` screen, «تجميع الخزينة».
//
// «تجميع الخزينة هيكون زى الشاشة اللى بعتهالك بتاعت البنوك»: the legacy screen's layout — «من» /
// «إلى», the table «بيان الشحنات لكل بنك» (م | البنك | عدد المحصنات | المصري | الدولار | عملات أخرى |
// الحقائب | كرتونة | صندوق, «الإجمالي» under it) and beside it «إجمالي قيمة الشحنات» — on the boards'
// look (`components/ReportBoard.tsx`, `components/VaultValuePanel.tsx`).
//
// WHAT `/vault1_reports` ACTUALLY WAS (discovery §C, contad_app.js:1311-1333): a SHELL. Every figure
// on the page came from the client re-hitting `/vault1`, which ran two aggregations: a per-bank
// roll-up of what the vault holds (the table), and the non-EGP breakdown of that same set (the
// panel). Both are one server answer here, through the SAME roll-up as the bank report, so the two
// screens cannot disagree about the same packages (Q26).
//
// THE PERIOD IS THE OWNER'S: «يجيب اللى اتسلم واللى متسلمش ويجيب البداية كل اول شهر». Legacy's
// «من» / «إلى» filtered nothing (Q32); here they are the period the roll-up covers — every محصنة
// RECEIVED into the vault in it, whether it is still held, has gone out or has been delivered since,
// judged on the receipt's Cairo day (the server's `vaultReceiptRange`). A cancelled receipt does
// not count; a shipment received again counts on its new receipt's day. The period opens on the
// current month, exactly as «تقرير القادة» (`CaptainReportPage.tsx`) does, with the same refusal of
// an inverted range. What the vault holds right NOW is «جرد الخزينة»'s question, not this screen's.
//
// THE BANKS IN THE REFERENCE ORDER (Q31): legacy ranked them by a hardcoded list of 22 names; the
// bank's own `sortOrder` replaced it, and the rows follow it here (`bankRank`).
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useOperationsBanks, useVaultReport } from '../api/operations-queries';
import { ReportBoard } from '../components/ReportBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { VaultValuePanel } from '../components/VaultValuePanel';
import { bankRank, reportRowsInOrder, type ReportBoardRow } from '../lib/report-board';
import { isRangeValid, rangeFromParams } from '../lib/report-range';

export const VaultReportPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  // «ويجيب البداية كل اول شهر»: an empty URL is the current month, both days inclusive.
  const range = rangeFromParams({ from: sp.get('from'), to: sp.get('to') }, new Date());
  // An inverted range is refused here, in words, rather than sent (`isRangeValid`).
  const valid = isRangeValid(range);

  const report = useVaultReport(range, valid);
  // The boards' own query (the same parameters), so the catalog is one cache across them.
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });

  // Applied as it is chosen, as the boards apply a filter. Emptied, a bound goes back to its
  // default — the first or the last day of the current month (`rangeFromParams`, per field).
  const setBound = (param: 'from' | 'to', value: string): void => {
    const next = new URLSearchParams(sp);
    if (value === '') next.delete(param);
    else next.set(param, value);
    setSp(next);
  };

  const rankOf = bankRank(banks.data?.items ?? []);
  const rows: ReportBoardRow[] = reportRowsInOrder(
    report.data?.rows ?? [],
    (row) => row.bankId === null,
    (row) => rankOf(row.bankId),
  ).map((row) => ({
    key: row.bankId ?? 'unattributed',
    label: row.bankName,
    unattributed: row.bankId === null,
    totals: row.totals,
  }));

  return (
    <PageContainer fullHeight>
      <ReportBoard
        label={t('operations.vaultReport.title')}
        title={t('operations.vaultReport.table')}
        titleIcon={SHIPMENT_PATH.bank}
        keyHeader={t('operations.reports.bank')}
        countHeader={t('operations.vaultReport.securedCount')}
        rows={valid ? rows : []}
        grandTotal={valid ? report.data?.grandTotal : undefined}
        loading={valid && report.isLoading}
        error={report.error}
        onRetry={() => void report.refetch()}
        empty={t('operations.vaultReport.empty')}
        refusal={valid ? null : t('operations.reports.invalidRange')}
        datePickers={[
          {
            param: 'from',
            label: t('operations.reports.from'),
            showLabel: true,
            value: range.from,
            onChange: (value) => setBound('from', value),
          },
          {
            param: 'to',
            label: t('operations.reports.to'),
            showLabel: true,
            value: range.to,
            onChange: (value) => setBound('to', value),
          },
        ]}
        periodActive={sp.get('from') !== null || sp.get('to') !== null}
        onResetPeriod={() => {
          const next = new URLSearchParams(sp);
          next.delete('from');
          next.delete('to');
          setSp(next);
        }}
        aside={<VaultValuePanel grandTotal={report.data?.grandTotal} loading={report.isLoading} />}
      />
    </PageContainer>
  );
};
