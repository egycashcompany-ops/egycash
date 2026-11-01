// /atm/reports/daily — the legacy /reports_atm screen (views/events/reports_atm.ejs) by parity:
// one row per bank, for each operation kind, showing STILL OPEN over TOTAL opened that day. The
// legacy painted the open count red and the total green and hard-coded a block per bank name
// (:296-420); the counts are the same numbers, rendered as a table that needs no edit when a bank
// is added. The day is a parameter here (port doc D7) — the legacy could only show today.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type AtmBankCountsDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { Field, Input } from '../../../shared/ui/form';
import { useAtmDailyReport } from '../api/atm-queries';
import { cairoToday } from '../lib/operation-view';

/** Legacy footer arithmetic: the report's own totals across banks. */
export const sumBankCounts = (rows: readonly AtmBankCountsDto[]): { total: number; open: number } =>
  rows.reduce((acc, row) => ({ total: acc.total + row.total, open: acc.open + row.open }), {
    total: 0,
    open: 0,
  });

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
  const totals = sumBankCounts(rows);

  const columns: Column<AtmBankCountsDto>[] = [
    { key: 'bank', header: t('atm.common.bank'), render: (row) => row.bankName },
    {
      key: 'open',
      header: t('atm.reports.open'),
      align: 'center',
      // The legacy's red: the number that still needs somebody.
      render: (row) => (
        <span className="font-semibold text-red-600 dark:text-red-400">{row.open}</span>
      ),
    },
    {
      key: 'total',
      header: t('atm.reports.total'),
      align: 'center',
      render: (row) => (
        <span className="font-semibold text-green-700 dark:text-green-400">{row.total}</span>
      ),
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
          columns={columns}
          rows={rows}
          rowKey={(row) => row.bankName}
          loading={loading}
          error={error}
          onRetry={onRetry}
          empty={emptyLabel}
          stickyHead
        />
      </div>
      {rows.length > 0 && (
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
  const date = sp.get('date') ?? cairoToday();
  const report = useAtmDailyReport(useMemo(() => date, [date]));

  const setDate = (next: string): void => {
    const params = new URLSearchParams(sp);
    if (next === '') params.delete('date');
    else params.set('date', next);
    setSp(params);
  };

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`, 2026-10-27 «تثبت الفورم والفلتر وتخلي الجدول
          بس هو اللى يعمل Scroll»): on a computer the title and the day keep their place, and the two
          tables side by side take the height that is left — each column scrolls its own rows. */}
      <div className={BOARD_FRAME}>
        <PageHeader title={t('atm.reports.title')} />
        <div className="max-w-xs">
          <Field label={t('atm.reports.day')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-2 lg:grid-rows-1">
          <CountsTable
            title={t('atm.reports.replenishments')}
            rows={report.data?.replenishments ?? []}
            loading={report.isLoading}
            error={report.error}
            onRetry={() => void report.refetch()}
            emptyLabel={t('atm.reports.empty')}
          />
          <CountsTable
            title={t('atm.reports.maintenance')}
            rows={report.data?.maintenances ?? []}
            loading={report.isLoading}
            error={report.error}
            onRetry={() => void report.refetch()}
            emptyLabel={t('atm.reports.empty')}
          />
        </div>
      </div>
    </PageContainer>
  );
};
