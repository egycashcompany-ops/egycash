// The consumables register (FR-20) — «وعايز بقى شاشة تانية تحت خطوط المحمول تكون للمستهلكات زي:
// حبارات - كابلات بأنواعها - كونفرترات (محولات) بأنواعها - ماوس - كيبرود - رامات - هاردات -
// فلاشات - وهكذا .. وأقدر أحدد عندي Stock إيه من كل واحده وإيه الهالك وأتبدل لمين واطبعله مذكره».
//
// One row per item PER BRANCH — each branch keeps its own stock — with what its store holds now,
// what it has issued and what was scrapped. Those three are the server's, denormalized from the
// ledger by the very write that moves them; nothing here adds or subtracts. An item at or below
// its own minimum is marked in the row: its figure in the warning colour AND a word beside it,
// since a colour alone says nothing to a reader who cannot tell it apart.
//
// Every action is a named movement, offered where the reader's grant allows it — the assets'
// grants (`itAsset.*`), no key of its own — and where the item allows it: an issue and a scrap
// need something on hand, and a retired item takes no new stock and is issued to nobody (a scrap
// or a return it still takes: what was already out comes back, what breaks is written off). «صرف لموظف» in the header
// starts an empty memo; the row's «صرف» starts it with that item. «سجل الحركات» is the ledger of
// every item, a screen of its own.
//
// URL-synced like every IT register — a filtered view is a link, and the filters are remembered
// across visits. Excel and PDF, before the screen's own actions, as on the other registers: every
// item the filters match, in the table's order (`lib/consumable-register-export.ts`).
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type ItConsumableDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Badge } from '../../../shared/ui/Badge';
import { Button } from '../../../shared/ui/Button';
import { Checkbox, Select } from '../../../shared/ui/form';
import {
  DownloadIcon,
  EditIcon,
  HistoryIcon,
  PlusIcon,
  ResetIcon,
  TrashIcon,
  UsersIcon,
} from '../../../shared/ui/icons';
import { cn } from '../../../shared/lib/cn';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import * as api from '../api/it-api';
import { useItBranchOptions, useItCatalog, useItConsumables } from '../api/it-queries';
import { ItCatalogSelect } from '../components/ItCatalogSelect';
import { RegisterExportButtons } from '../components/RegisterExportButtons';
import {
  ConsumableFormDialog,
  ConsumableMovementsDialog,
  IssueConsumablesDialog,
  ReceiveConsumableDialog,
  ReturnConsumableDialog,
  ScrapConsumableDialog,
} from '../components/ConsumableDialogs';
import { saveSheet } from '../../fleet/lib/fleet-sheet';
import {
  consumableRegisterFilters,
  consumableRegisterHeader,
  consumableRegisterLine,
  consumableRegisterReport,
  consumableRegisterSubtitle,
} from '../lib/consumable-register-export';
import { gatherRegister, printItRegister } from '../lib/register-export';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['active', 'belowMin', 'branch', 'q', 'size', 'sort', 'type'] as const;

const DEFAULT_PAGE_SIZE = 25;

type ItemDialog =
  | { kind: 'create' }
  | { kind: 'issue'; item: ItConsumableDto | null }
  | {
      kind: 'edit' | 'receive' | 'scrap' | 'return' | 'movements';
      item: ItConsumableDto;
    };

type RowAction = 'receive' | 'issue' | 'scrap' | 'return' | 'edit' | 'movements';

