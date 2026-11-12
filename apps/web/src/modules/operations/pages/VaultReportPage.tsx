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
// an inverted range. What the vault holds right NOW is «سجل الخزينة»'s «تقرير الخزينة»
// (`VaultInventoryPage.tsx`), not this screen's.
//
// THE BANKS IN THE REFERENCE ORDER (Q31): legacy ranked them by a hardcoded list of 22 names; the
// bank's own `sortOrder` replaced it, and the rows follow it here (`bankRank`).
//
// ROUND 12 — «شاشة البنوك بتاعت المحصنات شيل الديف اللى فيها الفلاتر بتاعت التاريخ وخليها زى الفلاتر
// عادى وزود ان اعمل فلتر ب اسم البنك و ان اكسيل او pdf. الlist بتاعت جمالى العملات اللى على الشمال دى
// عاوز حجمها يكون بطول الشاشة كامله»: «من» / «إلى» in the boards' one bar beside «اسم البنك» (`?name=`,
// applied as typed, Arabic folded — `reportView`); «Excel | PDF» at the bar's end, carrying the rows
// shown, their «الإجمالي» and the panel (a second sheet, a second printed page); the panel as tall
// as the screen. With a bank's name typed, «الإجمالي» and the panel are the shown banks' own — each
// bank is one row, so nothing is counted twice; with none, the server's grand total as before. The
// name is remembered across visits, as the boards' filters are; the period opens on the month.
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useOperationsBanks, useVaultReport } from '../api/operations-queries';
import { ReportBoard } from '../components/ReportBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import { VaultValuePanel } from '../components/VaultValuePanel';
import { bankRank, reportRowsInOrder, reportView, type ReportBoardRow } from '../lib/report-board';
import { reportExportSubtitle } from '../lib/report-export';
import { isRangeValid, rangeFromParams } from '../lib/report-range';

/** Remembered across visits: the name filter — NOT the period, which opens on the current month. */
const REMEMBERED_FILTERS = ['name'] as const;

export const VaultReportPage = (): JSX.Element => {
  const t = useT();
  const search = useSearchParams();
  const [sp, setSp] = search;
  // «ويجيب البداية كل اول شهر»: an empty URL is the current month, both days inclusive.
  const range = rangeFromParams({ from: sp.get('from'), to: sp.get('to') }, new Date());
  // An inverted range is refused here, in words, rather than sent (`isRangeValid`).
  const valid = isRangeValid(range);
  const name = sp.get('name') ?? '';

  const report = useVaultReport(range, valid);
  // The boards' own query (the same parameters), so the catalog is one cache across them.
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });

  useRememberedFilters(search, REMEMBERED_FILTERS);

  // Applied as it is chosen, as the boards apply a filter. Emptied, a bound goes back to its
  // default — the first or the last day of the current month (`rangeFromParams`, per field).
  const setBound = (param: 'from' | 'to', value: string): void => {
    const next = new URLSearchParams(sp);
    if (value === '') next.delete(param);
    else next.set(param, value);
    setSp(next);
  };
  // Typed, a name narrows the table at once — a view of the same report, not a place to go Back to.
  const setName = (value: string): void => {
    const next = new URLSearchParams(sp);
    if (value === '') next.delete('name');
    else next.set('name', value);
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
  // The rows the name leaves, and «الإجمالي» under them — the server's, or theirs with a name typed.
  // The panel reads the SAME total, so it always says what the table says.
  const view = reportView(
    valid ? rows : [],
    valid ? report.data?.grandTotal : undefined,
    name,
    t('operations.reports.unattributed'),
  );

  return (
    <PageContainer fullHeight>
      <ReportBoard
        label={t('operations.vaultReport.title')}
        title={t('operations.vaultReport.table')}
        titleIcon={SHIPMENT_PATH.bank}
        keyHeader={t('operations.reports.bank')}
        countHeader={t('operations.vaultReport.securedCount')}
        rows={view.rows}
        total={view.total}
        loading={valid && report.isLoading}
        error={report.error}
        onRetry={() => void report.refetch()}
        empty={t(view.filtered ? 'operations.vaultReport.noName' : 'operations.vaultReport.empty')}
        refusal={valid ? null : t('operations.reports.invalidRange')}
        nameFilter={{
          label: t('operations.reports.bankName'),
          icon: SHIPMENT_PATH.bank,
          value: name,
          onChange: setName,
        }}
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
        filtersActive={sp.get('from') !== null || sp.get('to') !== null || name !== ''}
        onResetFilters={() => {
          // ONE write: the name and the period together, as the boards' reset clears both.
          const next = new URLSearchParams(sp);
          next.delete('from');
          next.delete('to');
          next.delete('name');
          setSp(next, { replace: true });
        }}
        exportSpec={{
          name: t('operations.vaultReport.title'),
          subtitle: reportExportSubtitle(t, {
            period: range,
            filter: { label: t('operations.reports.bankName'), value: name },
          }),
          withValuePanel: true,
        }}
        aside={
          // The table's own total — the server's, or the shown banks' — and nothing while there
          // is no total to read (a name that matched no bank).
          view.filtered && view.total === undefined ? undefined : (
            <VaultValuePanel grandTotal={view.total} loading={report.isLoading} />
          )
        }
      />
    </PageContainer>
  );
};
