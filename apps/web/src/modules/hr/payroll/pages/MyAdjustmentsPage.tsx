// My adjustments (P-HR-19) — the bonuses and penalties recorded about me, and where each stands.
//
// WHY THIS SCREEN EXISTS. P-HR-07's decision notice addresses the employee's own login: "the
// adjustment for {{period}} is now: approved". Until now that pointed at nothing — the adjustments
// tab is on the HR-facing profile behind `payrollAdjustment.view`, and the payslip only shows the
// line once the month's run has issued it. Between the decision and the payslip there was a window
// where somebody had been told about their own money and could see none of it.
//
// It carries no `RequirePermission`: the rows are resolved from the caller's own login link on the
// server, so a key would gate a reach that does not exist — the posture My Payslips and My Loans
// already have.
//
// DRAFTS NEVER ARRIVE HERE. The server excludes them, because a draft is the recorder's private
// working note; showing somebody a penalty nobody has decided to apply would be telling them about
// a decision that has not been taken. The screen says so rather than leaving the absence to be
// discovered.
import { type Locale, type PayrollAdjustmentDto } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { useState } from 'react';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, DataTable, EmptyState, Pagination, type Column } from '../../../../shared/ui';
import { formatDate, formatMoney } from '../../../../shared/lib/format';
import { useMyAdjustments } from '../api/payroll-queries';

const PAGE_SIZE = 12;

/** The same tones the HR-facing queue uses, so the two screens agree on sight. */
const STATUS_TONE = {
  draft: 'neutral',
  pendingApproval: 'warning',
  approved: 'success',
  cancelled: 'neutral',
} as const;

export const MyAdjustmentsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [page, setPage] = useState(1);
  const rows = useMyAdjustments({ page, pageSize: PAGE_SIZE, sortBy: 'period', sortDir: 'desc' });

  const columns: Column<PayrollAdjustmentDto>[] = [
    {
      key: 'period',
      header: t('payroll.adjustments.period'),
      render: (a) => (
        <span className="font-mono" dir="ltr">
          {a.period}
        </span>
      ),
    },
    {
      key: 'kind',
      header: t('payroll.adjustments.kind'),
      render: (a) => t(`payroll.adjustments.kind.${a.kind}`),
    },
    {
      key: 'amount',
      header: t('payroll.adjustments.amount'),
      align: 'end',
      render: (a) => (
        <span dir="ltr" className="tabular-nums">
          {formatMoney(a.amount, a.currency, locale)}
        </span>
      ),
    },
    { key: 'reason', header: t('payroll.adjustments.reason'), render: (a) => a.reason },
    {
      key: 'status',
      header: t('common.status'),
      render: (a) => (
        <Badge tone={STATUS_TONE[a.status]}>{t(`payroll.adjustments.status.${a.status}`)}</Badge>
      ),
    },
    {
      key: 'decidedAt',
      header: t('payroll.adjustments.decidedAt'),
      render: (a) => (a.decidedAt === null ? '—' : formatDate(a.decidedAt, locale)),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('payroll.adjustments.mine.title')}
        description={t('payroll.adjustments.mine.subtitle')}
        breadcrumbs={[{ label: t('payroll.adjustments.mine.title') }]}
      />

      <div className="space-y-4">
        {/*
          Said out loud rather than left to be noticed: an amount still being written is not yet a
          decision about this person, so it is not theirs to see.
        */}
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('payroll.adjustments.mine.hint')}
        </p>
        <DataTable
          columns={columns}
          rows={rows.data?.items ?? []}
          rowKey={(a) => a.id}
          loading={rows.isLoading}
          error={rows.isError ? rows.error : undefined}
          onRetry={() => void rows.refetch()}
          empty={<EmptyState title={t('payroll.adjustments.mine.empty')} />}
        />
        {rows.data !== undefined && rows.data.meta.totalItems > 0 && (
          <Pagination meta={rows.data.meta} onPageChange={setPage} />
        )}
      </div>
    </PageContainer>
  );
};

export default MyAdjustmentsPage;
