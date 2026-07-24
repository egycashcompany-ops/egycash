// HR administration — all requests within scope (frozen design §11), with status/type filters
// and the migration §12 ③ unreconciled-leave panel (employees left onLeave by manual actions).
// On-behalf filing lives on the employee profile's Leave tab, where the subject is known.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { LEAVE_REQUEST_STATUSES } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useCan } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { EmptyState, FilterBar, Pagination } from '../../../../shared/ui';
import { Select } from '../../../../shared/ui/form';
import { useLeaveRequests, useLeaveTypes, useUnreconciledLeave } from '../api/leave-queries';
import { RequestsTable } from '../components/RequestsTable';

const DEFAULT_PAGE_SIZE = 25;

export const AllRequestsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const { data: types } = useLeaveTypes();
  const { data: unreconciled } = useUnreconciledLeave(can('leave.approve'));

  const status = sp.get('status') ?? '';
  const typeId = sp.get('type') ?? '';
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
      ...(status === '' ? {} : { status }),
      ...(typeId === '' ? {} : { typeId }),
    }),
    [sp.toString()],
  );
  const { data, isLoading, isError, refetch } = useLeaveRequests(params);

  return (
    <PageContainer>
      <PageHeader
        title={t('leave.all.title')}
        description={t('leave.all.subtitle')}
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
      <FilterBar>
        <Select value={status} onChange={(e) => patch({ status: e.target.value })} className="w-44">
          <option value="">{t('leave.filters.allStatuses')}</option>
          {LEAVE_REQUEST_STATUSES.map((s) => (
            <option key={s} value={s}>{t(`leave.status.${s}`)}</option>
          ))}
        </Select>
        <Select value={typeId} onChange={(e) => patch({ type: e.target.value })} className="w-44">
          <option value="">{t('leave.filters.allTypes')}</option>
          {(types ?? []).map((x) => (
            <option key={x.id} value={x.id}>{x.name.ar}</option>
          ))}
        </Select>
      </FilterBar>
      <RequestsTable
        rows={data?.items ?? []}
        loading={isLoading}
        error={isError}
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
