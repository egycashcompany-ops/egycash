// Operations reference data (B1) — the replacement for the legacy `/data_edit` screen.
//
// WHAT THE LEGACY SCREEN ACTUALLY DID (discovery §F, contad_app.js:1753-2227): one page holding
// four add-forms and three delete-forms for banks, branches, currencies and cities. The three
// deletes matched rows **by their Arabic name**, wrote three differently-named/typed timestamp
// fields, and performed no referential check whatsoever (quirks Q22, Q34).
//
// WHAT THIS SCREEN DOES INSTEAD, and why:
//   · Banks / branches / currencies are the three kinds Operations actually joins on. **Cities are
//     deliberately absent**: no Operations query reads them (they were governorate reference data
//     for a different screen), so migrating them here would import scope the domain does not own.
//   · Rows deactivate rather than delete. Legacy soft-deleted with no referential check, which
//     silently removed a bank from future pickers while historical reports kept grouping on its
//     stale name string. `isActive` says the same thing honestly.
//   · Identity is the row id, never the Arabic name (Q34 NORMALIZE).
//
// URL-synced tabs, exactly like the fleet catalogs screen, so an operator can bookmark a kind.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  type OperationsBankBranchDto,
  type OperationsBankDto,
  type OperationsCurrencyDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import {
  useOperationsBankBranches,
  useOperationsBanks,
  useOperationsCurrencies,
} from '../api/operations-queries';
import { BankBranchDialog, BankDialog, CurrencyDialog } from '../components/CatalogDialogs';

const DEFAULT_PAGE_SIZE = 25;

export const OPERATIONS_CATALOG_KINDS = ['banks', 'branches', 'currencies'] as const;
export type OperationsCatalogKind = (typeof OPERATIONS_CATALOG_KINDS)[number];

/** Unknown or absent `?kind=` falls back to banks — the kind everything else references. */
export const resolveCatalogKind = (raw: string | null): OperationsCatalogKind =>
  (OPERATIONS_CATALOG_KINDS as readonly string[]).includes(raw ?? '')
    ? (raw as OperationsCatalogKind)
    : 'banks';

