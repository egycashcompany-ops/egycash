// The warehouse register «المخازن» (design §2.3.5, §19.5): the stores of each branch, read
// fail-closed — the reader sees the branches their `administrationWarehouse.view` reaches, under
// the top bar's choice (§7.2). Written after IT's `ConsumablesPage`, in the board frame (OD-83 B).
//
// THE BRANCH FILTER offers what the server says the reader may read (`canView` of
// `/administration/warehouses/branch-options`), named and ordered as the top bar names them — the
// web cannot work out a key's reach per branch. A remembered or linked branch the server no longer
// offers (the top bar moved since) is dropped once the options answer, and the list waits for them
// rather than asking for a branch that would answer 400 (ATM's register, «الفروع فوق خالص فى البار
// بتاع السيستم غير اللى فى الفلاتر»).
//
// A row's edit is offered when the server says the edit would be taken (`canEdit`): `can()` is
// blind to scope, so a key held for another branch would offer an edit the server refuses. «Add»
// is held the same way: offered only while some branch takes a new store (`canCreate`) — the top
// bar narrowed to a branch the create key does not reach, or options that could not be read, would
// open a form whose branch box offers nothing. A store retires through its form, never deleted
// (§5.3). Its keeper is shown as HR answers today: a keeper
// who has left is marked, and one HR no longer knows is flagged until a keeper is named again
// (OD-64 keeper (i)).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ADMINISTRATION_WAREHOUSE_TYPES,
  type AdministrationWarehouseBranchOptionDto,
  type AdministrationWarehouseDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
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
import { useAdministrationWarehouses, useWarehouseBranchOptions } from '../api/warehouses-queries';
import { WarehouseFormDialog } from '../components/WarehouseFormDialog';
import { isWarehouseType } from '../lib/warehouse-form';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['active', 'branch', 'q', 'size', 'sort', 'type'] as const;

const DEFAULT_PAGE_SIZE = 25;

/** The branches the register's filter offers: those the reader's view reaches, as the server says. */
export const viewableBranches = (
  options: readonly AdministrationWarehouseBranchOptionDto[] | undefined,
): AdministrationWarehouseBranchOptionDto[] => (options ?? []).filter((option) => option.canView);

/**
 * A branch filter the server no longer offers — never judged before the options answer, when
 * nothing is known yet about which branches the reader may read.
 */
export const strayBranch = (
  options: readonly AdministrationWarehouseBranchOptionDto[] | undefined,
  value: string,
): boolean =>
  options !== undefined &&
  value !== '' &&
  !viewableBranches(options).some((option) => option.branchId === value);

/** The keeper's cell: who, as HR answers today — or why nobody is named. */
const KeeperCell = ({ warehouse }: { warehouse: AdministrationWarehouseDto }): JSX.Element => {
  const t = useT();
  if (warehouse.responsibleEmployeeId === null) return <>—</>;
  if (warehouse.keeper === null) {
    return (
      <span className="text-sm text-amber-700 dark:text-amber-400" data-keeper-unknown="">
        {t('administration.warehouses.keeperUnknown')}
      </span>
    );
  }
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <span>{warehouse.keeper.fullNameAr}</span>
        {warehouse.keeper.status === 'exited' && (
          <Badge size="sm" tone="warning">
            {t('administration.people.exited')}
          </Badge>
        )}
      </span>
      <span className="font-mono text-xs text-slate-500 dark:text-slate-400" dir="ltr">
        {warehouse.keeper.code}
      </span>
    </span>
  );
};

/** Whether «add» may open the form: the create key, and a branch the server says takes a store. */
export const canOpenWarehouse = (
  canCreateKey: boolean,
  options: readonly AdministrationWarehouseBranchOptionDto[] | undefined,
): boolean => canCreateKey && (options ?? []).some((option) => option.canCreate);

