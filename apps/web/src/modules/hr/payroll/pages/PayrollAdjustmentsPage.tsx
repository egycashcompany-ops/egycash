// The payroll adjustments queue (P-HR-06) — the administrative half of P-HR-04.
//
// WHY THIS SCREEN EXISTS. P-HR-04 shipped the whole decision: two permissions, a two-person rule,
// and an organization-wide endpoint at `GET /hr/payroll/adjustments`. What it did not ship was
// anywhere to stand and use them. The only surface was a tab on ONE employee's profile, so an
// approver holding `payrollAdjustment.approve` could act on a bonus only by already knowing whose
// bonus it was and opening their file. A queue is the shape that question actually has: "what is
// waiting for me?", asked of everybody at once. The endpoint had no caller until this file.
//
// NOTHING NEW BEHIND IT. No API, no permission, no setting, no event, no rule about money. The
// queue tab is that same endpoint asked with `status=pendingApproval`, and the decision it posts
// is the same nested endpoint the profile tab posts to — the employee comes from the row.
//
// WHAT IT DELIBERATELY CANNOT DO. It does not record an adjustment: creating one belongs on the
// employee's file, where the currency and the person are already known. This screen decides, and
// the server still refuses a decision from whoever submitted it, whatever key they hold (D1).
import { useState } from 'react';
import {
  type Locale,
  type PayrollAdjustmentDto,
  PAYROLL_ADJUSTMENT_KINDS,
  PAYROLL_ADJUSTMENT_STATUSES,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { Badge, Button, DataTable, EmptyState, Pagination, type Column } from '../../../../shared/ui';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatMoney, localized } from '../../../../shared/lib/format';
import { useAdjustments, useDecideAdjustmentFromQueue } from '../api/payroll-queries';

const PAGE_SIZE = 25;

const TABS = ['queue', 'all'] as const;
type Tab = (typeof TABS)[number];

const STATUS_TONE = {
  draft: 'neutral',
  pendingApproval: 'warning',
  approved: 'success',
  cancelled: 'neutral',
} as const;

export const PayrollAdjustmentsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [tab, setTab] = useState<Tab>('queue');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [period, setPeriod] = useState('');
  const [page, setPage] = useState(1);

  const canApprove = can('payrollAdjustment.approve');
  const decide = useDecideAdjustmentFromQueue();

  // The queue is one filter, fixed: what is waiting for a decision. It is not the `all` tab with a
  // preselected dropdown, because a dropdown can be changed and a worklist should not drift.
  const queue = useAdjustments(
    { page, pageSize: PAGE_SIZE, status: 'pendingApproval', sortBy: 'period', sortDir: 'desc' },
    tab === 'queue',
  );
  const all = useAdjustments(
    {
      page,
      pageSize: PAGE_SIZE,
      sortBy: 'period',
      sortDir: 'desc',
      ...(status === '' ? {} : { status }),
      ...(kind === '' ? {} : { kind }),
      ...(period === '' ? {} : { period }),
    },
    tab === 'all',
  );

  const shown = tab === 'queue' ? queue : all;

  const onDecide = (row: PayrollAdjustmentDto, decision: 'approved' | 'rejected'): void => {
    decide.mutate(
      { employeeId: row.employeeId, id: row.id, body: { decision, version: row.version } },
      { onSuccess: () => toast.success(t(`payroll.adjustments.${decision}`)) },
    );
  };

  const columns: Column<PayrollAdjustmentDto>[] = [
    {
      key: 'employee',
      header: t('payroll.adjustments.employee'),
      // Enriched by the server on this read only (D7). Absent labels fall back to nothing rather
      // than to an id: an id is not an answer to "whose bonus is this?".
      render: (r) => (
        <span className="flex flex-col">
          <span>{r.employeeName ?? '—'}</span>
          <span className="font-mono text-xs text-slate-400" dir="ltr">
            {r.employeeCode ?? ''}
          </span>
        </span>
      ),
    },
    {
      key: 'period',
      header: t('payroll.adjustments.period'),
      render: (r) => (
        <span className="font-mono" dir="ltr">
          {r.period}
        </span>
      ),
    },
    {
      key: 'kind',
      header: t('payroll.adjustments.kind'),
      render: (r) => t(`payroll.adjustments.kind.${r.kind}`),
    },
    {
      key: 'amount',
      header: t('payroll.adjustments.amount'),
      align: 'end',
      render: (r) => (
        <span dir="ltr" className="tabular-nums">
          {formatMoney(r.amount, r.currency, locale)}
        </span>
      ),
    },
    {
      key: 'item',
      header: t('payroll.adjustments.item'),
      // D4 — the catalog item lends its name when one was chosen; otherwise the reason speaks.
      render: (r) => (r.payItem === null ? r.reason : localized(r.payItem.name, locale)),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => (
        <Badge tone={STATUS_TONE[r.status]}>{t(`payroll.adjustments.status.${r.status}`)}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'pendingApproval' && canApprove ? (
          <span className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={decide.isPending}
              onClick={() => onDecide(r, 'approved')}
            >
              {t('payroll.adjustments.approve')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={decide.isPending}
              onClick={() => onDecide(r, 'rejected')}
            >
              {t('payroll.adjustments.reject')}
            </Button>
          </span>
        ) : (
          <span className="text-slate-300">—</span>
        ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('payroll.adjustments.queueTitle')}
        description={t('payroll.adjustments.queueSubtitle')}
        breadcrumbs={[
          { label: t('payroll.module.title') },
          { label: t('payroll.adjustments.queueTitle') },
        ]}
      />

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
      >
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              tab === key
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(`payroll.adjustments.tab.${key}`)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {tab === 'all' && (
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('common.status')}>
              <Select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                aria-label={t('common.status')}
              >
                <option value="">{t('payroll.adjustments.allStatuses')}</option>
                {PAYROLL_ADJUSTMENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`payroll.adjustments.status.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('payroll.adjustments.kind')}>
              <Select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setPage(1);
                }}
                aria-label={t('payroll.adjustments.kind')}
              >
                <option value="">{t('payroll.adjustments.allKinds')}</option>
                {PAYROLL_ADJUSTMENT_KINDS.map((value) => (
                  <option key={value} value={value}>
                    {t(`payroll.adjustments.kind.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('payroll.adjustments.period')}>
              <Input
                type="month"
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setPage(1);
                }}
                aria-label={t('payroll.adjustments.period')}
              />
            </Field>
          </div>
        )}

        <DataTable
          columns={columns}
          rows={shown.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={shown.isLoading}
          error={shown.isError ? shown.error : undefined}
          onRetry={() => void shown.refetch()}
          empty={
            <EmptyState
              title={
                tab === 'queue' ? t('payroll.adjustments.queueEmpty') : t('payroll.adjustments.empty')
              }
            />
          }
        />
        {shown.data !== undefined && <Pagination meta={shown.data.meta} onPageChange={setPage} />}

        {decide.error !== null && decide.error !== undefined && (
          <p role="alert" className="text-sm text-red-600">
            {(decide.error as Error).message}
          </p>
        )}
      </div>
    </PageContainer>
  );
};
