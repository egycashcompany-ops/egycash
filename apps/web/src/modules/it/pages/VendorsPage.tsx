// Vendors (design §2.9) — IT-owned until a Procurement module exists (§13-Q6). Server-side
// search from the first commit (ADR-019 rule 5): this is a growth catalog, so the box queries the
// API and the browser never holds the whole list to filter it.
//
// Vendors ARCHIVE, never delete (FR-11): assets reference them through `purchase.vendorId` and
// `warranty.vendorId`, so the row action is edit and the Active toggle inside the dialog is how a
// vendor leaves circulation.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type ItVendorDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { useItVendors } from '../api/it-queries';
import { VendorFormDialog } from '../components/VendorFormDialog';

const DEFAULT_PAGE_SIZE = 25;

export const VendorsPage = (): JSX.Element => {
  const t = useT();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const active = sp.get('active') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'name:asc').split(':');
  const sort = { by: sortByRaw ?? 'name', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      isActive: active === '' ? undefined : active === 'true',
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useItVendors(params);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ItVendorDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItVendorDto>[] = [
    { key: 'name', header: t('it.vendors.fields.name'), sortable: true, render: (v) => v.name },
    {
      key: 'code',
      header: t('it.vendors.fields.code'),
      render: (v) =>
        v.code === null ? (
          '—'
        ) : (
          <span className="font-mono text-xs" dir="ltr">
            {v.code}
          </span>
        ),
    },
    {
      key: 'phone',
      header: t('it.vendors.fields.phone'),
      render: (v) => (v.phone === null ? '—' : <span dir="ltr">{v.phone}</span>),
    },
    {
      key: 'email',
      header: t('it.vendors.fields.email'),
      render: (v) => (v.email === null ? '—' : <span dir="ltr">{v.email}</span>),
    },
    {
      key: 'contacts',
      header: t('it.vendors.contacts'),
      render: (v) => <span className="tabular-nums">{v.contacts.length}</span>,
    },
    {
      key: 'status',
      header: t('it.assets.columns.status'),
      render: (v) => (
        <StatusBadge
          tone={v.isActive ? 'success' : 'neutral'}
          label={v.isActive ? t('it.catalogs.active') : t('it.catalogs.archived')}
        />
      ),
    },
    {
      key: 'actions',
      header: t('it.assets.columns.actions'),
      align: 'end',
      render: (v) => (
        <Can permission="itVendor.manage">
          <button
            type="button"
            className={actionButton}
            aria-label={`${t('it.vendors.edit')} — ${v.name}`}
            title={t('it.vendors.edit')}
            onClick={() => setEditing(v)}
          >
            <EditIcon className="h-4 w-4" />
          </button>
        </Can>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('it.nav.vendors')}
        description={t('it.vendors.subtitle')}
        breadcrumbs={[{ label: t('it.module.title'), to: '/it' }, { label: t('it.nav.vendors') }]}
        actions={
          <Can permission="itVendor.manage">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCreating(true)}
            >
              {t('it.vendors.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={search !== '' || active !== ''}
          onClear={() => patch({ q: null, active: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('it.vendors.searchPlaceholder')}
            aria-label={t('it.vendors.searchPlaceholder')}
            className="w-64"
          />
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

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(v) => v.id}
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

      <VendorFormDialog open={creating} onClose={() => setCreating(false)} vendor={null} />
      <VendorFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        vendor={editing}
      />
    </PageContainer>
  );
};
