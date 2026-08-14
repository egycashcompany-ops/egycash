// The settlement queue (P-HR-17) — a view on the employees list, not a screen of its own.
//
// WHY IT LIVES HERE. It answers the question the employees list is already the home of — "which
// people?" — and it is gated by the compensation key, which belongs to the employee resource and
// therefore to this page. Giving it a page of its own would have meant either inventing a
// permission or re-pointing `employee.viewCompensation` away from the employee file, where
// compensation is genuinely administered. Neither was worth a route.
//
// WHAT IT SHOWS, AND WHAT IT REFUSES TO. Who has left, when, and the two facts that say their
// settlement is still open. NO AMOUNT — not the loan balance, not the final pay. Those are one
// click away on the settlement tab, behind the same key, and a list that restated them would be a
// second place for the same money to be read.
import { type Locale, type SettlementQueueRowDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Badge, DataTable, EmptyState, type Column } from '../../../../shared/ui';
import { Pagination } from '../../../../shared/ui/Pagination';
import { formatDate } from '../../../../shared/lib/format';
import { useSettlementQueue } from '../api/settlement-queries';

export const SettlementQueueTable = ({
  params,
  onOpen,
  onPageChange,
  onPageSizeChange,
}: {
  params: Record<string, string | number>;
  onOpen: (employeeId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const { data, isLoading, isError, error, refetch } = useSettlementQueue(params, true);
  const rows = data?.items ?? [];

  const columns: Column<SettlementQueueRowDto>[] = [
    {
      key: 'employeeCode',
      header: t('employees.columns.code'),
      render: (r) => (
        <span className="font-mono text-xs" dir="ltr">
          {r.employeeCode}
        </span>
      ),
    },
    { key: 'employeeName', header: t('employees.columns.name'), render: (r) => r.employeeName },
    {
      key: 'exitType',
      header: t('settlement.queue.exitType'),
      render: (r) => t(`employees.exitType.${r.exitType}`),
    },
    {
      key: 'effectiveDate',
      header: t('settlement.queue.exitDate'),
      render: (r) => formatDate(r.effectiveDate, locale),
    },
    { key: 'exitPeriod', header: t('settlement.exit.period'), render: (r) => r.exitPeriod },
    {
      // WHY this person is here, in the only two ways that differ between rows. The exit itself is
      // the third reason and is true of every row, so it is said once in the hint above the table.
      key: 'reasons',
      header: t('settlement.queue.reasons'),
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {r.hasOutstandingLoan && <Badge tone="danger">{t('settlement.queue.loanOwing')}</Badge>}
          {r.finalPeriodOpen && <Badge tone="warning">{t('settlement.queue.periodOpen')}</Badge>}
          {!r.hasOutstandingLoan && !r.finalPeriodOpen && (
            <span className="text-xs text-slate-400">{t('settlement.queue.nothingFlagged')}</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('settlement.queue.hint')}</p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.employeeId}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        onRowClick={(r) => onOpen(r.employeeId)}
        empty={<EmptyState title={t('settlement.queue.empty')} />}
      />
      {data !== undefined && data.meta.totalItems > 0 && (
        <Pagination meta={data.meta} onPageChange={onPageChange} onPageSizeChange={onPageSizeChange} />
      )}
    </div>
  );
};

export default SettlementQueueTable;
