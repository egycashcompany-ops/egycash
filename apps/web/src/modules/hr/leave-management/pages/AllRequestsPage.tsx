// HR administration — all requests within scope (frozen design §11), with status/type filters.
// On-behalf filing lives on the employee profile's Leave tab, where the subject is known.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LEAVE_REQUEST_STATUSES } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { EmptyState, FilterBar, Pagination } from '../../../../shared/ui';
import { Select } from '../../../../shared/ui/form';
import { useLeaveRequests, useLeaveTypes } from '../api/leave-queries';
import { RequestsTable } from '../components/RequestsTable';

const DEFAULT_PAGE_SIZE = 25;

export const AllRequestsPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const { data: types } = useLeaveTypes();

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
