// Application Categories — list. A standalone catalog grouping Applications in the sidebar. Columns:
// Order, Name, Icon, Status, Created, Updated, plus an inline Activate/Deactivate action. Search +
// status filter + pagination + sorting are URL-synchronized.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ApplicationCategoryDto, type Locale } from '@ecms/contracts';
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
import { useApplicationCategories, useUpdateApplicationCategory } from '../application-category-queries';

const DEFAULT_PAGE_SIZE = 25;

const StatusToggle = ({ category }: { category: ApplicationCategoryDto }): JSX.Element => {
  const t = useT();
  const update = useUpdateApplicationCategory(category.id);
  const next = category.status === 'active' ? 'inactive' : 'active';
  const toggle = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: next, version: category.version });
      toast.success(t(`organization.applicationCategory.${next === 'active' ? 'activated' : 'deactivated'}`));
    } catch {
      // surfaced globally
    }
  };
  return (
    <Can permission="applicationCategory.edit" fallback={<span className="text-slate-300">—</span>}>
      <Button
        size="sm"
        variant={category.status === 'active' ? 'ghost' : 'secondary'}
        loading={update.isPending}
        onClick={(e) => {
          e.stopPropagation();
          void toggle();
        }}
      >
        {t(category.status === 'active' ? 'organization.action.deactivate' : 'organization.action.activate')}
      </Button>
    </Can>
  );
};

export const ApplicationCategoriesListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'sortOrder:asc').split(':');
  const sort = { by: sortByRaw ?? 'sortOrder', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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

  const { data, isLoading, isError, error, refetch } = useApplicationCategories(params);
  const rows = data?.items ?? [];

  const columns: Column<ApplicationCategoryDto>[] = [
    { key: 'sortOrder', header: t('organization.application.sortOrder'), sortable: true, align: 'end', render: (c) => c.sortOrder },
    { key: 'name', header: t('organization.field.name'), render: (c) => <span>{localized(c.name, locale)}</span> },
    {
      key: 'icon',
      header: t('organization.application.icon'),
      render: (c) =>
        c.icon === null ? (
          <span className="text-slate-300">—</span>
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {c.icon}
          </span>
        ),
    },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (c) => (
        <StatusBadge tone={c.status === 'active' ? 'success' : 'neutral'} label={t(`organization.status.${c.status}`)} />
      ),
    },
    { key: 'createdAt', header: t('organization.field.created'), sortable: true, render: (c) => formatDate(c.createdAt, locale) },
    { key: 'updatedAt', header: t('organization.field.updated'), render: (c) => formatDate(c.updatedAt, locale) },
    { key: 'actions', header: '', align: 'end', render: (c) => <StatusToggle category={c} /> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.nav.applicationCategories')}
        description={t('organization.applicationCategory.subtitle')}
        breadcrumbs={[{ label: t('organization.title'), to: '/organization' }, { label: t('organization.nav.applicationCategories') }]}
        actions={
          <Can permission="applicationCategory.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('organization.applicationCategory.create')}
            </Button>
          </Can>
        }
      />

      <ListView
        total={data?.meta.totalItems}
        hasActiveFilters={search !== '' || status !== ''}
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
          <Select className="w-40" value={status} onChange={(e) => patch({ status: e.target.value || null })}>
            <option value="">{t('organization.filter.allStatuses')}</option>
            <option value="active">{t('organization.status.active')}</option>
            <option value="inactive">{t('organization.status.inactive')}</option>
          </Select>
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
          rowKey={(c) => c.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(c) => navigate(c.id)}
          embedded
        />
      </ListView>
    </PageContainer>
  );
};