export const CatalogsPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();

  const kind = resolveCatalogKind(sp.get('kind'));
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const paramsKey = sp.toString();

  const patchParams = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const params = useMemo(() => ({ page, pageSize }), [paramsKey]);

  // Only the active tab's query runs; the other two stay idle rather than pre-fetching a screen
  // the operator may never open.
  const banks = useOperationsBanks(params, kind === 'banks');
  const branches = useOperationsBankBranches(params, kind === 'branches');
  const currencies = useOperationsCurrencies(params, kind === 'currencies');

  // Branch rows name their bank, so the bank list is needed on the branches tab too.
  const bankOptions = useOperationsBanks({ page: 1, pageSize: 200, sortBy: 'code', sortDir: 'asc' });

  const [editingBank, setEditingBank] = useState<OperationsBankDto | null>(null);
  const [editingBranch, setEditingBranch] = useState<OperationsBankBranchDto | null>(null);
  const [editingCurrency, setEditingCurrency] = useState<OperationsCurrencyDto | null>(null);
  const [creating, setCreating] = useState(false);

  const bankName = (bankId: string): string =>
    bankOptions.data?.items.find((bank) => bank.id === bankId)?.opsName ?? '—';

  const bankColumns: Column<OperationsBankDto>[] = [
    { key: 'code', header: t('operations.catalogs.bank.code'), render: (row) => row.code },
    { key: 'opsName', header: t('operations.catalogs.bank.opsName'), render: (row) => row.opsName },
    { key: 'nameAr', header: t('operations.catalogs.bank.nameAr'), render: (row) => row.name.ar },
    {
      key: 'sortOrder',
      header: t('operations.catalogs.bank.sortOrder'),
      render: (row) => row.sortOrder ?? '—',
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => (
        <StatusBadge
          tone={row.isActive ? 'success' : 'neutral'}
          label={t(row.isActive ? 'operations.common.active' : 'operations.common.inactive')}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button
          type="button"
          aria-label={t('common.edit')}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          onClick={() => setEditingBank(row)}
        >
          <EditIcon className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const branchColumns: Column<OperationsBankBranchDto>[] = [
    { key: 'code', header: t('operations.catalogs.branch.code'), render: (row) => row.code },
    { key: 'name', header: t('operations.catalogs.branch.name'), render: (row) => row.name },
    {
      key: 'bank',
      header: t('operations.catalogs.branch.bank'),
      render: (row) => bankName(row.bankId),
    },
    {
      key: 'opsArea',
      header: t('operations.catalogs.branch.opsArea'),
      render: (row) => row.opsAreaName ?? '—',
    },
    {
      key: 'financeArea',
      header: t('operations.catalogs.branch.financeArea'),
      render: (row) => row.financeAreaName ?? '—',
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => (
        <StatusBadge
          tone={row.isActive ? 'success' : 'neutral'}
          label={t(row.isActive ? 'operations.common.active' : 'operations.common.inactive')}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button
          type="button"
          aria-label={t('common.edit')}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          onClick={() => setEditingBranch(row)}
        >
          <EditIcon className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const currencyColumns: Column<OperationsCurrencyDto>[] = [
    { key: 'code', header: t('operations.catalogs.currency.code'), render: (row) => row.code },
    { key: 'name', header: t('operations.catalogs.currency.name'), render: (row) => row.name },
    {
      key: 'aliases',
      header: t('operations.catalogs.currency.aliases'),
      render: (row) => (row.legacyAliases.length === 0 ? '—' : row.legacyAliases.join('، ')),
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      render: (row) => (
        <StatusBadge
          tone={row.isActive ? 'success' : 'neutral'}
          label={t(row.isActive ? 'operations.common.active' : 'operations.common.inactive')}
        />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <button
          type="button"
          aria-label={t('common.edit')}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          onClick={() => setEditingCurrency(row)}
        >
          <EditIcon className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const activeMeta =
    kind === 'banks'
      ? banks.data?.meta
      : kind === 'branches'
        ? branches.data?.meta
        : currencies.data?.meta;

  return (
    <PageContainer>
      <PageHeader
        title={t('operations.catalogs.title')}
        description={t('operations.catalogs.subtitle')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" />
            {t(`operations.catalogs.${kind === 'branches' ? 'branch' : kind === 'banks' ? 'bank' : 'currency'}.add`)}
          </Button>
        }
      />

      <div className="mb-4 flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {OPERATIONS_CATALOG_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => patchParams({ kind: option })}
            className={
              option === kind
                ? 'border-b-2 border-brand-500 px-4 py-2 text-sm font-medium text-brand-600 dark:text-brand-400'
                : 'px-4 py-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400'
            }
            aria-current={option === kind ? 'page' : undefined}
          >
            {t(`operations.catalogs.tab.${option}`)}
          </button>
        ))}
      </div>

      {kind === 'banks' && (
        <DataTable
          columns={bankColumns}
          rows={banks.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={banks.isLoading}
          error={banks.error}
          onRetry={() => void banks.refetch()}
          empty={t('operations.catalogs.bank.empty')}
        />
      )}
      {kind === 'branches' && (
        <DataTable
          columns={branchColumns}
          rows={branches.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={branches.isLoading}
          error={branches.error}
          onRetry={() => void branches.refetch()}
          empty={t('operations.catalogs.branch.empty')}
        />
      )}
      {kind === 'currencies' && (
        <DataTable
          columns={currencyColumns}
          rows={currencies.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={currencies.isLoading}
          error={currencies.error}
          onRetry={() => void currencies.refetch()}
          empty={t('operations.catalogs.currency.empty')}
        />
      )}

      {activeMeta !== undefined && (
        <Pagination
          meta={activeMeta}
          onPageChange={(next) => patchParams({ page: String(next) }, false)}
          onPageSizeChange={(size) => patchParams({ size: String(size) })}
        />
      )}

      <BankDialog
        open={editingBank !== null || (creating && kind === 'banks')}
        bank={editingBank}
        onClose={() => {
          setEditingBank(null);
          setCreating(false);
        }}
      />
      <BankBranchDialog
        open={editingBranch !== null || (creating && kind === 'branches')}
        branch={editingBranch}
        banks={bankOptions.data?.items ?? []}
        onClose={() => {
          setEditingBranch(null);
          setCreating(false);
        }}
      />
      <CurrencyDialog
        open={editingCurrency !== null || (creating && kind === 'currencies')}
        currency={editingCurrency}
        onClose={() => {
          setEditingCurrency(null);
          setCreating(false);
        }}
      />
    </PageContainer>
  );
};
