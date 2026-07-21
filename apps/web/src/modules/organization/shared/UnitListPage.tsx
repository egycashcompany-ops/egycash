// Generic Branch/Department/Section list: free-text search, status + parent filters, a sortable
// table, pagination and a permission-gated create entry point. Filters/sort/pagination are
// URL-synchronized (deep-linkable, back/forward aware). One implementation, configured per unit.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Select } from '../../../shared/ui/form';
import { StatusBadge } from '../../../shared/ui/Badge';
import { PlusIcon } from '../../../shared/ui/icons';
import { formatDate, localized } from '../../../shared/lib/format';
import { UserName } from './UserPicker';
import { useBranchOptions, useDepartmentOptions } from './references';
import { type AnyUnitDto } from './org-unit-resource';
import { type UnitConfig } from './unit-config';

const DEFAULT_PAGE_SIZE = 25;

export const UnitListPage = <TDto extends AnyUnitDto>({
  config,
}: {
  config: UnitConfig<TDto>;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const wantsBranch = config.parents.includes('branch');
  const wantsDept = config.parents.includes('department');

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const branchId = sp.get('branch') ?? '';
  const departmentId = sp.get('department') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'code:asc').split(':');
  const sort = { by: sortByRaw ?? 'code', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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

  const { data: branches = [] } = useBranchOptions(wantsBranch);
  const { data: departments = [] } = useDepartmentOptions(
    branchId === '' ? undefined : branchId,
    wantsDept,
  );

  const branchName = useMemo(
    () => new Map(branches.map((b) => [b.id, localized(b.name, locale)])),
    [branches, locale],
  );
  const deptName = useMemo(
    () => new Map(departments.map((d) => [d.id, localized(d.name, locale)])),
    [departments, locale],
  );

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      branchId: wantsBranch || wantsDept ? branchId || undefined : undefined,
      departmentId: wantsDept ? departmentId || undefined : undefined,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = config.queries.useList(params);
  const rows = data?.items ?? [];

  const columns: Column<TDto>[] = [
    {
      key: 'code',
      header: t('organization.field.code'),
      sortable: true,
      render: (u) => (
        <span className="font-mono text-xs" dir="ltr">
          {u.code}
        </span>
      ),
    },
    { key: 'name', header: t('organization.field.name'), render: (u) => localized(u.name, locale) },
  ];
  if (wantsDept) {
    columns.push({
      key: 'department',
      header: t('organization.nav.departments'),
      render: (u) => deptName.get(u.departmentId ?? '') ?? '—',
    });
  } else if (wantsBranch) {
    columns.push({
      key: 'branch',
      header: t('organization.nav.branches'),
      render: (u) => branchName.get(u.branchId ?? '') ?? '—',
    });
  }
  columns.push(
    {
      key: 'manager',
      header: t('organization.field.manager'),
      render: (u) => <UserName userId={u.managerId} />,
    },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (u) => (
        <StatusBadge
          tone={u.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${u.status}`)}
        />
      ),
    },
    {
      key: 'createdAt',
      header: t('organization.field.created'),
      sortable: true,
      render: (u) => formatDate(u.createdAt, locale),
    },
  );

  const hasFilters = search !== '' || status !== '' || branchId !== '' || departmentId !== '';

  return (
    <PageContainer>
      <PageHeader
        title={t(`organization.nav.${config.feature}`)}
        description={t(`organization.${config.entity}.subtitle`)}
        breadcrumbs={[
          { label: t('organization.title'), to: '/organization' },
          { label: t(`organization.nav.${config.feature}`) },
        ]}
        actions={
          <Can permission={`${config.entity}.create`}>
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t(`organization.${config.entity}.create`)}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasFilters}
          onClear={() => setSp(new URLSearchParams())}
        >
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('organization.filter.search')}
          />
          {wantsBranch && (
            <Select
              className="w-48"
              value={branchId}
              onChange={(e) => patch({ branch: e.target.value || null, department: null })}
            >
              <option value="">{t('organization.filter.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {localized(b.name, locale)}
                </option>
              ))}
            </Select>
          )}
          {wantsDept && (
            <Select
              className="w-48"
              value={departmentId}
              onChange={(e) => patch({ department: e.target.value || null })}
            >
              <option value="">{t('organization.filter.allDepartments')}</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {localized(d.name, locale)}
                </option>
              ))}
            </Select>
          )}
          <Select
            className="w-40"
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
          >
            <option value="">{t('organization.filter.allStatuses')}</option>
            <option value="active">{t('organization.status.active')}</option>
            <option value="inactive">{t('organization.status.inactive')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(u) => u.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(u) => navigate(u.id)}
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
