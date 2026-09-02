// Fleet catalogs (FW-10, §2.10): the six catalog kinds as URL-synced tabs, each the live list
// straight from the API — the same rows every fleet form's select reads, managed here behind
// `fleetCatalog.manage`. Items ARCHIVE instead of delete (history references them), so the row
// action is edit only and the status column tells the truth. `countsForAlarm` renders only on
// the workType tab, exactly where the schema allows it.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_CATALOG_KINDS,
  type FleetCatalogItemDto,
  type FleetCatalogKind,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge, StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { useCatalogItems } from '../api/fleet-queries';
import { CatalogItemDialog } from '../components/CatalogDialogs';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'active',
  'sort',
  'size',
] as const;

const DEFAULT_PAGE_SIZE = 25;

const isKind = (value: string | null): value is FleetCatalogKind =>
  (FLEET_CATALOG_KINDS as readonly string[]).includes(value ?? '');

export const CatalogsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const kindParam = sp.get('kind');
  const kind: FleetCatalogKind = isKind(kindParam) ? kindParam : 'workshop';
  const active = sp.get('active') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'name.ar:asc').split(':');
  const sort = { by: sortByRaw ?? 'name.ar', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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

  const params = useMemo(
    () => ({
      kind,
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      isActive: active === '' ? undefined : active === 'true',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useCatalogItems(params);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FleetCatalogItemDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetCatalogItemDto>[] = [
    {
      key: 'name.ar',
      header: t('fleet.catalogs.fields.nameAr'),
      sortable: true,
      render: (r) => r.name.ar,
    },
    {
      key: 'nameEn',
      header: t('fleet.catalogs.fields.nameEn'),
      render: (r) => <span dir="ltr">{r.name.en}</span>,
    },
    ...(kind === 'workType'
      ? [
          {
            key: 'countsForAlarm',
            header: t('fleet.catalogs.fields.countsForAlarm'),
            render: (r: FleetCatalogItemDto) =>
              r.countsForAlarm ? <Badge tone="info">{t('fleet.catalogs.countsBadge')}</Badge> : '—',
          } satisfies Column<FleetCatalogItemDto>,
        ]
      : []),
    {
      key: 'status',
      header: t('fleet.vehicles.columns.status'),
      render: (r) => (
        <StatusBadge
          tone={r.isActive ? 'success' : 'neutral'}
          label={r.isActive ? t('fleet.catalogs.active') : t('fleet.catalogs.archived')}
        />
      ),
    },
    ...(can('fleetCatalog.manage')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetCatalogItemDto) => (
              <button
                type="button"
                className={actionButton}
                aria-label={t('fleet.catalogs.editItem')}
                title={t('fleet.catalogs.editItem')}
                onClick={() => setEditing(r)}
              >
                <EditIcon className="h-4 w-4" />
              </button>
            ),
          } satisfies Column<FleetCatalogItemDto>,
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.catalogs')}
        description={t('fleet.catalogs.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.catalogs') },
        ]}
        actions={
          <Can permission="fleetCatalog.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              {t('fleet.catalogs.addItem', { kind: t(`fleet.catalogs.kind.${kind}`) })}
            </Button>
          </Can>
        }
      />

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
      >
        {FLEET_CATALOG_KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={kind === k}
            type="button"
            onClick={() => patch({ kind: k === 'workshop' ? null : k })}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              kind === k
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(`fleet.catalogs.kind.${k}`)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <FilterBar hasActiveFilters={active !== ''} onClear={() => patch({ active: null })}>
          <Select
            aria-label={t('fleet.vehicles.columns.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.catalogs.allStatuses')}</option>
            <option value="true">{t('fleet.catalogs.active')}</option>
            <option value="false">{t('fleet.catalogs.archived')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <CatalogItemDialog
        open={creating}
        onClose={() => setCreating(false)}
        kind={kind}
        item={null}
      />
      <CatalogItemDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        kind={kind}
        item={editing}
      />
    </PageContainer>
  );
};
