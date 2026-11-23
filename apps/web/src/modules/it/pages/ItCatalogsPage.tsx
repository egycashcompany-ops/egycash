// IT catalogs (design §2.4): the kinds as URL-synced tabs, each the live list the forms read. Rows
// ARCHIVE instead of delete (FR-11) — assets and, later, tickets point at them — so the row action
// is edit only and the status column tells the truth.
//
// `ticketCategory` is managed here from day one even though tickets are IT-3: the collection and
// the grant are one, the screen is one, and an admin can seed the categories before the help desk
// opens rather than on the day it does. `consumableType` (FR-20) is the third tab for the same
// reason: the consumables' types («حبارات», «كابلات», «محولات» …) are localized names the IT team
// edits, which is exactly what this collection already is — one tab per kind, read off the enum.
//
// «المواقع» (2026-11-19) is a fourth tab, after the kinds, and NOT a kind: each branch's places, its
// own list (`?kind=location`, `components/LocationsTab.tsx`) — a catalog row is org-wide with one
// name per kind, and two branches may each have «غرفة السيرفرات».
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { IT_CATALOG_KINDS, type ItCatalogItemDto, type ItCatalogKind } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { BOARD_FRAME, BOARD_TABLE_FILL_LOW } from '../../../shared/ui/board-scroll';
import { Button } from '../../../shared/ui/Button';
import { Badge, StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { useItCatalogItems } from '../api/it-queries';
import { CatalogItemDialog } from '../components/CatalogItemDialog';
import { LocationsTab } from '../components/LocationsTab';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** The places' tab — `?kind=location`, outside the catalog's kinds. */
const LOCATION_TAB = 'location';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'active',
  'sort',
  'size',
] as const;

const DEFAULT_PAGE_SIZE = 25;

const isKind = (value: string | null): value is ItCatalogKind =>
  (IT_CATALOG_KINDS as readonly string[]).includes(value ?? '');

export const ItCatalogsPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const kindParam = sp.get('kind');
  const locationTab = kindParam === LOCATION_TAB;
  const kind: ItCatalogKind = isKind(kindParam) ? kindParam : 'assetCategory';
  const active = sp.get('active') ?? '';
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
  const { data, isLoading, isError, error, refetch } = useItCatalogItems(params, !locationTab);

  const [creating, setCreating] = useState(false);
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [editing, setEditing] = useState<ItCatalogItemDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItCatalogItemDto>[] = [
    {
      key: 'sortOrder',
      header: t('it.catalogs.fields.sortOrder'),
      sortable: true,
      render: (r) => <span className="tabular-nums">{r.sortOrder}</span>,
    },
    { key: 'name.ar', header: t('it.catalogs.fields.nameAr'), render: (r) => r.name.ar },
    {
      key: 'name.en',
      header: t('it.catalogs.fields.nameEn'),
      render: (r) => <span dir="ltr">{r.name.en}</span>,
    },
    {
      key: 'code',
      header: t('it.catalogs.fields.code'),
      render: (r) =>
        r.code === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {r.code}
          </span>
        ),
    },
    // «يتطلب عداد الطباعة» (2026-11-19) — a consumable type's one behaviour: its items are issued
    // onto a printer with the printer's counter reading. Fleet's «يُحتسب في الإنذار» column's shape.
    ...(kind === 'consumableType'
      ? [
          {
            key: 'requiresCounterReading',
            header: t('it.catalogs.fields.requiresCounterReading'),
            render: (r: ItCatalogItemDto) =>
              r.requiresCounterReading ? (
                <Badge tone="info">{t('it.catalogs.counterBadge')}</Badge>
              ) : (
                '—'
              ),
          } satisfies Column<ItCatalogItemDto>,
        ]
      : []),
    {
      key: 'status',
      header: t('it.assets.columns.status'),
      render: (r) => (
        <StatusBadge
          tone={r.isActive ? 'success' : 'neutral'}
          label={r.isActive ? t('it.catalogs.active') : t('it.catalogs.archived')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (r) => (
        <Can permission="itCatalog.manage">
          <button
            type="button"
            className={actionButton}
            aria-label={`${t('it.catalogs.editItem')} — ${r.name.ar}`}
            title={t('it.catalogs.editItem')}
            onClick={() => setEditing(r)}
          >
            <EditIcon className="h-4 w-4" />
          </button>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer fullHeight>
      {/* The board frame (`shared/ui/board-scroll.ts`; the IT screens, 2026-11-17 «مش عايز كل
          الصفحة تعمل Scroll !! عايز فقط الجدول لكن الزراير والفلتر يبقوا ثابتين»), as on ATM's
          data-edit screen: on a computer the title, its action, the tabs and the filter bar keep
          their place, the pager keeps its place below, and only the table's rows scroll, under a
          head that stays. Every kind is the same table (the tab only changes what it lists), so
          the page is one frame. */}
      <div className={BOARD_FRAME}>
        <PageHeader
          title={t('it.nav.catalogs')}
          breadcrumbs={[
            { label: t('it.module.title'), to: '/it' },
            { label: t('it.nav.catalogs') },
          ]}
          actions={
            <Can permission="itCatalog.manage">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => (locationTab ? setCreatingLocation(true) : setCreating(true))}
              >
                {locationTab ? t('it.locations.add') : t('it.catalogs.addItem')}
              </Button>
            </Can>
          }
        />

        <div
          className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
          role="tablist"
          aria-label={t('it.nav.catalogs')}
        >
          {IT_CATALOG_KINDS.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={!locationTab && kind === k}
              type="button"
              onClick={() => patch({ kind: k === 'assetCategory' ? null : k })}
              className={`rounded-t-lg px-4 py-2 text-sm ${
                !locationTab && kind === k
                  ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t(`it.catalogs.kind.${k}`)}
            </button>
          ))}
          <button
            role="tab"
            aria-selected={locationTab}
            type="button"
            data-catalogs-tab={LOCATION_TAB}
            onClick={() => patch({ kind: LOCATION_TAB, sort: null })}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              locationTab
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t('it.locations.tab')}
          </button>
        </div>

        {locationTab ? (
          <LocationsTab
            creating={creatingLocation}
            onCloseCreate={() => setCreatingLocation(false)}
          />
        ) : (
          <>
            <FilterBar hasActiveFilters={active !== ''} onClear={() => patch({ active: null })}>
              <Select
                aria-label={t('it.assets.columns.status')}
                value={active}
                onChange={(e) => patch({ active: e.target.value || null })}
                className="w-auto"
              >
                <option value="">{t('it.catalogs.allStatuses')}</option>
                <option value="true">{t('it.catalogs.active')}</option>
                <option value="false">{t('it.catalogs.archived')}</option>
              </Select>
            </FilterBar>

            <div className={BOARD_TABLE_FILL_LOW}>
              <DataTable
                columns={columns}
                rows={data?.items ?? []}
                rowKey={(r) => r.id}
                loading={isLoading}
                error={isError ? error : undefined}
                onRetry={() => void refetch()}
                sort={sort}
                onSortChange={changeSort}
                stickyHead
              />
            </div>
            {data !== undefined && data.meta.totalItems > 0 && (
              <Pagination
                meta={data.meta}
                onPageChange={(p) => patch({ page: String(p) }, false)}
                onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
              />
            )}
          </>
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
