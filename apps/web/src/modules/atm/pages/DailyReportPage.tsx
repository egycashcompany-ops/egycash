// /atm/reports/daily — the legacy /reports_atm screen (views/events/reports_atm.ejs) by parity:
// one row per bank, for each operation kind, showing STILL OPEN over TOTAL opened that day. The
// legacy painted the open count red and the total green and hard-coded a block per bank name
// (:296-420); the counts are the same numbers, rendered as a table that needs no edit when a bank
// is added. The day is a parameter here (port doc D7) — the legacy could only show today — and
// since 2026-11-02 a PERIOD, «من … إلى …», today by default: «فى تقرير اليوم بقي عايز كمان تسمح
// بإنى أختار فترة من إلى .. بس الـ Default يكون اليوم». The done pages' two fields and their
// ladder (`doneRange`): one bound serves as both, a «إلى» before the «من» reads the days between.
// A link from before the period (`?date=`) still opens on its day.
//
// A ROW OF FILTER LISTS under each table's head, one multi-pick drop-down per column (2026-11-02,
// «فلتر لكل عمود», «يكون Drop Down بـ Multi select»). The totals line under a table adds up the
// rows the lists KEEP — the banks on screen — so it never
// states a sum of rows the reader cannot see.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmBankCountsDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import {
  columnFilterChoicesOf,
  filterRowsByColumns,
  type ColumnFilterValues,
} from '../../../shared/lib/column-filter';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { useColumnFilters } from '../../../shared/ui/useColumnFilters';
import { useAtmDailyReport } from '../api/atm-queries';
import { DoneRangeBar } from '../components/DoneRangeBar';
import { cairoToday, doneRange } from '../lib/operation-view';

/** Legacy footer arithmetic: the report's own totals across banks. */
export const sumBankCounts = (rows: readonly AtmBankCountsDto[]): { total: number; open: number } =>
  rows.reduce((acc, row) => ({ total: acc.total + row.total, open: acc.open + row.open }), {
    total: 0,
    open: 0,
  });

/** Pure: what a bank's cell in that column shows — the name, or the count as it is written. */
export const bankCountsText = (row: AtmBankCountsDto, key: string): string | null =>
  key === 'bank'
    ? row.bankName
    : key === 'open'
      ? String(row.open)
      : key === 'total'
        ? String(row.total)
        : null;

/** Pure: the banks every column filter keeps, and the totals line's sums over exactly those. */
export const shownBankCounts = (
  rows: readonly AtmBankCountsDto[],
  values: ColumnFilterValues,
): { rows: AtmBankCountsDto[]; totals: { total: number; open: number } } => {
  const kept = filterRowsByColumns(rows, values, bankCountsText);
  return { rows: kept, totals: sumBankCounts(kept) };
};

const CountsTable = ({
  title,
  rows,
  loading,
  error,
  onRetry,
  emptyLabel,
}: {
  title: string;
  rows: AtmBankCountsDto[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  emptyLabel: string;
}): JSX.Element => {
  const t = useT();
  // This table's own column filters: each table of the page narrows its own banks.
  const columnFilters = useColumnFilters();
  const shown = useMemo(
    () => shownBankCounts(rows, columnFilters.values),
    [rows, columnFilters.values],
  );
  const totals = shown.totals;

  const columns: Column<AtmBankCountsDto>[] = [
    {
      key: 'bank',
      header: t('atm.common.bank'),
      render: (row) => row.bankName,
      filterable: true,
    },
    {
      key: 'open',
      header: t('atm.reports.open'),
      align: 'center',
      // The legacy's red: the number that still needs somebody.
      render: (row) => (
        <span className="font-semibold text-red-600 dark:text-red-400">{row.open}</span>
      ),
      filterable: true,
    },
    {
      key: 'total',
      header: t('atm.reports.total'),
      align: 'center',
      render: (row) => (
        <span className="font-semibold text-green-700 dark:text-green-400">{row.total}</span>
      ),
      filterable: true,
    },
  ];

  return (
    // A column of the board: on a computer it takes the grid's height, and its own table scrolls
    // inside it under a head that stays — the title above and the totals line below keep their
    // place.
    <section className="lg:flex lg:min-h-0 lg:flex-col">
      <h2 className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      <div className={BOARD_TABLE_FILL}>
        <DataTable
          steadyColumns
          columns={columns}
          rows={shown.rows}
          rowKey={(row) => row.bankName}
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty={
            columnFilters.active && rows.length > 0
              ? t('atm.common.emptyColumnFiltered')
              : emptyLabel
          }
          columnFilters={{
            values: columnFilters.values,
            onChange: columnFilters.set,
            choices: columnFilterChoicesOf(rows, columnFilters.values, bankCountsText),
            generation: columnFilters.generation,
            label: (header) => t('atm.common.filterColumn', { column: header }),
          }}
          stickyHead
        />
      </div>
      {shown.rows.length > 0 && (
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {t('atm.reports.totalsLine', { open: totals.open, total: totals.total })}
        </p>
      )}
    </section>
  );
};

export const DailyReportPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  // A `?date=` link from before the period is its own one-day period.
  const day = sp.get('date');
  const { from, to } = doneRange(sp.get('from') ?? day, sp.get('to') ?? day, cairoToday());
  const report = useAtmDailyReport(useMemo(() => ({ from, to }), [from, to]));
  const emptyLabel = t(from === to ? 'atm.reports.empty' : 'atm.reports.emptyPeriod');

  const setRange = (next: { from: string; to: string }): void => {
    const params = new URLSearchParams(sp);
    params.delete('date');
    params.set('from', next.from);
    params.set('to', next.to);
    setSp(params);
  };

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-10-27 «تثبت الفورم والفلتر وتخلي الجدول
          بس هو اللى يعمل Scroll»): on a computer the title and the period keep their place, and the two
          tables side by side take the height that is left — each column scrolls its own rows. */}
      <div className={BOARD_FRAME}>
        {/* The period on the title's line (2026-11-02, «عايز تطلع الصف بتاع الـ Form يبقي بجانب
          العنوان عشان نستفيد بالمساحة»): the two tables get that row's height back. */}
        <PageHeader
          title={t('atm.reports.title')}
          toolbar={
            <div data-report-toolbar="true">
              <DoneRangeBar from={from} to={to} onChange={setRange} />
            </div>
          }
        />
        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-1">
          <CountsTable
            title={t('atm.reports.replenishments')}
            rows={report.data?.replenishments ?? []}
            loading={report.isLoading}
            error={report.error}
            onRetry={() => void report.refetch()}
            emptyLabel={emptyLabel}
          />
          <CountsTable
            title={t('atm.reports.maintenance')}
            rows={report.data?.maintenances ?? []}
            loading={report.isLoading}
            error={report.error}
            onRetry={() => void report.refetch()}
            emptyLabel={emptyLabel}
          />
        </div>
      </div>
    </PageContainer>
  );
};
