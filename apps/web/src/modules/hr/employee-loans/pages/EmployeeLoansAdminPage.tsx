// Employee loans administration (P-HR-06-B) — the organization-wide half of P-HR-05.
//
// WHY THIS SCREEN EXISTS. Phase A shipped the whole obligation: a request, a second person's
// decision, a disbursement that creates the schedule, and instalments a payslip takes. What it did
// not ship was anywhere to stand and administer it. The only surface was a tab on ONE employee's
// profile, and `GET /hr/employee-loans` — the organization-wide read — had no caller at all. So
// somebody holding `employeeLoan.approve` could act on a request only by already knowing whose
// request it was. `employeeLoan.*` was even declared with `pageId: null`, which said out loud that
// there was no administration screen; this file is what makes that null wrong, and it is now set.
//
// THE THREE TABS ARE THE TWO THINGS AN APPROVER OWES, PLUS THE ARCHIVE. A loan waiting for a
// decision is obvious. A loan in `approved` is the one worth naming: phase A's design says
// `approved` is the MIDDLE of this machine, not its end — the obligation begins at disbursement —
// so a row sitting there is money promised and not yet handed over, and nothing anywhere told
// anybody it was waiting.
//
// WHAT IT DELIBERATELY CANNOT DO, AND WHY. It does not record a loan, reschedule one, accelerate
// one, settle one or cancel one. Every one of those acts is about a SCHEDULE, and this list does
// not carry schedules — the organization-wide read returns the loan without its instalments, on
// purpose. Offering to reshape a plan the screen cannot show would be an invitation to guess. Each
// row links to the employee's file, where the schedule is, and that is where those acts stay.
//
// NOTHING NEW BEHIND IT: no API, no permission, no setting, no event, no rule about money.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import {
  type EmployeeLoanDto,
  type Locale,
  EMPLOYEE_LOAN_STATUSES,
  EMPLOYEE_LOAN_TYPES,
} from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { useAppSelector } from '../../../../store';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Pagination,
  type Column,
} from '../../../../shared/ui';
import { Dialog } from '../../../../shared/ui/Dialog';
import { Field, Input, Select } from '../../../../shared/ui/form';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatMoney } from '../../../../shared/lib/format';
import {
  useAllLoans,
  useDecideLoanFromList,
  useDisburseLoanFromList,
} from '../api/employee-loans-queries';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['status', 'type'] as const;

const PAGE_SIZE = 25;

const TABS = ['queue', 'toDisburse', 'all'] as const;
type Tab = (typeof TABS)[number];

const isTab = (value: string | null): value is Tab => TABS.includes(value as Tab);

/** Each worklist tab is ONE status, fixed — a dropdown can be changed and a worklist should not. */
const TAB_STATUS: Record<Tab, string> = {
  queue: 'pendingApproval',
  toDisburse: 'approved',
  all: '',
};

const STATUS_TONE = {
  draft: 'neutral',
  pendingApproval: 'warning',
  approved: 'info',
  active: 'success',
  settled: 'neutral',
  cancelled: 'neutral',
  // Not a failure and not an error — a fact somebody has to act on outside this system (D8).
  outstandingAtExit: 'danger',
} as const;

