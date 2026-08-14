// My loans (P-HR-18) — what an employee owes, and when it comes off their salary.
//
// WHY THIS SCREEN EXISTS. P-HR-07 made this feature tell the employee twice: their request was
// decided, and the money was handed over with instalments beginning in a named month. Both notices
// go to their own login — and until now there was nowhere for them to look. A notice pointing at
// nothing is worse than silence, because it says the information exists.
//
// It carries no `RequirePermission`, on purpose. The rows are resolved from the caller's own login
// link on the server and nothing this page can send widens that, so a permission would be checking
// a reach that does not exist. That is the posture My Payslips, My Attendance and My Leave already
// have; this applies it to a debt somebody is repaying out of their own pay.
//
// AND IT OFFERS NO ACTION. Requesting a loan is `employeeLoan.create` and deciding one is
// `employeeLoan.approve` — a two-person rule (D2) that this screen must not appear to shortcut. So
// there is no button here at all: it answers "what do I owe, and when?" and nothing else.
import { useState } from 'react';
import { type EmployeeLoanDetailDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, DataTable, EmptyState, Pagination, type Column } from '../../../../shared/ui';
import { Card, CardBody, CardHeader } from '../../../../shared/ui/Card';
import { formatDate, formatMoney } from '../../../../shared/lib/format';
import { useMyLoans } from '../api/employee-loans-queries';

const PAGE_SIZE = 10;

/** The same tones the HR-facing tab uses — one vocabulary, so the two screens agree on sight. */
const STATUS_TONE = {
  draft: 'neutral',
  pendingApproval: 'warning',
  approved: 'info',
  active: 'success',
  settled: 'neutral',
  cancelled: 'neutral',
  outstandingAtExit: 'danger',
} as const;

const INSTALLMENT_TONE = {
  planned: 'info',
  deducted: 'success',
  cancelled: 'neutral',
} as const;

export const MyLoansPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<EmployeeLoanDetailDto | null>(null);
  const loans = useMyLoans({ page, pageSize: PAGE_SIZE, sortBy: 'createdAt', sortDir: 'desc' });

  const money = (value: number, currency: string): JSX.Element => (
    <span dir="ltr" className="tabular-nums">
      {formatMoney(value, currency, locale)}
    </span>
  );

  const columns: Column<EmployeeLoanDetailDto>[] = [
    {
      key: 'type',
      header: t('loans.type'),
      render: (l) => (
        <button
          type="button"
          className="text-start underline-offset-2 hover:underline"
          onClick={() => setOpen(l)}
        >
          {t(`loans.type.${l.type}`)}
        </button>
      ),
    },
    {
      key: 'principal',
      header: t('loans.principal'),
      align: 'end',
      render: (l) => money(l.principal, l.currency),
    },
    {
      key: 'repaid',
      header: t('loans.repaid'),
      align: 'end',
      render: (l) => money(l.repaid, l.currency),
    },
    {
      key: 'remaining',
      header: t('loans.remaining'),
      align: 'end',
      render: (l) => money(l.remaining, l.currency),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (l) => <Badge tone={STATUS_TONE[l.status]}>{t(`loans.status.${l.status}`)}</Badge>,
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('loans.mine.title')}
        description={t('loans.mine.subtitle')}
        breadcrumbs={[{ label: t('loans.mine.title') }]}
      />

      <div className="space-y-4">
        <DataTable
          columns={columns}
          rows={loans.data?.items ?? []}
          rowKey={(l) => l.id}
          loading={loans.isLoading}
          error={loans.isError ? loans.error : undefined}
          onRetry={() => void loans.refetch()}
          empty={<EmptyState title={t('loans.mine.empty')} />}
        />
        {loans.data !== undefined && loans.data.meta.totalItems > 0 && (
          <Pagination meta={loans.data.meta} onPageChange={setPage} />
        )}

        {/*
          The schedule is the point of the screen: an employee repaying out of their salary is
          entitled to know exactly which months are affected and how much each one takes.
        */}
        {open !== null && (
          <Card>
            <CardHeader
              title={t('loans.mine.schedule', { type: t(`loans.type.${open.type}`) })}
              description={t('loans.mine.scheduleHint')}
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
              {open.installments.length === 0 ? (
                <EmptyState title={t('loans.noSchedule')} />
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {open.installments.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="font-mono" dir="ltr">
                        {i.period}
                      </span>
                      {money(i.amount, open.currency)}
                      <Badge tone={INSTALLMENT_TONE[i.status]}>
                        {t(`loans.installment.${i.status}`)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
              {open.disbursedAt !== null && (
                <p className="mt-3 text-xs text-slate-500">
                  {t('loans.mine.disbursedOn', { date: formatDate(open.disbursedAt, locale) })}
                </p>
              )}
            </CardBody>
          </Card>
        )}
      </div>
    </PageContainer>
  );
};

export default MyLoansPage;
