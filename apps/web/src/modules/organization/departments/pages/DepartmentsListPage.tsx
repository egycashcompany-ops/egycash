// Departments Management — list (Phase 3.2). Columns per spec: Branch, Arabic Name, English Name,
// Status, Created, Updated, plus an inline Activate/Deactivate action. A branch filter narrows the
// list (server-side, `?branchId=`); free-text search + status filter + pagination are all
// URL-synchronized. Reuses the shared org-unit data layer + UI kit; each department belongs to one
// branch (its name is resolved from the active-branches lookup).
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type DepartmentDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { ListView } from '../../../../shared/ui/ListView';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Select } from '../../../../shared/ui/form';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { PlusIcon } from '../../../../shared/ui/icons';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatDate, localized } from '../../../../shared/lib/format';
import { departmentConfig } from '../../shared/unit-config';
import { useBranchOptions } from '../../shared/references';

const DEFAULT_PAGE_SIZE = 25;

/** Inline Activate/Deactivate toggle for a single department (version-checked). */
const StatusToggle = ({ department }: { department: DepartmentDto }): JSX.Element => {
  const t = useT();
  const update = departmentConfig.queries.useUpdate(department.id);
  const next = department.status === 'active' ? 'inactive' : 'active';
  const toggle = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: next, version: department.version });
      toast.success(t(`organization.department.${next === 'active' ? 'activated' : 'deactivated'}`));
    } catch {
      // surfaced globally
    }
  };
  return (
    <Can permission="department.edit" fallback={<span className="text-slate-300">—</span>}>
      <Button
        size="sm"
        variant={department.status === 'active' ? 'ghost' : 'secondary'}
        loading={update.isPending}
        onClick={(e) => {
          e.stopPropagation();
          void toggle();
        }}
      >
        {t(
          department.status === 'active'
            ? 'organization.action.deactivate'
            : 'organization.action.activate',
        )}
      </Button>
    </Can>
  );
};

export const DepartmentsListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const branchId = sp.get('branchId') ?? '';
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

  const { data: branches = [] } = useBranchOptions();
  const branchName = (id: string | undefined): string => {
    const b = branches.find((x) => x.id === id);
    return b === undefined ? (id ?? '—') : localized(b.name, locale);
  };

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      branchId: branchId || undefined,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = departmentConfig.queries.useList(params);
  const rows = data?.items ?? [];

  const columns: Column<DepartmentDto>[] = [
    {
      key: 'branchId',
      header: t('organization.field.branch'),
      render: (d) => <span>{branchName(d.branchId)}</span>,
    },
    { key: 'nameAr', header: t('organization.department.nameAr'), render: (d) => <span dir="rtl">{d.name.ar}</span> },
    { key: 'nameEn', header: t('organization.department.nameEn'), render: (d) => <span dir="ltr">{d.name.en}</span> },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (d) => (
        <StatusBadge
          tone={d.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${d.status}`)}
        />
      ),
    },
    { key: 'createdAt', header: t('organization.field.created'), sortable: true, render: (d) => formatDate(d.createdAt, locale) },
    { key: 'updatedAt', header: t('organization.field.updated'), render: (d) => formatDate(d.updatedAt, locale) },
    { key: 'actions', header: '', align: 'end', render: (d) => <StatusToggle department={d} /> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.nav.departments')}
        description={t('organization.department.subtitle')}
        breadcrumbs={[{ label: t('organization.title'), to: '/organization' }, { label: t('organization.nav.departments') }]}
        actions={
          <Can permission="department.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('organization.department.create')}
            </Button>
          </Can>
        }
      />

      <ListView
        total={data?.meta.totalItems}
        hasActiveFilters={search !== '' || status !== '' || branchId !== ''}
        onClear={() => setSp(new URLSearchParams())}
        search={
          <SearchInput
            className="w-full sm:w-64"
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('organization.filter.search')}
          />
        }
        filters={
          <>
            <Select className="w-48" value={branchId} onChange={(e) => patch({ branchId: e.target.value || null })}>
              <option value="">{t('organization.filter.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {localized(b.name, locale)}
                </option>
              ))}
            </Select>
            <Select className="w-40" value={status} onChange={(e) => patch({ status: e.target.value || null })}>
              <option value="">{t('organization.filter.allStatuses')}</option>
              <option value="active">{t('organization.status.active')}</option>
              <option value="inactive">{t('organization.status.inactive')}</option>
            </Select>
          </>
        }
        pagination={
          data !== undefined && data.meta.totalItems > 0 ? (
            <Pagination
              meta={data.meta}
              onPageChange={(p) => patch({ page: String(p) }, false)}
              onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
            />
          ) : undefined
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(d) => d.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(d) => navigate(d.id)}
          embedded
        />
      </ListView>
    </PageContainer>
  );
};