export const ConsumablesPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const search = sp.get('q') ?? '';
  const typeId = sp.get('type') ?? '';
  const branchId = sp.get('branch') ?? '';
  const belowMin = sp.get('belowMin') === 'true';
  // The active items by default: a retired item is no longer stock anybody issues from. «all»
  // shows both, «false» the retired ones only.
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
  const hasActiveFilters =
    search !== '' || typeId !== '' || branchId !== '' || belowMin || active !== 'true';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...(sort === null ? {} : { sortBy: sort.by, sortDir: sort.dir }),
      search: search.trim() || undefined,
      typeId: typeId || undefined,
      branchId: branchId || undefined,
      belowMin: belowMin || undefined,
      active: active === 'all' ? undefined : active !== 'false',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItConsumables(params);
  const rows = data?.items ?? [];

  const branches = useItBranchOptions();
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);
  // The types' names — the column's, the file's and the printed filter line's; the type filter
  // reads the same cached list.
  const types = useItCatalog('consumableType');
  const typeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of types.data?.items ?? []) map.set(type.id, localized(type.name, locale));
    return map;
  }, [types.data, locale]);

  const [dialog, setDialog] = useState<ItemDialog | null>(null);
  const close = (): void => setDialog(null);

  // ── The register as a file: Excel and PDF, of everything the filters match ──────────────────
  const exportContext = { t, locale, branchName, typeName };
  // Every item the filters match, in the table's order — the table's own params, unpaged.
  const allRows = () => gatherRegister(params, api.listConsumables);
  const toExcel = async (): Promise<void> => {
    const all = await allRows();
    saveSheet({
      name: t('it.nav.consumables'),
      serialHeader: t('it.export.serial'),
      header: consumableRegisterHeader(t),
      rows: all.map((row) => consumableRegisterLine(row, exportContext, '')),
    });
  };
  const toPdf = (): Promise<boolean> =>
    printItRegister(async () => {
      const all = await allRows();
      const subtitle = consumableRegisterSubtitle(t, {
        ...consumableRegisterFilters({
          active,
          typeId,
          typeName,
          branchId,
          branchName,
          belowMin,
          search,
        }),
        asOf: formatDate(new Date().toISOString(), locale),
      });
      return consumableRegisterReport(all, exportContext, subtitle);
    }, t('it.export.preparing'));

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';
  const action = (
    item: ItConsumableDto,
    kind: RowAction,
    label: string,
    icon: JSX.Element,
  ): JSX.Element => (
    <button
      type="button"
      data-consumable-action={kind}
      className={actionButton}
      aria-label={`${label} — ${item.name}`}
      title={label}
      onClick={() => setDialog({ kind, item })}
    >
      {icon}
    </button>
  );

  const quantity = (value: number): JSX.Element => (
    <span className="tabular-nums">{formatNumber(value, locale)}</span>
  );

  const columns: Column<ItConsumableDto>[] = [
    {
      key: 'code',
      header: t('it.consumables.columns.code'),
      sortable: true,
      render: (item) => (
        <span className="font-mono text-xs" dir="ltr">
          {item.code}
        </span>
      ),
    },
    {
      key: 'name',
      header: t('it.consumables.columns.name'),
      sortable: true,
      render: (item) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{item.name}</span>
          {!item.active && (
            <Badge size="sm" tone="neutral">
              {t('it.consumables.state.inactive')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      // Ordered by the type's NAME, which the server joins from the catalog before it pages.
      key: 'type',
      sortKey: 'typeName',
      header: t('it.consumables.columns.type'),
      sortable: true,
      render: (item) => typeName.get(item.typeId) ?? '—',
    },
    {
      key: 'branch',
      header: t('it.assets.columns.branch'),
      render: (item) => branchName.get(item.branchId) ?? '—',
    },
    {
      key: 'unit',
      header: t('it.consumables.columns.unit'),
      sortable: true,
      render: (item) => item.unit,
    },
    {
      key: 'onHandQty',
      header: t('it.consumables.columns.onHand'),
      sortable: true,
      render: (item) => (
        <span className="flex flex-wrap items-center gap-1.5" data-below-min={item.belowMin}>
          <span
            className={cn(
              'tabular-nums',
              item.belowMin && 'font-semibold text-amber-700 dark:text-amber-400',
            )}
          >
            {formatNumber(item.onHandQty, locale)}
          </span>
          {item.belowMin && (
            <Badge size="sm" tone="warning">
              {t('it.consumables.belowMin')}
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'issuedQty',
      header: t('it.consumables.columns.issued'),
      sortable: true,
      render: (item) => quantity(item.issuedQty),
    },
    {
      // The damaged units issues replaced are scrap too, though they never sat on the shelf.
      key: 'scrappedQty',
      header: t('it.consumables.columns.scrapped'),
      sortable: true,
      render: (item) => quantity(item.scrappedQty),
    },
    {
      key: 'minQty',
      header: t('it.consumables.columns.minQty'),
      sortable: true,
      render: (item) => (item.minQty === null ? '—' : quantity(item.minQty)),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (item) => (
        <span className="flex flex-wrap items-center justify-end gap-1">
          {can('itAsset.edit') &&
            item.active &&
            action(
              item,
              'receive',
              t('it.consumables.actions.receive'),
              <DownloadIcon className="h-4 w-4" />,
            )}
          {can('itAsset.assign') &&
            item.active &&
            item.onHandQty > 0 &&
            action(
              item,
              'issue',
              t('it.consumables.actions.issue'),
              <UsersIcon className="h-4 w-4" />,
            )}
          {can('itAsset.edit') &&
            item.onHandQty > 0 &&
            action(
              item,
              'scrap',
              t('it.consumables.actions.scrap'),
              <TrashIcon className="h-4 w-4" />,
            )}
          {can('itAsset.assign') &&
            action(
              item,
              'return',
              t('it.consumables.actions.return'),
              <ResetIcon className="h-4 w-4" />,
            )}
          {can('itAsset.edit') &&
            action(item, 'edit', t('it.consumables.edit'), <EditIcon className="h-4 w-4" />)}
          {action(
            item,
            'movements',
            t('it.consumables.actions.movements'),
            <HistoryIcon className="h-4 w-4" />,
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.consumables')}
        breadcrumbs={[
          { label: t('it.module.title'), to: '/it' },
          { label: t('it.nav.consumables') },
        ]}
        actions={
          <>
            {/* The files first, the screen's own actions after them, as on the other registers.
                Not offered when the list failed: the file behind them would be short. */}
            {!isError && (
              <RegisterExportButtons name="it-consumables" onExcel={toExcel} onPdf={toPdf} />
            )}
            <Link
              to="/it/consumables/movements"
              data-consumables-movements
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <HistoryIcon className="h-4 w-4" />
              {t('it.consumables.movementsLink')}
            </Link>
            <Can permission="itAsset.assign">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<UsersIcon className="h-4 w-4" />}
                onClick={() => setDialog({ kind: 'issue', item: null })}
              >
                {t('it.consumables.issueAction')}
              </Button>
            </Can>
            <Can permission="itAsset.create">
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setDialog({ kind: 'create' })}
              >
                {t('it.consumables.create')}
              </Button>
            </Can>
          </>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ q: null, type: null, branch: null, belowMin: null, active: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('it.consumables.searchPlaceholder')}
            className="w-64"
          />
          <ItCatalogSelect
            kind="consumableType"
            value={typeId}
            onChange={(id) => patch({ type: id || null })}
            allLabel={t('it.consumables.allTypes')}
            ariaLabel={t('it.consumables.columns.type')}
          />
          <Select
            aria-label={t('it.assets.columns.branch')}
            value={branchId}
            onChange={(e) => patch({ branch: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.assets.allBranches')}</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {localized(branch.name, locale)}
              </option>
            ))}
          </Select>
          {/* The row's highlight as a filter: only what has reached its own minimum. */}
          <Checkbox
            checked={belowMin}
            onChange={(e) => patch({ belowMin: e.target.checked ? 'true' : null })}
            label={t('it.consumables.belowMinOnly')}
            className="self-center"
          />
          <Select
            aria-label={t('it.assets.columns.status')}
            value={active}
            onChange={(e) => patch({ active: e.target.value === 'true' ? null : e.target.value })}
            className="w-auto"
          >
            <option value="true">{t('it.consumables.filterActive')}</option>
            <option value="false">{t('it.consumables.filterInactive')}</option>
            <option value="all">{t('it.consumables.filterAllStates')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(item) => item.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          {...(sort === null ? {} : { sort })}
          onSortChange={changeSort}
          empty={t('it.consumables.empty')}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <ConsumableFormDialog
        open={dialog?.kind === 'create' || dialog?.kind === 'edit'}
        onClose={close}
        item={dialog !== null && dialog.kind === 'edit' ? dialog.item : null}
      />
      {dialog !== null && dialog.kind === 'issue' && (
        <IssueConsumablesDialog open onClose={close} item={dialog.item} />
      )}
      {dialog !== null && dialog.kind === 'receive' && (
        <ReceiveConsumableDialog open onClose={close} item={dialog.item} />
      )}
      {dialog !== null && dialog.kind === 'scrap' && (
        <ScrapConsumableDialog open onClose={close} item={dialog.item} />
      )}
      {dialog !== null && dialog.kind === 'return' && (
        <ReturnConsumableDialog open onClose={close} item={dialog.item} />
      )}
      {dialog !== null && dialog.kind === 'movements' && (
        <ConsumableMovementsDialog open onClose={close} item={dialog.item} />
      )}
    </PageContainer>
  );
};