export const EmployeeLoansAdminPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  // The filters live in the URL so the screen is shareable and survives a reload — and so the
  // remembered-filters hook has something to remember. Written with `replace`, because narrowing a
  // list is a view of this screen rather than a place to go Back to.
  //
  // The tab is in the URL too, and is the SCOPE rather than a filter: `status` and `type` narrow
  // the ARCHIVE tab and are rendered only there.
  // Held locally it would reset to the default on every visit while the filters came back, so a
  // reader would return to a tab wearing another tab's narrowing, with no control to clear it.
  const [sp, setSp] = useSearchParams();
  const tabParam = sp.get('tab');
  const tab: Tab = isTab(tabParam) ? tabParam : 'queue';
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS, '', tab);
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(name);
      else next.set(name, value);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next, { replace: true });
  };

  const setTab = (value: Tab): void => patch({ tab: value === 'queue' ? null : value });
  const status = sp.get('status') ?? '';
  const setStatus = (value: string): void => patch({ status: value });
  const type = sp.get('type') ?? '';
  const setType = (value: string): void => patch({ type: value });
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const setPage = (next: number): void => patch({ page: next <= 1 ? null : String(next) }, false);
  const [disbursing, setDisbursing] = useState<EmployeeLoanDto | null>(null);

  const canApprove = can('employeeLoan.approve');
  const decide = useDecideLoanFromList();

  const rows = useAllLoans({
    page,
    pageSize: PAGE_SIZE,
    sortBy: 'createdAt',
    sortDir: 'desc',
    ...(tab === 'all'
      ? {
          ...(status === '' ? {} : { status }),
          ...(type === '' ? {} : { type }),
        }
      : { status: TAB_STATUS[tab] }),
  });

  const onDecide = (loan: EmployeeLoanDto, decision: 'approved' | 'rejected'): void => {
    decide.mutate(
      {
        employeeId: loan.employeeId,
        id: loan.id,
        body: { decision, version: loan.version },
      },
      { onSuccess: () => toast.success(t(`loans.${decision}`)) },
    );
  };

  const columns: Column<EmployeeLoanDto>[] = [
    {
      key: 'employee',
      header: t('loans.employee'),
      // Enriched by the server on this read only (P-HR-06-A / D7), and never stored on the loan.
      // The link is the whole answer to what this screen cannot do: the schedule is one click away.
      render: (r) => (
        <Link to={`/employees/${r.employeeId}`} className="flex flex-col hover:underline">
          <span>{r.employeeName ?? '—'}</span>
          <span className="font-mono text-xs text-slate-400" dir="ltr">
            {r.employeeCode ?? ''}
          </span>
        </Link>
      ),
    },
    { key: 'type', header: t('loans.type'), render: (r) => t(`loans.type.${r.type}`) },
    {
      key: 'principal',
      header: t('loans.principal'),
      align: 'end',
      render: (r) => (
        <span dir="ltr" className="tabular-nums">
          {formatMoney(r.principal, r.currency, locale)}
        </span>
      ),
    },
    {
      // Both derived from the ledger, neither stored — so a list read is never a stale balance.
      key: 'remaining',
      header: t('loans.remaining'),
      align: 'end',
      render: (r) => (
        <span className="flex flex-col items-end">
          <span dir="ltr" className="tabular-nums font-semibold">
            {formatMoney(r.remaining, r.currency, locale)}
          </span>
          <span dir="ltr" className="tabular-nums text-xs text-slate-400">
            {`${t('loans.repaid')}: ${formatMoney(r.repaid, r.currency, locale)}`}
          </span>
        </span>
      ),
    },
    {
      key: 'schedule',
      header: t('loans.installmentCount'),
      render: (r) => (
        <span dir="ltr" className="font-mono text-xs">
          {`${String(r.installmentCount)} × ${r.firstPeriod}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('common.status'),
      render: (r) => <Badge tone={STATUS_TONE[r.status]}>{t(`loans.status.${r.status}`)}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (r) => {
        if (!canApprove) return <span className="text-slate-300">—</span>;
        if (r.status === 'pendingApproval') {
          return (
            <span className="flex gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={decide.isPending}
                onClick={() => onDecide(r, 'approved')}
              >
                {t('loans.approve')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={decide.isPending}
                onClick={() => onDecide(r, 'rejected')}
              >
                {t('loans.reject')}
              </Button>
            </span>
          );
        }
        if (r.status === 'approved') {
          return (
            <Button size="sm" onClick={() => setDisbursing(r)}>
              {t('loans.disburse')}
            </Button>
          );
        }
        return <span className="text-slate-300">—</span>;
      },
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('loans.admin.title')}
        description={t('loans.admin.subtitle')}
        breadcrumbs={[{ label: t('payroll.module.title') }, { label: t('loans.admin.title') }]}
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
            {t(`loans.admin.tab.${key}`)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {tab === 'all' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('common.status')}>
              <Select
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                aria-label={t('common.status')}
              >
                <option value="">{t('loans.allStatuses')}</option>
                {EMPLOYEE_LOAN_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`loans.status.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('loans.type')}>
              <Select
                value={type}
                onChange={(e) => {
                  setType(e.target.value);
                  setPage(1);
                }}
                aria-label={t('loans.type')}
              >
                <option value="">{t('loans.allTypes')}</option>
                {EMPLOYEE_LOAN_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {t(`loans.type.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}

        <DataTable
          columns={columns}
          rows={rows.data?.items ?? []}
          rowKey={(r) => r.id}
          loading={rows.isLoading}
          error={rows.isError ? rows.error : undefined}
          onRetry={() => void rows.refetch()}
          empty={<EmptyState title={t(`loans.admin.empty.${tab}`)} />}
        />
        {rows.data !== undefined && <Pagination meta={rows.data.meta} onPageChange={setPage} />}

        {decide.error !== null && decide.error !== undefined && (
          <p role="alert" className="text-sm text-red-600">
            {(decide.error as Error).message}
          </p>
        )}
      </div>

      {disbursing !== null && (
        <DisburseDialog loan={disbursing} onClose={() => setDisbursing(null)} />
      )}
    </PageContainer>
  );
};

/**
 * Recording that the money changed hands, and nothing else.
 *
 * A DATE, and only a date — the contract refuses an amount here, because the principal was decided
 * when the loan was approved and a second figure at this point would be a second principal. The
 * schedule is generated server-side from what the loan already says (D5).
 */
const DisburseDialog = ({
  loan,
  onClose,
}: {
  loan: EmployeeLoanDto;
  onClose: () => void;
}): JSX.Element => {
  const t = useT();
  const disburse = useDisburseLoanFromList();
  const [disbursedAt, setDisbursedAt] = useState('');

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('loans.disburse')}
      description={t('loans.disburseHint')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={disbursedAt === ''}
            loading={disburse.isPending}
            onClick={() =>
              disburse.mutate(
                {
                  employeeId: loan.employeeId,
                  id: loan.id,
                  body: { disbursedAt, version: loan.version },
                },
                {
                  onSuccess: () => {
                    toast.success(t('loans.disbursed'));
                    onClose();
                  },
                },
              )
            }
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t('loans.disbursedAt')} required>
          <Input
            type="date"
            value={disbursedAt}
            onChange={(e) => setDisbursedAt(e.target.value)}
            aria-label={t('loans.disbursedAt')}
          />
        </Field>
        {disburse.error !== null && disburse.error !== undefined && (
          <p role="alert" className="text-sm text-red-600">
            {(disburse.error as Error).message}
          </p>
        )}
      </div>
    </Dialog>
  );
};
