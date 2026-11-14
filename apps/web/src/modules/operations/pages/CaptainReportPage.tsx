// Captain report (B5) — the legacy `/ops_report` screen, «تقرير القادة».
//
// «وتقرير القادة الشاشة هتكون الشاشة التانية»: the legacy screen's layout — «من» / «إلى» over the
// table «بيان عدد الشحنات لكل قائد طاقم» (م | اسم القائد | عدد الشحنات | المصري | الدولار | عملات
// أخرى | الحقائب | كرتونة | صندوق, «الإجمالي» under it) — on the boards' look
// (`components/ReportBoard.tsx`).
//
// WHAT IT REPORTS (discovery §D, contad_app.js:4837-5170): completed shipments in a date range,
// grouped by the captain who ran them — daily shipments attributed by COLLECTION date, secured
// ones by DELIVERY date. The range defaults to the current month, exactly as legacy did (:4862).
//
// «عدد الشحنات», NOT legacy's «عدد المحصنات». Legacy's header said «المحصنات» over a count of
// daily AND secured shipments together (`docs_count` over both facets, :4970); the column is named
// for what it counts. «تقرير البنوك» (the vault roll-up), whose rows ARE محصنات only, keeps «عدد
// المحصنات».
//
// NUMBERS WILL DIFFER FROM THE LEGACY REPORT, deliberately and in one direction: package counts
// were multiplied by the number of currencies on each shipment (Q26), so a multi-currency
// shipment's bags were counted two or three times. Corrected server-side; totals here read lower
// and right. The other two fixes (Q27's grand total, Q28's dropped zero-currency shipments) are
// also the server's — this page renders what it is given, and adds rows up in one case only (below).
//
// ROUND 12 — «شاشة القائد بتاعت المحصنات شيل الديف اللى فيها الفلاتر بتاعت التاريخ وخليها زى الفلاتر
// عادى وزود ان اعمل فلتر ب اسم القائد و ان اكسيل او pdf»: «من» / «إلى» in the boards' one bar beside a
// text filter «اسم القائد» (`?name=`, applied as typed, Arabic folded — `reportView`), «Excel | PDF»
// at the bar's end carrying exactly the rows shown and their «الإجمالي». With no name typed that
// total is the server's grand total; with one, the shown rows' own — each captain is one row, so
// their sum counts every shipment once. The name is remembered across visits, as the boards'
// filters are; the period is not — the screen opens on the current month, as legacy's did.
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useCaptainReport } from '../api/operations-queries';
import { ReportBoard } from '../components/ReportBoard';
import { FILTER_ICON } from '../../fleet/components/FilterWithIcon';
import { reportRowsInOrder, reportView, type ReportBoardRow } from '../lib/report-board';
import { reportExportSubtitle } from '../lib/report-export';
import { isRangeValid, rangeFromParams } from '../lib/report-range';

/** Remembered across visits: the name filter — NOT the period, which opens on the current month. */
const REMEMBERED_FILTERS = ['name'] as const;

export const CaptainReportPage = (): JSX.Element => {
  const t = useT();
  const search = useSearchParams();
  const [sp, setSp] = search;
  const range = rangeFromParams({ from: sp.get('from'), to: sp.get('to') }, new Date());
  // An inverted range is refused here, in words, rather than sent (`isRangeValid`).
  const valid = isRangeValid(range);
  const name = sp.get('name') ?? '';

  const report = useCaptainReport(range, valid);

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

  // The server sorts by the captain's name; the unassigned bucket (no captain, so no name) is
  // moved from the top to the bottom, just above the total.
  const rows: ReportBoardRow[] = reportRowsInOrder(
    report.data?.rows ?? [],
    (row) => row.captainEmployeeId === null,
  ).map((row) => ({
    key: row.captainEmployeeId ?? 'unassigned',
    label: row.captainName,
    unattributed: row.captainEmployeeId === null,
    totals: row.totals,
  }));
  // The rows the name leaves, and «الإجمالي» under them — the server's, or theirs with a name typed.
  const view = reportView(
    valid ? rows : [],
    valid ? report.data?.grandTotal : undefined,
    name,
    t('operations.reports.unattributed'),
  );

  return (
    <PageContainer fullHeight>
      <ReportBoard
        label={t('operations.reports.captains.title')}
        title={t('operations.reports.captains.table')}
        titleIcon={FILTER_ICON.person}
        keyHeader={t('operations.reports.captainName')}
        countHeader={t('operations.reports.shipmentCount')}
        rows={view.rows}
        total={view.total}
        loading={valid && report.isLoading}
        error={report.error}
        onRetry={() => void report.refetch()}
        empty={t(view.filtered ? 'operations.reports.captains.noName' : 'operations.reports.empty')}
        refusal={valid ? null : t('operations.reports.invalidRange')}
        nameFilter={{
          label: t('operations.reports.captainName'),
          icon: FILTER_ICON.person,
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
          name: t('operations.reports.captains.title'),
          subtitle: reportExportSubtitle(t, {
            period: range,
            filter: { label: t('operations.reports.captainName'), value: name },
          }),
        }}
      />
    </PageContainer>
  );
};
