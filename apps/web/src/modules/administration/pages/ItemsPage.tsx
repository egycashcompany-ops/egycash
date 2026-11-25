// The item register «الأصناف» (design §2.3.4, §19.5): the company's one item master — what the
// stores keep, each item filed under a category and counted in its base unit. Written after IT's
// `ConsumablesPage`, in the board frame (OD-83 B): on a computer the title, its action and the
// filters keep their place, the pager keeps its place below, and only the rows scroll.
//
// No stock figure and no movement: an item carries none (ADR-024) — stock arrives with the ledger
// (P5). A row opens its item's page; the row's own edit opens the form here, and stops the click so
// it never also opens the page. An item is retired through its form, never deleted (§5.3).
//
// Every filter narrows the SERVER's answer: the search reads the code, both names and the barcode
// (a scan finds its item), and a top-level category reads its subcategories' items too (§19.4).
// URL-synced — a filtered view is a link — and remembered across visits.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type AdministrationItemDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { RowActions } from '../../../shared/ui/RowActions';
import { Select } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { localized } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAdministrationItems } from '../api/catalog-queries';
import { CatalogSelect } from '../components/CatalogSelect';
import { ItemFormDialog, itemCategoryLabel } from '../components/ItemFormDialog';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['active', 'category', 'q', 'size', 'sort', 'unit'] as const;

const DEFAULT_PAGE_SIZE = 25;

export const ItemsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const search = sp.get('q') ?? '';
  const categoryId = sp.get('category') ?? '';
  const unitId = sp.get('unit') ?? '';
  // The live items by default: a retired item is kept for the records that name it, not offered.
  // «all» shows both, «false» the retired ones only.
  const active = sp.get('active') ?? 'true';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  // No sort chosen is the register's own order, which the server keeps when no `sortBy` is sent.
  const sortParam = sp.get('sort') ?? '';
  const [sortByRaw, sortDirRaw] = sortParam.split(':');
  const sort =
    sortParam === '' || sortByRaw === undefined || sortByRaw === ''
      ? null
      : { by: sortByRaw, dir: sortDirRaw === 'desc' ? ('desc' as const) : ('asc' as const) };
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
    const dir = sort !== null && sort.by === by && sort.dir === 'asc' ? 'desc' : 'asc';
    patch({ sort: `${by}:${dir}` }, false);
  };
  const hasActiveFilters = search !== '' || categoryId !== '' || unitId !== '' || active !== 'true';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...(sort === null ? {} : { sortBy: sort.by, sortDir: sort.dir }),
      search: search.trim() || undefined,
      categoryId: categoryId || undefined,
      unitId: unitId || undefined,
      isActive: active === 'all' ? undefined : active !== 'false',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useAdministrationItems(params);

  const [dialog, setDialog] = useState<{ item: AdministrationItemDto | null } | null>(null);

  const columns: Column<AdministrationItemDto>[] = [
    {
      key: 'code',
      header: t('administration.items.columns.code'),
      sortable: true,
      render: (item) => (
        <span className="font-mono text-xs" dir="ltr">
          {item.code}
        </span>
      ),
    },
    {
      key: 'name',
      sortKey: 'name.ar',
      header: t('administration.items.columns.name'),
      sortable: true,
      render: (item) => localized(item.name, locale),
    },
    {
      key: 'barcode',
      header: t('administration.items.columns.barcode'),
      render: (item) =>
        item.barcode === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {item.barcode}
          </span>
        ),
    },
    {
      key: 'category',
      header: t('administration.items.columns.category'),
      render: (item) => itemCategoryLabel(item, locale) ?? '—',
    },
    {
      key: 'unit',
      header: t('administration.items.columns.unit'),
      render: (item) => (item.unitName === null ? '—' : localized(item.unitName, locale)),
    },
    {
      key: 'status',
      header: t('administration.items.columns.status'),
      render: (item) => (
        <StatusBadge
          tone={item.isActive ? 'success' : 'neutral'}
          label={t(
            item.isActive ? 'administration.status.active' : 'administration.status.inactive',
          )}
        />
      ),
    },
    {
      key: 'actions',
      header: t('administration.items.columns.actions'),
      align: 'end',
      render: (item) =>
        can('administrationItem.edit') ? (
          // The row opens the item; its own button must not also open it.
          <span className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <RowActions>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${t('administration.items.edit')} — ${localized(item.name, locale)}`}
                title={t('administration.items.edit')}
                onClick={() => setDialog({ item })}
              >
                <EditIcon className="h-4 w-4" />
              </Button>
            </RowActions>
          </span>
        ) : null,
    },
  ];

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        <PageHeader
          title={t('administration.nav.items')}
          breadcrumbs={[
            { label: t('administration.module.title'), to: '/administration' },
            { label: t('administration.nav.items') },
          ]}
          actions={
            <Can permission="administrationItem.create">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setDialog({ item: null })}
              >
                {t('administration.items.create')}
              </Button>
            </Can>
          }
        />

        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ q: null, category: null, unit: null, active: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('administration.items.searchPlaceholder')}
            className="w-64"
          />
          <div className="w-56">
            <CatalogSelect
              kind="category"
              mode="filter"
              value={categoryId}
              onChange={(id) => patch({ category: id || null })}
              placeholder={t('administration.items.allCategories')}
              ariaLabel={t('administration.items.columns.category')}
            />
          </div>
          <div className="w-44">
            <CatalogSelect
              kind="unit"
              value={unitId}
              onChange={(id) => patch({ unit: id || null })}
              placeholder={t('administration.items.allUnits')}
              ariaLabel={t('administration.items.columns.unit')}
            />
          </div>
          <Select
            aria-label={t('administration.items.columns.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value === 'true' ? null : e.target.value })}
            className="w-auto"
          >
            <option value="true">{t('administration.status.filterActive')}</option>
            <option value="false">{t('administration.status.filterInactive')}</option>
            <option value="all">{t('administration.status.filterAll')}</option>
          </Select>
        </FilterBar>

        <div className={BOARD_TABLE_FILL}>
          <DataTable
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(item) => item.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            {...(sort === null ? {} : { sort })}
            onSortChange={changeSort}
            onRowClick={(item) => navigate(`/administration/items/${item.id}`)}
            empty={t('administration.items.empty')}
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
      </div>

      <ItemFormDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        item={dialog?.item ?? null}
      />
    </PageContainer>
  );
};
