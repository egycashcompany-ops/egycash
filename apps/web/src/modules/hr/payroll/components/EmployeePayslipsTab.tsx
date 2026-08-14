// The employee profile's Payslips tab (P-HR-20) — default export, lazy-loaded like every additive
// tab.
//
// WHY IT EXISTS. `ListPayslipsQuery` has carried an `employeeId` filter since PY-7, and the only
// list that applied it was the RUN's — where an employee has at most one payslip, so the filter
// answered nothing worth asking. The profile showed this person's pay items, their adjustments,
// their loans and, for a leaver, their settlement, but never the documents themselves: what they
// were actually paid, month after month.
//
// It shows the STORED document and recomputes nothing. A payslip is a deliberate copy of what
// somebody was paid; a screen that recalculated it could disagree with the paper the employee was
// handed, and then neither would be authoritative.
import { useState } from 'react';
import { type EmployeeDto, type Locale, type PayslipDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { Badge, DataTable, EmptyState, Pagination, type Column } from '../../../../shared/ui';
import { formatDate, formatMoney } from '../../../../shared/lib/format';
import { useEmployeePayslips } from '../api/payroll-queries';

const PAGE_SIZE = 12;

const EmployeePayslipsTab = ({ employee }: { employee: EmployeeDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<PayslipDto | null>(null);
  const slips = useEmployeePayslips(employee.id, {
    page,
    pageSize: PAGE_SIZE,
    sortBy: 'period',
    sortDir: 'desc',
  });

  const money = (value: number, currency: string): JSX.Element => (
    <span dir="ltr" className="tabular-nums">
      {formatMoney(value, currency, locale)}
    </span>
  );

  const columns: Column<PayslipDto>[] = [
    {
      key: 'period',
      header: t('payroll.payslips.period'),
      render: (s) => (
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="text-start underline-offset-2 hover:underline"
            onClick={() => setOpen(s)}
          >
            <span className="font-mono" dir="ltr">
              {s.period}
            </span>
          </button>
          {/*
            A1 — this list spans runs, so a recalculated month shows two payslips. The one from the
            cancelled run is MARKED rather than hidden: it is still a document somebody may have
            been paid against, and the label is the run's own word for its state, not a new one.
          */}
          {s.runStatus === 'cancelled' && (
            <span title={t('payroll.payslips.fromCancelledRun')}>
              <Badge tone="warning" size="sm">
                {t('payroll.runs.status.cancelled')}
              </Badge>
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'earnings',
      header: t('payroll.compensation.totalEarnings'),
      align: 'end',
      render: (s) => money(s.totalEarnings, s.currency),
    },
    {
      key: 'deductions',
      header: t('payroll.compensation.totalDeductions'),
      align: 'end',
      render: (s) => money(s.totalDeductions, s.currency),
    },
    {
      key: 'net',
      header: t('payroll.compensation.net'),
      align: 'end',
      render: (s) => money(s.net, s.currency),
    },
    {
      key: 'issued',
      header: t('payroll.payslips.issuedAt'),
      render: (s) => formatDate(s.createdAt, locale),
    },
  ];

  return (
    <div className="space-y-4">
      <DataTable
        columns={columns}
        rows={slips.data?.items ?? []}
        rowKey={(s) => s.id}
        loading={slips.isLoading}
        error={slips.isError ? slips.error : undefined}
        onRetry={() => void slips.refetch()}
        empty={<EmptyState title={t('payroll.payslips.noneForEmployee')} />}
      />
      {slips.data !== undefined && slips.data.meta.totalItems > 0 && (
        <Pagination meta={slips.data.meta} onPageChange={setPage} />
      )}

      {/* The lines as they were issued — each one carrying its own derivation, none recomputed. */}
      {open !== null && (
        <Card>
          <CardHeader
            title={t('payroll.payslips.forPeriod', { period: open.period })}
            description={t('payroll.payslips.hint')}
            actions={
              <button
                type="button"
                className="text-xs text-slate-500 underline-offset-2 hover:underline"
                onClick={() => setOpen(null)}
              >
                {t('common.close')}
              </button>
            }
          />
          <CardBody>
            <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
              {[...open.earnings, ...open.deductions].map((line) => (
                <li
                  key={`${line.origin}-${line.code}-${line.kind}`}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span>{line.name[locale === 'ar' ? 'ar' : 'en']}</span>
                  {/*
                    A pending line has no figure yet, and says so rather than showing a zero —
                    PY-5's rule, kept here because a zero is an answer and "not known" is not.
                  */}
                  {line.amount === null ? (
                    <span className="text-xs text-slate-400">{t('payroll.compensation.pending')}</span>
                  ) : (
                    money(line.amount, open.currency)
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
};

export default EmployeePayslipsTab;
