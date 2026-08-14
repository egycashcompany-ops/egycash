// My payslips (PY-11) — the one payroll document an employee is entitled to without a key.
//
// It carries no `RequirePermission` on purpose. The rows are resolved from the caller's own login
// link on the server and nothing this page can send widens that, so a permission would be checking
// a reach that does not exist. That is the posture My Attendance and My Leave already have; this
// applies it to the employee's own pay.
//
// What it shows is the STORED document, exactly as it was issued: the lines with their own
// derivation, the totals, and the run behind them. Nothing here is recomputed — a payslip that
// changed after it was handed over would not be a payslip.
import { useState } from 'react';
import { type Locale, type PayslipDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, DataTable, EmptyState, Pagination, type Column } from '../../../../shared/ui';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { formatDate, formatMoney, localized } from '../../../../shared/lib/format';
import { useMyPayslips } from '../api/payroll-queries';

const PAGE_SIZE = 12;

export const MyPayslipsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<PayslipDto | null>(null);
  const slips = useMyPayslips({ page, pageSize: PAGE_SIZE, sortBy: 'period', sortDir: 'desc' });

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
          <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setOpen(s)}>
            <span className="font-mono" dir="ltr">
              {s.period}
            </span>
          </button>
          {/*
            A1 — the employee's own list spans runs too, so a recalculated month shows two. The
            payslip from the cancelled run stays visible and says so; hiding a document somebody may
            have been paid against was the option that was rejected.
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
      render: (s) => <span className="font-semibold">{money(s.net, s.currency)}</span>,
    },
  ];

  return (
    <PageContainer>
      <PageHeader title={t('payroll.payslips.mine')} description={t('payroll.payslips.mineHint')} />
      <DataTable
        columns={columns}
        rows={slips.data?.items ?? []}
        rowKey={(s) => s.id}
        loading={slips.isLoading}
        error={slips.isError ? slips.error : undefined}
        onRetry={() => void slips.refetch()}
        empty={<EmptyState title={t('payroll.payslips.mineEmpty')} />}
      />
      {slips.data !== undefined && <Pagination meta={slips.data.meta} onPageChange={setPage} />}
      {open !== null && <PayslipDetail slip={open} />}
    </PageContainer>
  );
};

/** The document itself — every line still carrying the derivation it was priced with. */
const PayslipDetail = ({ slip }: { slip: PayslipDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const lines = [...slip.earnings, ...slip.deductions];

  return (
    <Card>
      <CardHeader
        title={`${t('payroll.payslips.title')} — ${slip.period}`}
        actions={
          <span className="text-xs text-slate-400">
            {`${formatDate(slip.from, locale)} — ${formatDate(slip.to, locale)}`}
          </span>
        }
      />
      <CardBody>
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            {t('payroll.compensation.employed', {
              days: String(slip.employmentDaysInPeriod),
              of: String(slip.daysInPeriod),
            })}
          </p>

          <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
            {lines.map((line) => (
              <li key={`${line.code}:${String(line.leavePayRate ?? '')}:${line.sourceAssignmentId ?? ''}`} className="flex justify-between py-1">
                <span className="flex flex-col">
                  <span>{localized(line.name, locale)}</span>
                  <span className="text-xs text-slate-400">
                    {line.kind === 'deduction'
                      ? t('payroll.compensation.deductions')
                      : t('payroll.compensation.earnings')}
                  </span>
                </span>
                <span dir="ltr" className="tabular-nums">
                  {line.amount === null ? '—' : formatMoney(line.amount, line.currency, locale)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="space-y-1 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
            <Row label={t('payroll.compensation.totalEarnings')} value={slip.totalEarnings} currency={slip.currency} />
            <Row label={t('payroll.compensation.totalDeductions')} value={slip.totalDeductions} currency={slip.currency} />
            <Row label={t('payroll.compensation.net')} value={slip.net} currency={slip.currency} strong />
            <p className="pt-1 text-xs text-slate-400">{t('payroll.compensation.netHint')}</p>
          </dl>
        </div>
      </CardBody>
    </Card>
  );
};

const Row = ({
  label,
  value,
  currency,
  strong = false,
}: {
  label: string;
  value: number;
  currency: string;
  strong?: boolean;
}): JSX.Element => {
  const locale = useAppSelector((state): Locale => state.locale.locale);
  return (
    <div className={`flex justify-between ${strong ? 'font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd dir="ltr" className="tabular-nums">
        {formatMoney(value, currency, locale)}
      </dd>
    </div>
  );
};
