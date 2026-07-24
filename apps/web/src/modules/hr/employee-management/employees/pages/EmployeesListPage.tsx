// Employees list — the registry's daily view. Defaults to EMPLOYED people (probation / active /
// on leave / suspended); exited employees appear via the explicit view filter (frozen design
// §8). Search covers employee code, applicant code, and name. Entry points: hire from an
// accepted offer + Direct Registration (D4).
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { EMPLOYEE_STATUSES, type EmployeeDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../../platform/localization/useT';
import { useAppSelector } from '../../../../../store';
import { Can } from '../../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../../shared/ui/DataTable';
import { Pagination } from '../../../../../shared/ui/Pagination';
import { Button } from '../../../../../shared/ui/Button';
import { FilterBar } from '../../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../../shared/ui/SearchInput';
import { Select } from '../../../../../shared/ui/form';
import { PlusIcon } from '../../../../../shared/ui/icons';
import { formatDate } from '../../../../../shared/lib/format';
import { EmployeeStatusBadge } from '../components/EmployeeStatusBadge';
import { useEmployees } from '../api/employee-queries';
import { type EmployeeListParams } from '../api/employee-api';

const DEFAULT_PAGE_SIZE = 25;
type View = 'employed' | 'exited' | 'all';

export const EmployeesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const viewRaw = sp.get('view');
  const view: View = viewRaw === 'exited' || viewRaw === 'all' ? viewRaw : 'employed';
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
      search,
      // The view filter: employed (default) / exited / all — status narrows within the view.
      ...(view === 'employed' ? { employed: true } : view === 'exited' ? { employed: false } : {}),
      ...(status === '' ? {} : { status }),
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
      key: 'name',
      header: t('employees.columns.name'),
      render: (e) => <span>{e.personal.fullNameAr}</span>,
    },
    { key: 'status', header: t('employees.columns.status'), render: (e) => <EmployeeStatusBadge status={e.status} /> },
    {
      key: 'origin',
      header: t('employees.columns.origin'),
      render: (e) => <span className="text-xs text-slate-500">{t(`employees.origin.${e.origin}`)}</span>,
    },
    { key: 'hiredAt', header: t('employees.columns.hired'), sortable: true, render: (e) => formatDate(e.hiredAt, locale) },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('employees.module.title')}
        description={t('employees.list.subtitle')}
        breadcrumbs={[{ label: t('employees.module.title') }]}
        actions={
          <div className="flex items-center gap-2">
            <Can permission="employee.registerDirect">
              <Button size="sm" variant="secondary" onClick={() => navigate('register')}>
                {t('employees.actions.registerDirect')}
              </Button>
            </Can>
            <Can permission="employee.create">
              <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
                {t('employees.actions.create')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="space-y-4">
        <FilterBar>
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('employees.list.searchPlaceholder')}
          />
          <Select
            value={view}
            onChange={(e) =>
              patch({ view: e.target.value === 'employed' ? null : e.target.value, status: null })
            }
          >
            <option value="employed">{t('employees.view.employed')}</option>
            <option value="exited">{t('employees.view.exited')}</option>
            <option value="all">{t('employees.view.all')}</option>
          </Select>
          {view !== 'exited' && (
            <Select value={status} onChange={(e) => patch({ status: e.target.value || null })}>
              <option value="">{t('employees.filters.anyStatus')}</option>
              {EMPLOYEE_STATUSES.filter((s) => (view === 'employed' ? s !== 'exited' : true)).map((s) => (
                <option key={s} value={s}>
                  {t(`employees.status.${s}`)}
                </option>
              ))}
            </Select>
          )}
        </FilterBar>
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
