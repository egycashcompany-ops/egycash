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

export const VaultReportPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const report = useVaultReport();
  // The boards' own query (the same parameters), so the catalog is one cache across them.
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });

  // ── PENDING THE OWNER'S DECISION: what «من» / «إلى» filter. ─────────────────────────────────
  // «زى الشاشة اللى بعتهالك» — legacy's screen had the two dates, so the sample shows them, empty
  // (empty = everything in the vault now). They are SHOWN, NOT SENT: the server's vault roll-up
  // refuses `?from` / `?to` on purpose (report.routes.ts, Q32 — legacy's picker filtered nothing, its
  // date filters were commented out in both aggregations), and what the dates should mean is the
  // owner's to say: the vault-receipt day of what is held now, or everything received in the
  // period whether or not it is still held. Until he answers, these two values reach no query —
  // wire them to `useVaultReport` (and the route's schema) once he does.
  const pendingFrom = sp.get('from') ?? '';
  const pendingTo = sp.get('to') ?? '';
  const setPending = (param: 'from' | 'to', value: string): void => {
    const next = new URLSearchParams(sp);
    if (value === '') next.delete(param);
    else next.set(param, value);
    setSp(next, { replace: true });
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
        rows={rows}
        grandTotal={report.data?.grandTotal}
        loading={report.isLoading}
        error={report.error}
        onRetry={() => void report.refetch()}
        empty={t('operations.vault.empty')}
        datePickers={[
          {
            param: 'from',
            label: t('operations.reports.from'),
            showLabel: true,
            optional: true,
            value: pendingFrom,
            onChange: (value) => setPending('from', value),
          },
          {
            param: 'to',
            label: t('operations.reports.to'),
            showLabel: true,
            optional: true,
            value: pendingTo,
            onChange: (value) => setPending('to', value),
          },
        ]}
        periodActive={pendingFrom !== '' || pendingTo !== ''}
        onResetPeriod={() => {
          const next = new URLSearchParams(sp);
          next.delete('from');
          next.delete('to');
          setSp(next, { replace: true });
        }}
        aside={<VaultValuePanel grandTotal={report.data?.grandTotal} loading={report.isLoading} />}
      />
    </PageContainer>
  );
};
