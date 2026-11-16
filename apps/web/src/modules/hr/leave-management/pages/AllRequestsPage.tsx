// HR administration — all requests within scope (frozen design §11), with status/type filters
// and the migration §12 ③ unreconciled-leave panel (employees left onLeave by manual actions).
// On-behalf filing lives on the employee profile's Leave tab, where the subject is known.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LEAVE_REQUEST_STATUSES, type LeaveRequestStatus } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { EmptyState, FilterBar, Pagination } from '../../../../shared/ui';
import { MultiSelect } from '../../../../shared/ui/MultiSelect';
import { readList, writeList } from '../../../../shared/lib/list-param';
import { useLeaveRequests, useLeaveTypes, useUnreconciledLeave } from '../api/leave-queries';
import { RequestsTable } from '../components/RequestsTable';
import { useRememberedFilters } from '../../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'status',
  'type',
] as const;

const DEFAULT_PAGE_SIZE = 25;

export const AllRequestsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const { data: types } = useLeaveTypes();
  const { data: unreconciled } = useUnreconciledLeave(can('leave.approve'));

  // «هنخلي كل الفلترز multi»: several statuses and several types, each ORed; a status the vocabulary
  // lacks (an old link) is dropped.
  const statuses = readList(sp, 'status').filter((s): s is LeaveRequestStatus =>
    (LEAVE_REQUEST_STATUSES as readonly string[]).includes(s),
  );
  const typeIds = readList(sp, 'type');
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (!('page' in updates)) next.delete('page');
    setSp(next);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize: DEFAULT_PAGE_SIZE,
      ...(statuses.length === 0 ? {} : { status: statuses }),
      ...(typeIds.length === 0 ? {} : { typeId: typeIds }),
    }),
    [sp.toString()],
  );
  const { data, isLoading, isError, error, refetch } = useLeaveRequests(params);

  return (
    <PageContainer>
      <PageHeader
        title={t('leave.all.title')}
        breadcrumbs={[{ label: t('leave.module.title'), to: '/leave' }, { label: t('leave.all.title') }]}
      />
      {unreconciled !== undefined && unreconciled.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">{t('leave.unreconciled.title')}</p>
          <p className="mt-1">{t('leave.unreconciled.body')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {unreconciled.map((e) => (
              <li key={e.employeeId}>
                <Link
                  to={`/employees/${e.employeeId}?tab=leave`}
                  className="rounded-full border border-amber-300 px-2 py-0.5 hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900"
                >
                  {e.fullNameAr} <span className="font-mono text-xs" dir="ltr">{e.code}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* «العرض بتاع الفلتر … يكون مظبوط ع كلام بظبط»: each filter as wide as its name, several picks each. */}
      <FilterBar
        onClear={() => patch({ status: null, type: null })}
        hasActiveFilters={statuses.length > 0 || typeIds.length > 0}
      >
        <MultiSelect
          label={t('leave.columns.status')}
          value={statuses}
          onChange={(next) => patch({ status: writeList(next) })}
          options={LEAVE_REQUEST_STATUSES.map((s) => ({ value: s, label: t(`leave.status.${s}`) }))}
        />
        <MultiSelect
          label={t('leave.columns.type')}
          value={typeIds}
          onChange={(next) => patch({ type: writeList(next) })}
          options={(types ?? []).map((x) => ({ value: x.id, label: x.name.ar }))}
        />
      </FilterBar>
      <RequestsTable
        rows={data?.items ?? []}
        loading={isLoading}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        showEmployee
        empty={<EmptyState title={t('leave.all.empty')} />}
      />
      {data !== undefined && (
        <Pagination meta={data.meta} onPageChange={(p) => patch({ page: String(p) })} />
      )}
    </PageContainer>
  );
};
