// Electronic Employee File list: free-text search + status filter, a sortable DataTable, pagination,
// and an assemble entry point — all permission-gated. Search/status/sort/pagination are synchronized
// with the URL query string (deep-linkable, back/forward aware).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type EmployeeFileDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../../../shared/lib/format';
import { EmployeeFileStatusBadge } from '../components/EmployeeFileStatusBadge';
import { EmployeeFileFilters, type EmployeeFileFiltersState } from '../components/EmployeeFileFilters';
import { CreateEmployeeFileDialog } from '../components/CreateEmployeeFileDialog';
import { useEmployeeFiles } from '../api/employee-file-queries';
import { type EmployeeFileListParams } from '../api/employee-file-api';

const DEFAULT_PAGE_SIZE = 25;

export const EmployeeFilesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);

  const filters: EmployeeFileFiltersState = {
    search: sp.get('q') ?? '',
    status: (sp.get('status') ?? '') as EmployeeFileFiltersState['status'],
  };
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'createdAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'createdAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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

  const changeFilters = (nf: EmployeeFileFiltersState): void => patch({ q: nf.search || null, status: nf.status || null });
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };

  const params = useMemo<EmployeeFileListParams>(
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

  const { data, isLoading, isError, error, refetch } = useEmployeeFiles(params);
  const rows = data?.items ?? [];

  const columns: Column<EmployeeFileDto>[] = [
    {
      key: 'employeeCode',
      header: t('employeeFiles.columns.employee'),
      sortable: true,
      render: (f) => <span className="font-mono text-xs" dir="ltr">{f.employeeCode}</span>,
    },
    { key: 'status', header: t('employeeFiles.columns.status'), render: (f) => <EmployeeFileStatusBadge status={f.status} /> },
    { key: 'milestones', header: t('employeeFiles.columns.milestones'), align: 'center', render: (f) => formatNumber(f.timeline.length, locale) },
    { key: 'createdAt', header: t('employeeFiles.columns.created'), sortable: true, render: (f) => formatDate(f.createdAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('recruitment.nav.employeeFiles')}
        description={t('employeeFiles.list.subtitle')}
        breadcrumbs={[{ label: t('recruitment.title'), to: '/' }, { label: t('recruitment.nav.employeeFiles') }]}
        actions={
          <Can permission="employeeFile.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => setCreateOpen(true)}>
              {t('employeeFiles.actions.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <EmployeeFileFilters value={filters} onChange={changeFilters} />
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(f) => f.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          onRowClick={(f) => navigate(f.id)}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <CreateEmployeeFileDialog open={createOpen} onClose={() => setCreateOpen(false)} />
    </PageContainer>
  );
};
