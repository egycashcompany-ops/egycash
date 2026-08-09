// The maintenance board (design §2.7, §4.7, §12) — URL-synced search + filters + sort +
// pagination over the real IT-4 list API, so a supervisor's filtered view is a shareable link.
//
// Every column is a SERVER fact: `orderCode` comes off the module's sequence (FR-1) and `status`
// moves only through a named transition (§4.7). Nothing here recomputes either.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  IT_MAINTENANCE_KINDS,
  IT_MAINTENANCE_ORDER_STATUSES,
  type ItMaintenanceOrderDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Select } from '../../../shared/ui/form';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { EyeIcon, InboxIcon, PlusIcon, SearchIcon } from '../../../shared/ui/icons';
import { formatDate } from '../../../shared/lib/format';
import { useItMaintenanceOrders } from '../api/it-queries';
import { MaintenanceStatusBadge } from '../components/MaintenanceStatusBadge';
import { CreateMaintenanceOrderDialog } from '../components/MaintenanceOrderDialogs';

const DEFAULT_PAGE_SIZE = 25;

export const MaintenanceOrdersPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const kind = sp.get('kind') ?? '';
  const active = sp.get('active') ?? '';
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
  const changeSort = (by: string): void => {
    const dir = sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };
  const hasActiveFilters = search !== '' || status !== '' || kind !== '' || active !== '';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      kind: kind || undefined,
      active: active === '' ? undefined : active === 'true',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItMaintenanceOrders(params);
  const rows = data?.items ?? [];

  const [creating, setCreating] = useState(false);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  // Only the fields the API's `sortableFields` accepts carry a sort header. An undeclared `sortBy`
  // does not error — the repository quietly falls back to `createdAt` — so a header wired to
  // anything else would look like it worked and sort by something entirely different.
  const columns: Column<ItMaintenanceOrderDto>[] = [
    {
      key: 'orderCode',
      header: t('it.maintenance.columns.code'),
      sortable: true,
      render: (order) => (
        <span className="font-mono text-xs" dir="ltr">
          {order.orderCode}
        </span>
      ),
    },
    {
      key: 'kind',
      header: t('it.maintenance.columns.kind'),
      render: (order) => t(`it.maintenance.kind.${order.kind}`),
    },
    {
      key: 'status',
      header: t('it.maintenance.columns.status'),
      sortable: true,
      render: (order) => <MaintenanceStatusBadge status={order.status} />,
    },
    {
      key: 'scheduledFor',
      header: t('it.maintenance.columns.scheduledFor'),
      sortable: true,
      render: (order) => (order.scheduledFor === null ? '—' : formatDate(order.scheduledFor, locale)),
    },
    {
      key: 'completedAt',
      header: t('it.maintenance.columns.completedAt'),
      render: (order) => (order.completedAt === null ? '—' : formatDate(order.completedAt, locale)),
    },
    {
      key: 'summary',
      header: t('it.maintenance.columns.summary'),
      render: (order) => order.summary ?? '—',
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (order) => (
        <button
          type="button"
          className={actionButton}
          aria-label={`${t('it.maintenance.open')} — ${order.orderCode}`}
          title={t('it.maintenance.open')}
          onClick={() => navigate(order.id)}
        >
          <EyeIcon className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.maintenance')}
        description={t('it.maintenance.subtitle')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.maintenance') },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {can('itMaintenance.view') && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => navigate('/it/maintenance-plans')}
              >
                {t('it.nav.maintenancePlans')}
              </Button>
            )}
            <Can permission="itMaintenance.create">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setCreating(true)}
              >
                {t('it.maintenance.create')}
              </Button>
            </Can>
          </div>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ q: null, status: null, kind: null, active: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('it.maintenance.searchPlaceholder')}
            aria-label={t('it.maintenance.searchPlaceholder')}
            className="w-64"
          />
          <Select
            aria-label={t('it.maintenance.columns.status')}
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.maintenance.allStatuses')}</option>
            {IT_MAINTENANCE_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`it.maintenance.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('it.maintenance.columns.kind')}
            value={kind}
            onChange={(e) => patch({ kind: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.maintenance.allKinds')}</option>
            {IT_MAINTENANCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`it.maintenance.kind.${k}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('it.maintenance.openClosed')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.maintenance.anyLifecycle')}</option>
            <option value="true">{t('it.maintenance.onlyActive')}</option>
            <option value="false">{t('it.maintenance.onlyFinished')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(order) => order.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          empty={
            hasActiveFilters ? (
              <EmptyState
                icon={<SearchIcon className="h-10 w-10" />}
                title={t('it.maintenance.emptyFilteredTitle')}
                description={t('it.maintenance.emptyFilteredBody')}
              />
            ) : (
              <EmptyState
                icon={<InboxIcon className="h-10 w-10" />}
                title={t('it.maintenance.emptyTitle')}
                description={t('it.maintenance.emptyBody')}
              />
            )
          }
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <CreateMaintenanceOrderDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(order) => navigate(order.id)}
      />
    </PageContainer>
  );
};
