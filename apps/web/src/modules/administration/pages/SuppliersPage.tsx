// The supplier register «الموردون» (design §2.3.6, §19.5): the company's one list of the parties it
// buys from (OD-01 C, ADR-040) — IT's vendors and Fleet's workshops stay where they are. Written
// after IT's `ConsumablesPage`, as the module's item register is, in the board frame (OD-83 B): on
// a computer the title, its action and the filters keep their place, the pager keeps its place
// below, and only the rows scroll.
//
// A PHONE IS MASKED HERE (§6.8, §13.6 B): a list shows `010****5678`, and the record's own page
// shows the number whole. The code and the masked phone never break across lines: the table
// scrolls sideways on a phone instead. No phone ever travels in the URL — the search reads the code and the
// names only. A row opens its supplier's page; the row's own edit opens the form here, and stops
// the click so it never also opens the page. A supplier is retired through its form, never deleted.
//
// Every filter narrows the SERVER's answer: the search reads the code and both names (another
// spelling of the Arabic one too), and a top-level category reads its subcategories' suppliers
// too (§19.4). The category filter needs the categories' read, which `administrationSupplier.view`
// alone does not open (§19.3: only the supplier write keys join it), so a reader without it sees
// the category names on the rows and no category filter. URL-synced and remembered across visits.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type AdministrationSupplierDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan, useHasAnyPermission } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../../shared/ui/board-scroll';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Badge, StatusBadge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { RowActions } from '../../../shared/ui/RowActions';
import { Select } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { localized } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAdministrationSuppliers } from '../api/suppliers-queries';
import { CatalogSelect } from '../components/CatalogSelect';
import { SupplierFormDialog } from '../components/SupplierFormDialog';
import { maskPhone, supplierCategoryNames } from '../lib/supplier-view';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['active', 'category', 'q', 'size', 'sort'] as const;

const DEFAULT_PAGE_SIZE = 25;

/** The keys the categories' read admits (`item-category.routes.ts`): who gets a category filter. */
export const CATEGORY_READ_KEYS = [
  'administrationItem.view',
  'administrationCatalog.manage',
  'administrationSupplier.create',
  'administrationSupplier.edit',
];

export const SuppliersPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const canAny = useHasAnyPermission();
  const navigate = useNavigate();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const filtersByCategory = canAny(CATEGORY_READ_KEYS);
  const search = sp.get('q') ?? '';
  // A remembered category is asked for only by a reader who can see the filter that set it.
  const categoryId = filtersByCategory ? (sp.get('category') ?? '') : '';
  // The live suppliers by default: a retired one is kept for the records that name it, not
  // offered. «all» shows both, «false» the retired ones only.
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
  const paramsKey = `${sp.toString()}|${String(filtersByCategory)}`;

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
  const hasActiveFilters = search !== '' || categoryId !== '' || active !== 'true';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...(sort === null ? {} : { sortBy: sort.by, sortDir: sort.dir }),
      search: search.trim() || undefined,
      categoryId: categoryId || undefined,
      isActive: active === 'all' ? undefined : active !== 'false',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useAdministrationSuppliers(params);

  const [dialog, setDialog] = useState<{ supplier: AdministrationSupplierDto | null } | null>(null);

  const columns: Column<AdministrationSupplierDto>[] = [
    {
      key: 'code',
      header: t('administration.suppliers.columns.code'),
      sortable: true,
      render: (supplier) => (
        <span className="whitespace-nowrap font-mono text-xs" dir="ltr">
          {supplier.code}
        </span>
      ),
    },
    {
      key: 'name',
      sortKey: 'name.ar',
      header: t('administration.suppliers.columns.name'),
      sortable: true,
      render: (supplier) => localized(supplier.name, locale),
    },
    {
      key: 'phone',
      header: t('administration.suppliers.columns.phone'),
      render: (supplier) =>
        supplier.phone === null ? (
          '—'
        ) : (
          // bdo, not a dir span: Arabic-Indic digits around the stars would otherwise swap ends.
          <bdo className="whitespace-nowrap tabular-nums" dir="ltr" data-supplier-phone="">
            {maskPhone(supplier.phone)}
          </bdo>
        ),
    },
    {
      key: 'email',
      header: t('administration.suppliers.columns.email'),
      render: (supplier) =>
        supplier.email === null ? '—' : <span dir="ltr">{supplier.email}</span>,
    },
    {
      key: 'categories',
      header: t('administration.suppliers.columns.categories'),
      render: (supplier) => {
        const names = supplierCategoryNames(supplier, locale);
        return names.length === 0 ? (
          '—'
        ) : (
          <span className="flex flex-wrap gap-1">
            {names.map((name, i) => (
              <Badge key={`${name}-${String(i)}`} size="sm" tone="neutral">
                {name}
              </Badge>
            ))}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: t('administration.suppliers.columns.status'),
      render: (supplier) => (
        <StatusBadge
          tone={supplier.isActive ? 'success' : 'neutral'}
          label={t(
            supplier.isActive ? 'administration.status.active' : 'administration.status.inactive',
          )}
        />
      ),
    },
    {
      key: 'actions',
      header: t('administration.suppliers.columns.actions'),
      align: 'end',
      render: (supplier) =>
        can('administrationSupplier.edit') ? (
          // The row opens the supplier; its own button must not also open it.
          <span className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <RowActions>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`${t('administration.suppliers.edit')} — ${localized(supplier.name, locale)}`}
                title={t('administration.suppliers.edit')}
                onClick={() => setDialog({ supplier })}
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
          title={t('administration.nav.suppliers')}
          breadcrumbs={[
            { label: t('administration.module.title'), to: '/administration' },
            { label: t('administration.nav.suppliers') },
          ]}
          actions={
            <Can permission="administrationSupplier.create">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setDialog({ supplier: null })}
              >
                {t('administration.suppliers.create')}
              </Button>
            </Can>
          }
        />

        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ q: null, category: null, active: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('administration.suppliers.searchPlaceholder')}
            className="w-64"
          />
          {filtersByCategory && (
            <div className="w-56">
              <CatalogSelect
                kind="category"
                mode="filter"
                value={categoryId}
                onChange={(id) => patch({ category: id || null })}
                placeholder={t('administration.suppliers.allCategories')}
                ariaLabel={t('administration.suppliers.columns.categories')}
              />
            </div>
          )}
          <Select
            aria-label={t('administration.suppliers.columns.status')}
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
            rowKey={(supplier) => supplier.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            {...(sort === null ? {} : { sort })}
            onSortChange={changeSort}
            onRowClick={(supplier) => navigate(`/administration/suppliers/${supplier.id}`)}
            empty={t('administration.suppliers.empty')}
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

      <SupplierFormDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        supplier={dialog?.supplier ?? null}
      />
    </PageContainer>
  );
};
