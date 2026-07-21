// Employee list: free-text search + status filter, a sortable DataTable, pagination, and a hire
// entry point — all permission-gated. Search/status/sort/pagination are synchronized with the URL
// query string (deep-linkable, back/forward aware).
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate } from '../../../../../shared/lib/format';
import { EmployeeStatusBadge } from '../components/EmployeeStatusBadge';
import { EmployeeFilters, type EmployeeFiltersState } from '../components/EmployeeFilters';
import { useEmployees } from '../api/employee-queries';
import { type EmployeeListParams } from '../api/employee-api';

const DEFAULT_PAGE_SIZE = 25;

export const EmployeesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const filters: EmployeeFiltersState = {
    search: sp.get('q') ?? '',
    status: (sp.get('status') ?? '') as EmployeeFiltersState['status'],
  };
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'hiredAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'hiredAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
    by: string;
    dir: 'asc' | 'desc';
  };
  const paramsKey = sp.toString();

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const changeFilters = (nf: EmployeeFiltersState): void =>
    patch({ q: nf.search || null, status: nf.status || null });
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo<EmployeeListParams>(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: filters.search,
      status: filters.status,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useEmployees(params);
  const rows = data?.items ?? [];

  const columns: Column<EmployeeDto>[] = [
    {
      key: 'code',
      header: t('employees.columns.code'),
      sortable: true,
      render: (e) => <span className="font-mono text-xs" dir="ltr">{e.code}</span>,
    },
    {
      key: 'applicant',
      header: t('employees.columns.applicant'),
      render: (e) => <span className="font-mono text-xs" dir="ltr">{e.applicantCode}</span>,
    },
    { key: 'status', header: t('employees.columns.status'), render: (e) => <EmployeeStatusBadge status={e.status} /> },
    { key: 'offer', header: t('employees.columns.offer'), render: (e) => <span className="font-mono text-xs" dir="ltr">{e.offerCode}</span> },
    { key: 'hiredAt', header: t('employees.columns.hired'), sortable: true, render: (e) => formatDate(e.hiredAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.employees')}
        description={t('employees.list.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.employees') }]}
        actions={
          <Can permission="employee.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('employees.actions.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <EmployeeFilters value={filters} onChange={changeFilters} />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(e) => e.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(e) => navigate(e.id)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>
    </PageContainer>
  );
};
