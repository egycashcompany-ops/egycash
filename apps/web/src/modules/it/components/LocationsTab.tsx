// «المواقع» (2026-11-19) — the catalogs page's fourth tab: each branch's places, where a department
// keeps what it holds («غرفة السيرفرات», «غرفة الكاميرات»). Not a catalog kind — a place is a
// branch's, and two branches may each have «غرفة السيرفرات» — so it is its own list (`/it/locations`)
// under the catalogs' own grant, `itCatalog.manage`, within the caller's branch reach.
//
// «في عهدته الآن» counts the assets held at the place right now and opens them on the asset list
// (`/it/assets?location=`) — «إيه اللي في غرفة السيرفرات». A place is retired, never deleted: the
// status column tells the truth, and the server refuses retiring one while assets are held there.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type ItLocationDto, type Locale } from '@ecms/contracts';
import { useAppSelector } from '../../../store';
import { useT } from '../../../platform/localization/useT';
import { Can } from '../../../platform/rbac/Can';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { BOARD_TABLE_FILL_LOW } from '../../../shared/ui/board-scroll';
import { StatusBadge } from '../../../shared/ui/Badge';
import { Select } from '../../../shared/ui/form';
import { SearchInput } from '../../../shared/ui/SearchInput';
import { EditIcon } from '../../../shared/ui/icons';
import { formatNumber, localized } from '../../../shared/lib/format';
import { useItBranchOptions, useItLocations } from '../api/it-queries';
import { LocationDialog } from './LocationDialog';

const DEFAULT_PAGE_SIZE = 25;

export const LocationsTab = ({
  creating,
  onCloseCreate,
}: {
  /** The page header's «إضافة موقع» was pressed. */
  creating: boolean;
  onCloseCreate: () => void;
}): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  const branchId = sp.get('branch') ?? '';
  const active = sp.get('active') ?? '';
  const search = sp.get('q') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };

  const params = {
    page,
    pageSize,
    ...(branchId === '' ? {} : { branchId }),
    ...(active === '' ? {} : { isActive: active === 'true' }),
    ...(search.trim() === '' ? {} : { search: search.trim() }),
  };
  const { data, isLoading, isError, error, refetch } = useItLocations(params);
  const branches = useItBranchOptions();
  const branchName = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches.data ?? []) map.set(branch.id, localized(branch.name, locale));
    return map;
  }, [branches.data, locale]);
  const [editing, setEditing] = useState<ItLocationDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<ItLocationDto>[] = [
    {
      key: 'name',
      header: t('it.locations.columns.name'),
      render: (r) => (
        <span className="flex flex-col leading-tight">
          <span>{r.name.ar}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400" dir="ltr">
            {r.name.en}
          </span>
        </span>
      ),
    },
    {
      key: 'branch',
      header: t('it.assets.columns.branch'),
      render: (r) => branchName.get(r.branchId) ?? '—',
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
    {
      key: 'description',
      header: t('it.catalogs.fields.description'),
      render: (r) => r.description ?? '—',
    },
    {
      // «في عهدته الآن» — what a department holds here today, opened on the asset list. Not
      // counted for a reader without the assets' view (null): nothing is claimed.
      key: 'heldAssets',
      header: t('it.locations.columns.heldAssets'),
      render: (r) =>
        r.heldAssets === null ? (
          '—'
        ) : r.heldAssets === 0 ? (
          <span className="tabular-nums text-slate-500">{formatNumber(0, locale)}</span>
        ) : (
          <Link
            to={`/it/assets?location=${r.id}`}
            data-location-held={r.id}
            className="tabular-nums text-brand-700 hover:underline dark:text-brand-300"
          >
            {formatNumber(r.heldAssets, locale)}
          </Link>
        ),
    },
    {
      key: 'status',
      header: t('it.assets.columns.status'),
      render: (r) => (
        <StatusBadge
          tone={r.isActive ? 'success' : 'neutral'}
          label={r.isActive ? t('it.catalogs.active') : t('it.locations.retired')}
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
            aria-label={`${t('it.locations.edit')} — ${r.name.ar}`}
            title={t('it.locations.edit')}
            onClick={() => setEditing(r)}
          >
            <EditIcon className="h-4 w-4" />
          </button>
        </Can>
      ),
    },
  ];

  return (
    <>
      <FilterBar
        hasActiveFilters={branchId !== '' || active !== '' || search !== ''}
        onClear={() => patch({ branch: null, active: null, q: null })}
      >
        <SearchInput
          value={search}
          onChange={(value) => patch({ q: value })}
          placeholder={t('it.locations.search')}
        />
        <Select
          aria-label={t('it.assets.columns.branch')}
          value={branchId}
          data-locations-branch
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
        <Select
          aria-label={t('it.assets.columns.status')}
          value={active}
          onChange={(e) => patch({ active: e.target.value || null })}
          className="w-auto"
        >
          <option value="">{t('it.catalogs.allStatuses')}</option>
          <option value="true">{t('it.catalogs.active')}</option>
          <option value="false">{t('it.locations.retired')}</option>
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
          empty={
            <p className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {t('it.locations.empty')}
            </p>
          }
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

      <LocationDialog open={creating} onClose={onCloseCreate} place={null} branchId={branchId} />
      <LocationDialog open={editing !== null} onClose={() => setEditing(null)} place={editing} />
    </>
  );
};
