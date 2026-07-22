// Branches Management — list (Phase 3.1). Columns per spec: Branch Code, Arabic Name, English Name,
// Status, Created, Updated, plus an inline Activate/Deactivate action. Free-text search + status
// filter + pagination are URL-synchronized. Reuses the shared org-unit data layer + UI kit.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type BranchDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../../platform/localization/useT';
import { useAppSelector } from '../../../../store';
import { Can } from '../../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../../shared/ui/DataTable';
import { Pagination } from '../../../../shared/ui/Pagination';
import { Button } from '../../../../shared/ui/Button';
import { FilterBar } from '../../../../shared/ui/FilterBar';
import { SearchInput } from '../../../../shared/ui/SearchInput';
import { Select } from '../../../../shared/ui/form';
import { StatusBadge } from '../../../../shared/ui/Badge';
import { PlusIcon } from '../../../../shared/ui/icons';
import { toast } from '../../../../shared/ui/toast/toast-store';
import { formatDate } from '../../../../shared/lib/format';
import { branchConfig } from '../../shared/unit-config';

const DEFAULT_PAGE_SIZE = 25;

/** Inline Activate/Deactivate toggle for a single branch (version-checked). */
const StatusToggle = ({ branch }: { branch: BranchDto }): JSX.Element => {
  const t = useT();
  const update = branchConfig.queries.useUpdate(branch.id);
  const next = branch.status === 'active' ? 'inactive' : 'active';
  const toggle = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: next, version: branch.version });
      toast.success(t(`organization.branch.${next === 'active' ? 'activated' : 'deactivated'}`));
    } catch {
      // surfaced globally
    }
  };
  return (
    <Can permission="branch.edit" fallback={<span className="text-slate-300">—</span>}>
      <Button
        size="sm"
        variant={branch.status === 'active' ? 'ghost' : 'secondary'}
        loading={update.isPending}
        onClick={(e) => {
          e.stopPropagation();
          void toggle();
        }}
      >
        {t(branch.status === 'active' ? 'organization.action.deactivate' : 'organization.action.activate')}
      </Button>
    </Can>
  );
};

export const BranchesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
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

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = branchConfig.queries.useList(params);
  const rows = data?.items ?? [];

  const columns: Column<BranchDto>[] = [
    {
      key: 'code',
      header: t('organization.field.code'),
      sortable: true,
      render: (b) => (
        <span className="font-mono text-xs" dir="ltr">
          {b.code}
        </span>
      ),
    },
    { key: 'nameAr', header: t('organization.branch.nameAr'), render: (b) => <span dir="rtl">{b.name.ar}</span> },
    { key: 'nameEn', header: t('organization.branch.nameEn'), render: (b) => <span dir="ltr">{b.name.en}</span> },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (b) => (
        <StatusBadge
          tone={b.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${b.status}`)}
        />
      ),
    },
    { key: 'createdAt', header: t('organization.field.created'), sortable: true, render: (b) => formatDate(b.createdAt, locale) },
    { key: 'updatedAt', header: t('organization.field.updated'), render: (b) => formatDate(b.updatedAt, locale) },
    { key: 'actions', header: '', align: 'end', render: (b) => <StatusToggle branch={b} /> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.nav.branches')}
        description={t('organization.branch.subtitle')}
        breadcrumbs={[{ label: t('organization.title'), to: '/organization' }, { label: t('organization.nav.branches') }]}
        actions={
          <Can permission="branch.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('organization.branch.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar hasActiveFilters={search !== '' || status !== ''} onClear={() => setSp(new URLSearchParams())}>
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('organization.filter.search')}
          />
          <Select className="w-40" value={status} onChange={(e) => patch({ status: e.target.value || null })}>
            <option value="">{t('organization.filter.allStatuses')}</option>
            <option value="active">{t('organization.status.active')}</option>
            <option value="inactive">{t('organization.status.inactive')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(b) => b.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(b) => navigate(b.id)}
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
