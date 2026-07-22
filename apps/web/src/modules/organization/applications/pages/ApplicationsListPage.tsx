// Applications Management — list. A standalone platform catalog: each application is a navigable
// module (icon + route) grouped by category and ordered by sortOrder. Columns: Order, Name, Category,
// Route, Status, Created, Updated, plus an inline Activate/Deactivate action. Category + status
// filters, free-text search, pagination and sorting are all URL-synchronized.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type ApplicationDto, type Locale } from '@ecms/contracts';
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
import { formatDate, localized } from '../../../../shared/lib/format';
import { useApplications, useUpdateApplication } from '../application-queries';

const DEFAULT_PAGE_SIZE = 25;

/** Inline Activate/Deactivate toggle for a single application (version-checked). */
const StatusToggle = ({ application }: { application: ApplicationDto }): JSX.Element => {
  const t = useT();
  const update = useUpdateApplication(application.id);
  const next = application.status === 'active' ? 'inactive' : 'active';
  const toggle = async (): Promise<void> => {
    try {
      await update.mutateAsync({ status: next, version: application.version });
      toast.success(t(`organization.application.${next === 'active' ? 'activated' : 'deactivated'}`));
    } catch {
      // surfaced globally
    }
  };
  return (
    <Can permission="application.edit" fallback={<span className="text-slate-300">—</span>}>
      <Button
        size="sm"
        variant={application.status === 'active' ? 'ghost' : 'secondary'}
        loading={update.isPending}
        onClick={(e) => {
          e.stopPropagation();
          void toggle();
        }}
      >
        {t(
          application.status === 'active'
            ? 'organization.action.deactivate'
            : 'organization.action.activate',
        )}
      </Button>
    </Can>
  );
};

export const ApplicationsListPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const category = sp.get('category') ?? '';
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

  // A lightweight full fetch drives the category filter options (categories are free-form).
  const { data: allApps } = useApplications({ pageSize: 200, sortBy: 'category', sortDir: 'asc' });
  const categories = useMemo(
    () => [...new Set((allApps?.items ?? []).map((a) => a.category))].sort((a, b) => a.localeCompare(b)),
    [allApps],
  );

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      category: category || undefined,
    }),
    [paramsKey],
  );

  const { data, isLoading, isError, error, refetch } = useApplications(params);
  const rows = data?.items ?? [];

  const columns: Column<ApplicationDto>[] = [
    { key: 'sortOrder', header: t('organization.application.sortOrder'), sortable: true, align: 'end', render: (a) => a.sortOrder },
    {
      key: 'name',
      header: t('organization.field.name'),
      render: (a) => <span>{localized(a.name, locale)}</span>,
    },
    { key: 'category', header: t('organization.application.category'), sortable: true, render: (a) => <span>{a.category}</span> },
    {
      key: 'route',
      header: t('organization.application.route'),
      render: (a) => (
        <span className="font-mono text-xs" dir="ltr">
          {a.route}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('organization.field.status'),
      sortable: true,
      render: (a) => (
        <StatusBadge
          tone={a.status === 'active' ? 'success' : 'neutral'}
          label={t(`organization.status.${a.status}`)}
        />
      ),
    },
    { key: 'createdAt', header: t('organization.field.created'), sortable: true, render: (a) => formatDate(a.createdAt, locale) },
    { key: 'updatedAt', header: t('organization.field.updated'), render: (a) => formatDate(a.updatedAt, locale) },
    { key: 'actions', header: '', align: 'end', render: (a) => <StatusToggle application={a} /> },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('organization.nav.applications')}
        description={t('organization.application.subtitle')}
        breadcrumbs={[{ label: t('organization.title'), to: '/organization' }, { label: t('organization.nav.applications') }]}
        actions={
          <Can permission="application.create">
            <Button size="sm" leftIcon={<PlusIcon className="h-4 w-4" />} onClick={() => navigate('new')}>
              {t('organization.application.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== '' || status !== '' || category !== ''}
          onClear={() => setSp(new URLSearchParams())}
        >
          <SearchInput
            value={search}
            onChange={(v) => patch({ q: v || null })}
            placeholder={t('organization.application.searchPlaceholder')}
          />
          <Select className="w-48" value={category} onChange={(e) => patch({ category: e.target.value || null })}>
            <option value="">{t('organization.application.allCategories')}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select className="w-40" value={status} onChange={(e) => patch({ status: e.target.value || null })}>
            <option value="">{t('organization.filter.allStatuses')}</option>
            <option value="active">{t('organization.status.active')}</option>
            <option value="inactive">{t('organization.status.inactive')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={(by) =>
            patch({ sort: `${by}:${sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc'}` }, false)
          }
          onRowClick={(a) => navigate(a.id)}
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
