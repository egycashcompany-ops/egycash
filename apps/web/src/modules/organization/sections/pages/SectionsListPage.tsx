// Sections Management — list (Phase 3.3). Columns per spec: Department, Arabic Name, English Name,
// Status, Created, Updated, plus an inline Activate/Deactivate action. A branch filter narrows the
// department filter (both server-side, `?branchId=` / `?departmentId=`); free-text search + status
// filter + pagination are all URL-synchronized. Each section belongs to one department (its name is
// resolved from the active-departments lookup).
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type Locale, type SectionDto } from '@ecms/contracts';
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
import { sectionConfig } from '../../shared/unit-config';
import { useBranchOptions, useDepartmentOptions } from '../../shared/references';

const DEFAULT_PAGE_SIZE = 25;

/** Inline Activate/Deactivate toggle for a single section (version-checked). */
const StatusToggle = ({ section }: { section: SectionDto }): JSX.Element => {
  const t = useT();
  const update = sectionConfig.queries.useUpdate(section.id);
  const next = section.status === 'active' ? 'inactive' : 'active';
  const toggle = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: next, version: section.version });
      toast.success(t(`organization.section.${next === 'active' ? 'activated' : 'deactivated'}`));
    } catch {
      // surfaced globally
    }
  };
  return (
    <Can permission="section.edit" fallback={<span className="text-slate-300">—</span>}>
      <Button
        size="sm"
        variant={section.status === 'active' ? 'ghost' : 'secondary'}
        loading={update.isPending}
        onClick={(e) => {
          e.stopPropagation();
          void toggle();
        }}
      >
        {t(
          section.status === 'active'
            ? 'organization.action.deactivate'
            : 'organization.action.activate',
        )}
      </Button>
    </Can>
  );
};

export const SectionsListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const branchId = sp.get('branchId') ?? '';
  const departmentId = sp.get('departmentId') ?? '';
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
  // Departments used both for the filter select (narrowed by branch) and to resolve names in rows.
  const { data: filterDepartments = [] } = useDepartmentOptions(branchId === '' ? undefined : branchId);
  const { data: allDepartments = [] } = useDepartmentOptions(undefined);
  const departmentName = (id: string | undefined): string => {
    const d = allDepartments.find((x) => x.id === id);
    return d === undefined ? (id ?? '—') : localized(d.name, locale);
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
      departmentId: departmentId || undefined,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = sectionConfig.queries.useList(params);
  const rows = data?.items ?? [];

  const columns: Column<SectionDto>[] = [
    {
      key: 'departmentId',
      header: t('organization.field.department'),
      render: (s) => <span>{departmentName(s.departmentId)}</span>,
    },
    { key: 'nameAr', header: t('organization.section.nameAr'), render: (s) => <span dir="rtl">{s.name.ar}</span> },
    { key: 'nameEn', header: t('organization.section.nameEn'), render: (s) => <span dir="ltr">{s.name.en}</span> },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (s) => (
        <StatusBadge
          tone={s.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${s.status}`)}
        />
      ),
    },
    { key: 'createdAt', header: t('organization.field.created'), sortable: true, render: (s) => formatDate(s.createdAt, locale) },
    { key: 'updatedAt', header: t('organization.field.updated'), render: (s) => formatDate(s.updatedAt, locale) },
    { key: 'actions', header: '', align: 'end', render: (s) => <StatusToggle section={s} /> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.nav.sections')}
        description={t('organization.section.subtitle')}
        breadcrumbs={[{ label: t('organization.title'), to: '/organization' }, { label: t('organization.nav.sections') }]}
        actions={
          <Can permission="section.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('organization.section.create')}
            </Button>
          </Can>
        }
      />

      <ListView
        total={data?.meta.totalItems}
        hasActiveFilters={search !== '' || status !== '' || branchId !== '' || departmentId !== ''}
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
            <Select
              className="w-48"
              value={branchId}
              onChange={(e) => patch({ branchId: e.target.value || null, departmentId: null })}
            >
              <option value="">{t('organization.filter.allBranches')}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {localized(b.name, locale)}
                </option>
              ))}
            </Select>
            <Select className="w-48" value={departmentId} onChange={(e) => patch({ departmentId: e.target.value || null })}>
              <option value="">{t('organization.filter.allDepartments')}</option>
              {filterDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {localized(d.name, locale)}
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
          rowKey={(s) => s.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(s) => navigate(s.id)}
          embedded
        />
      </ListView>
    </PageContainer>
  );
};