export const WarehousesPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const search = sp.get('q') ?? '';
  const branchId = sp.get('branch') ?? '';
  const typeParam = sp.get('type') ?? '';
  const type = isWarehouseType(typeParam) ? typeParam : '';
  // The live stores by default; «all» shows both, «false» the retired ones only.
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
  const hasActiveFilters = search !== '' || branchId !== '' || type !== '' || active !== 'true';

  const branches = useWarehouseBranchOptions();
  // A branch the server no longer offers goes — replacing the history entry, so Back never returns
  // to a view that answered nothing; the remembered view then records the corrected one.
  useEffect(() => {
    if (!strayBranch(branches.data, branchId)) return;
    const next = new URLSearchParams(sp);
    for (const key of ['branch', 'page']) next.delete(key);
    setSp(next, { replace: true });
  }, [branches.data, branchId]);
  // Until the options answer, a branch filter is not asked for: it may be one the reader no longer
  // reaches, which the server answers with a 400 rather than rows. If they cannot be read at all,
  // the list is asked as the URL says, so the page shows the server's answer — rows or the error
  // panel with its retry — rather than loading for ever.
  const branchSettled =
    branchId === '' ||
    branches.isError ||
    (branches.data !== undefined && !strayBranch(branches.data, branchId));

  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...(sort === null ? {} : { sortBy: sort.by, sortDir: sort.dir }),
      search: search.trim() || undefined,
      branchId: branchId || undefined,
      type: type || undefined,
      isActive: active === 'all' ? undefined : active !== 'false',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useAdministrationWarehouses(
    params,
    branchSettled,
  );

  const [dialog, setDialog] = useState<{ warehouse: AdministrationWarehouseDto | null } | null>(
    null,
  );

  const columns: Column<AdministrationWarehouseDto>[] = [
    {
      key: 'code',
      header: t('administration.warehouses.columns.code'),
      sortable: true,
      render: (row) => (
        <span className="font-mono text-xs" dir="ltr">
          {row.code}
        </span>
      ),
    },
    {
      key: 'name',
      sortKey: 'name.ar',
      header: t('administration.warehouses.columns.name'),
      sortable: true,
      render: (row) => localized(row.name, locale),
    },
    {
      key: 'branch',
      header: t('administration.warehouses.columns.branch'),
      render: (row) => (row.branchName === null ? '—' : localized(row.branchName, locale)),
    },
    {
      key: 'type',
      header: t('administration.warehouses.columns.type'),
      render: (row) => t(`administration.warehouses.type.${row.type}`),
    },
    {
      key: 'keeper',
      header: t('administration.warehouses.columns.keeper'),
      render: (row) => <KeeperCell warehouse={row} />,
    },
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
      header: t('administration.warehouses.columns.actions'),
      align: 'end',
      render: (row) =>
        row.canEdit ? (
          <RowActions className="justify-end">
            <Button
              size="icon"
              variant="ghost"
              aria-label={`${t('administration.warehouses.edit')} — ${localized(row.name, locale)}`}
              title={t('administration.warehouses.edit')}
              onClick={() => setDialog({ warehouse: row })}
            >
              <EditIcon className="h-4 w-4" />
            </Button>
          </RowActions>
        ) : null,
    },
  ];

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        <PageHeader
          title={t('administration.nav.warehouses')}
          breadcrumbs={[
            { label: t('administration.module.title'), to: '/administration' },
            { label: t('administration.nav.warehouses') },
          ]}
          actions={
            canOpenWarehouse(can('administrationWarehouse.create'), branches.data) ? (
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setDialog({ warehouse: null })}
              >
                {t('administration.warehouses.create')}
              </Button>
            ) : undefined
          }
        />

        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ q: null, branch: null, type: null, active: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('administration.warehouses.searchPlaceholder')}
            className="w-64"
          />
          <Select
            aria-label={t('administration.warehouses.columns.branch')}
            value={branchId}
            onChange={(e) => patch({ branch: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('administration.warehouses.allBranches')}</option>
            {viewableBranches(branches.data).map((branch) => (
              <option key={branch.branchId} value={branch.branchId}>
                {localized(branch.name, locale)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('administration.warehouses.columns.type')}
            value={type}
            onChange={(e) => patch({ type: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('administration.warehouses.allTypes')}</option>
            {ADMINISTRATION_WAREHOUSE_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`administration.warehouses.type.${value}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('common.status')}
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
            rowKey={(row) => row.id}
            loading={isLoading || !branchSettled}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            {...(sort === null ? {} : { sort })}
            onSortChange={changeSort}
            empty={t('administration.warehouses.empty')}
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

      <WarehouseFormDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        warehouse={dialog?.warehouse ?? null}
      />
    </PageContainer>
  );
};
