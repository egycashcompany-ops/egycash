// Units and categories «وحدات القياس والتصنيفات» (design §2.3.2–§2.3.3, §19.5): the two lists the
// item form reads, one tab each — the units of measure (OD-07, a base unit per item) and the item
// categories (OD-06 A, two levels). Written after IT's `ItCatalogsPage`, in the board frame (OD-83
// B): the title, its action, the tabs and the filter keep their place, and only the rows scroll.
//
// Rows RETIRE rather than delete — items name them — so the row action is edit only, and a row is
// retired or brought back with its form's Active box. The tab lives in the URL (`?kind=category`;
// the units are the default and stay off it), and is not remembered: a link to the categories opens
// the categories. The tablist is written here, page-local, as IT's is (D-21).
//
// The screen is the catalog managers' (`administrationCatalog.manage`); item readers read the same
// lists through the item form's selects. Writes are held at organization scope on the server
// (OD-04 A).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  type AdministrationCatalogItemDto,
  type AdministrationItemCategoryDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { RowActions } from '../../../shared/ui/RowActions';
import { Select } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatNumber, localized } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAdministrationCategories, useAdministrationUnits } from '../api/catalog-queries';
import { ItemCategoryDialog } from '../components/ItemCategoryDialog';
import { UnitDialog } from '../components/UnitDialog';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['active', 'size', 'sort'] as const;

const DEFAULT_PAGE_SIZE = 25;

/** The two tabs, in order; the first is the default and stays off the URL. */
export const CATALOG_TABS = ['unit', 'category'] as const;
export type CatalogTab = (typeof CATALOG_TABS)[number];

type Row = AdministrationCatalogItemDto | AdministrationItemCategoryDto;

export const CatalogsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const kind: CatalogTab = sp.get('kind') === 'category' ? 'category' : 'unit';
  const active = sp.get('active') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'sortOrder:asc').split(':');
  const sort = {
    by: sortByRaw === undefined || sortByRaw === '' ? 'sortOrder' : sortByRaw,
    dir: sortDirRaw === 'desc' ? ('desc' as const) : ('asc' as const),
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
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      isActive: active === '' ? undefined : active === 'true',
    }),
    [paramsKey],
  );
  const units = useAdministrationUnits(params, kind === 'unit');
  const categories = useAdministrationCategories(params, kind === 'category');
  const list = kind === 'unit' ? units : categories;
  const rows: Row[] = list.data?.items ?? [];

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const columns: Column<Row>[] = [
    {
      key: 'sortOrder',
      header: t('administration.catalogs.fields.sortOrder'),
      sortable: true,
      render: (row) => <span className="tabular-nums">{formatNumber(row.sortOrder, locale)}</span>,
    },
    {
      key: 'name.ar',
      header: t('administration.catalogs.fields.nameAr'),
      sortable: true,
      render: (row) => <span dir="rtl">{row.name.ar}</span>,
    },
    {
      key: 'name.en',
      header: t('administration.catalogs.fields.nameEn'),
      render: (row) => <span dir="ltr">{row.name.en}</span>,
    },
    {
      key: 'code',
      header: t('administration.catalogs.fields.code'),
      render: (row) =>
        row.code === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {row.code}
          </span>
        ),
    },
    ...(kind === 'category'
      ? [
          {
            key: 'parent',
            header: t('administration.catalogs.fields.parent'),
            render: (row: Row) =>
              'parentName' in row && row.parentName !== null
                ? localized(row.parentName, locale)
                : '—',
          } satisfies Column<Row>,
        ]
      : []),
    {
      key: 'status',
      header: t('common.status'),
      render: (row) => (
        <StatusBadge
          tone={row.isActive ? 'success' : 'neutral'}
          label={t(
            row.isActive ? 'administration.status.active' : 'administration.status.inactive',
          )}
        />
      ),
    },
    {
      key: 'actions',
      header: t('administration.catalogs.columns.actions'),
      align: 'end',
      render: (row) => (
        <Can permission="administrationCatalog.manage">
          <RowActions className="justify-end">
            <Button
              size="icon"
              variant="ghost"
              aria-label={`${t(`administration.catalogs.${kind}.edit`)} — ${localized(row.name, locale)}`}
              title={t(`administration.catalogs.${kind}.edit`)}
              onClick={() => setEditing(row)}
            >
              <EditIcon className="h-4 w-4" />
            </Button>
          </RowActions>
        </Can>
      ),
    },
  ];

  const editingUnit =
    kind === 'unit' && editing !== null && !('parentId' in editing) ? editing : null;
  const editingCategory =
    kind === 'category' && editing !== null && 'parentId' in editing ? editing : null;

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        <PageHeader
          title={t('administration.nav.catalogs')}
          breadcrumbs={[
            { label: t('administration.module.title'), to: '/administration' },
            { label: t('administration.nav.catalogs') },
          ]}
          actions={
            <Can permission="administrationCatalog.manage">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setCreating(true)}
              >
                {t(`administration.catalogs.${kind}.add`)}
              </Button>
            </Can>
          }
        />

        <div
          className="flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
          role="tablist"
          aria-label={t('administration.nav.catalogs')}
        >
          {CATALOG_TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={kind === tab}
              type="button"
              data-catalogs-tab={tab}
              onClick={() => {
                setEditing(null);
                patch({ kind: tab === 'unit' ? null : tab });
              }}
              className={`rounded-t-lg px-4 py-2 text-sm ${
                kind === tab
                  ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {t(`administration.catalogs.tab.${tab}`)}
            </button>
          ))}
        </div>

        <FilterBar hasActiveFilters={active !== ''} onClear={() => patch({ active: null })}>
          <Select
            aria-label={t('common.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('administration.status.filterAll')}</option>
            <option value="true">{t('administration.status.filterActive')}</option>
            <option value="false">{t('administration.status.filterInactive')}</option>
          </Select>
        </FilterBar>

        <div className={BOARD_TABLE_FILL}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={list.isLoading}
            error={list.isError ? list.error : undefined}
            onRetry={() => void list.refetch()}
            sort={sort}
            onSortChange={changeSort}
            empty={t(`administration.catalogs.${kind}.empty`)}
            stickyHead
          />
        </div>
        {list.data !== undefined && list.data.meta.totalItems > 0 && (
          <Pagination
            meta={list.data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <UnitDialog
        open={(creating && kind === 'unit') || editingUnit !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        unit={editingUnit}
      />
      <ItemCategoryDialog
        open={(creating && kind === 'category') || editingCategory !== null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        category={editingCategory}
      />
    </PageContainer>
  );
};
