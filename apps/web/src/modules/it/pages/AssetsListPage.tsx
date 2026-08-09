// Asset registry (design §2.2, §12) — the module's main screen. URL-synced search + filters +
// sort + pagination over the real IT-1 list API, so a filtered view is a shareable link and the
// back button behaves.
//
// Everything on the row is a SERVER fact: `assetCode` comes from the sequence (FR-1) and the
// status pill from the derived value (FR-2). Nothing here recomputes either. Actions are gated
// exactly as the API gates them, and Delete is offered only where FR-5 could allow it — the
// server still decides, but showing a button that can only ever 409 is worse than not showing it.
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { IT_ASSET_STATUSES, type ItAssetDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Select } from '../../../shared/ui/form';
import { BulkActionBar } from '../../../shared/ui/BulkActionBar';
import { useTableSelection } from '../../../shared/ui/useTableSelection';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, EyeIcon, PlusIcon, QrIcon, TrashIcon } from '../../../shared/ui/icons';
import { localized } from '../../../shared/lib/format';
import { useDeleteItAsset, useItAssets, useItBranchOptions, useItCatalog } from '../api/it-queries';
import { AssetStatusBadge } from '../components/AssetStatusBadge';
import { AssetFormDialog } from '../components/AssetFormDialog';
import { ItCatalogSelect } from '../components/ItCatalogSelect';
import { useAssetLabels } from '../components/useAssetLabels';

const DEFAULT_PAGE_SIZE = 25;

export const AssetsListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const categoryId = sp.get('category') ?? '';
  const branchId = sp.get('branch') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'assetCode:asc').split(':');
  const sort = { by: sortByRaw ?? 'assetCode', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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
  const hasActiveFilters =
    search !== '' || status !== '' || categoryId !== '' || branchId !== '';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      categoryId: categoryId || undefined,
      branchId: branchId || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItAssets(params);
  const rows = data?.items ?? [];

  const categories = useItCatalog('assetCategory');
  const categoryName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of categories.data?.items ?? []) map.set(item.id, localized(item.name, locale));
    return map;
  }, [categories.data, locale]);

  const branches = useItBranchOptions();
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);

  const selection = useTableSelection(rows.map((a) => a.id));
  const labels = useAssetLabels();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ItAssetDto | null>(null);
  const [deleting, setDeleting] = useState<ItAssetDto | null>(null);
  const remove = useDeleteItAsset();

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t('it.assets.deleted'));
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.error'));
    }
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItAssetDto>[] = [
    {
      key: 'assetCode',
      header: t('it.assets.columns.code'),
      sortable: true,
      render: (a) => (
        <span className="font-mono text-xs" dir="ltr">
          {a.assetCode}
        </span>
      ),
    },
    { key: 'name', header: t('it.assets.columns.name'), sortable: true, render: (a) => a.name },
    {
      key: 'category',
      header: t('it.assets.columns.category'),
      render: (a) => categoryName.get(a.categoryId) ?? '—',
    },
    {
      key: 'serialNumber',
      header: t('it.assets.columns.serial'),
      render: (a) =>
        a.serialNumber === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {a.serialNumber}
          </span>
        ),
    },
    {
      key: 'branch',
      header: t('it.assets.columns.branch'),
      render: (a) => branchName.get(a.branchId) ?? '—',
    },
    {
      key: 'status',
      header: t('it.assets.columns.status'),
      sortable: true,
      render: (a) => <AssetStatusBadge status={a.status} />,
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (a) => (
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            className={actionButton}
            aria-label={`${t('it.assets.view')} — ${a.assetCode}`}
            title={t('it.assets.view')}
            onClick={() => navigate(a.id)}
          >
            <EyeIcon className="h-4 w-4" />
          </button>
          {can('itAsset.edit') && a.status !== 'disposed' && (
            <button
              type="button"
              className={actionButton}
              aria-label={`${t('it.assets.edit')} — ${a.assetCode}`}
              title={t('it.assets.edit')}
              onClick={() => {
                setEditing(a);
                setFormOpen(true);
              }}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
          {/* FR-5: only a registered-in-error asset — still in stock, no history — is deletable. */}
          {can('itAsset.delete') && a.status === 'inStock' && (
            <button
              type="button"
              className={actionButton}
              aria-label={`${t('common.delete')} — ${a.assetCode}`}
              title={t('common.delete')}
              onClick={() => setDeleting(a)}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.assets')}
        description={t('it.assets.subtitle')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.assets') }]}
        actions={
          <Can permission="itAsset.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t('it.assets.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ q: null, status: null, category: null, branch: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('it.assets.searchPlaceholder')}
            aria-label={t('it.assets.searchPlaceholder')}
            className="w-64"
          />
          <Select
            aria-label={t('it.assets.columns.status')}
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('it.assets.allStatuses')}</option>
            {IT_ASSET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`it.assets.status.${s}`)}
              </option>
            ))}
          </Select>
          <ItCatalogSelect
            kind="assetCategory"
            value={categoryId}
            onChange={(id) => patch({ category: id || null })}
            allLabel={t('it.assets.allCategories')}
            ariaLabel={t('it.assets.columns.category')}
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
        </FilterBar>

        {/* Labels ride `itAsset.view` by design (§4.2): a label shows nothing a viewer cannot see. */}
        <BulkActionBar count={selection.count} onClear={selection.clear}>
          <Button
            size="sm"
            leftIcon={<QrIcon className="h-4 w-4" />}
            loading={labels.isPrinting}
            onClick={() => void labels.print(selection.ids)}
          >
            {t('it.assets.printLabels')}
          </Button>
        </BulkActionBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(a) => a.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          selection={selection}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <AssetFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        asset={editing}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('it.assets.deleteTitle')}
        description={deleting === null ? '' : `${deleting.assetCode} — ${deleting.name}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => void confirmDelete()}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">{t('it.assets.deleteBody')}</p>
      </Dialog>
    </PageContainer>
  );
};
