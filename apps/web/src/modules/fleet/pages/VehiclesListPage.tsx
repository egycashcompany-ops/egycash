// Vehicles registry (FW-3, legacy /fleet page): URL-synced search + filters + sort +
// pagination over the real FL-2 list API. Everything shown is a server fact — including the
// DERIVED inWorkshop pill (FR-12) — and every action is permission-gated exactly as the API
// enforces it. Rows don't navigate yet: the vehicle profile ships in FW-4 and adds the link
// then (owner rule: nothing unshipped is reachable).
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type FleetVehicleDto, type Locale } from '@ecms/contracts';
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
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, EyeIcon, PlusIcon, TrashIcon, WrenchIcon } from '../../../shared/ui/icons';
import { formatDate, localized } from '../../../shared/lib/format';
import { cn } from '../../../shared/lib/cn';
import { BranchFilterSelect } from '../../hr/recruitment/shared/BranchFilterSelect';
import { useDeleteVehicle, useVehicleTypes, useVehicles } from '../api/fleet-queries';
import { InWorkshopBadge, VehicleStatusBadge } from '../components/VehicleStatusBadge';
import { VehicleFormDialog } from '../components/VehicleFormDialog';
import { VehicleStatusDialog } from '../components/VehicleStatusDialog';

const DEFAULT_PAGE_SIZE = 25;

export const VehiclesListPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();

  const search = sp.get('q') ?? '';
  const status = sp.get('status') ?? '';
  const typeId = sp.get('type') ?? '';
  const branchId = sp.get('branch') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'code:asc').split(':');
  const sort = { by: sortByRaw ?? 'code', dir: sortDirRaw === 'desc' ? 'desc' : 'asc' } as {
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
  const hasActiveFilters = search !== '' || status !== '' || typeId !== '' || branchId !== '';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      search: search || undefined,
      status: status || undefined,
      typeId: typeId || undefined,
      branchId: branchId || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useVehicles(params);
  const rows = data?.items ?? [];

  const types = useVehicleTypes();
  const typeName = useMemo(() => {
    const map = new Map<string, string>();
    for (const type of types.data?.items ?? []) map.set(type.id, localized(type.name, locale));
    return map;
  }, [types.data, locale]);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FleetVehicleDto | null>(null);
  const [statusFor, setStatusFor] = useState<FleetVehicleDto | null>(null);
  const [deleting, setDeleting] = useState<FleetVehicleDto | null>(null);
  const remove = useDeleteVehicle();

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.vehicles.deleted'));
    setDeleting(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetVehicleDto>[] = [
    {
      key: 'code',
      header: t('fleet.vehicles.columns.code'),
      sortable: true,
      render: (v) => (
        <span className="font-mono text-xs" dir="ltr">
          {v.code}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('fleet.vehicles.columns.type'),
      render: (v) => typeName.get(v.typeId) ?? '—',
    },
    { key: 'plate', header: t('fleet.vehicles.columns.plate'), render: (v) => v.plateNumber },
    {
      key: 'status',
      header: t('fleet.vehicles.columns.status'),
      render: (v) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <VehicleStatusBadge status={v.status} />
          <InWorkshopBadge inWorkshop={v.inWorkshop} />
        </span>
      ),
    },
    {
      key: 'licenseExpiresAt',
      header: t('fleet.vehicles.columns.license'),
      sortable: true,
      render: (v) => {
        const expired = new Date(v.licenseExpiresAt).getTime() < Date.now();
        return (
          <span
            className={cn('tabular-nums', expired && 'font-medium text-red-600 dark:text-red-400')}
          >
            {formatDate(v.licenseExpiresAt, locale)}
          </span>
        );
      },
    },
    // Owner UI decision (FW-4): no whole-row navigation — an explicit View action instead. It
    // avoids accidental navigation, matches the other ECMS modules, and leaves row selection
    // free for later. The column always renders: View needs only the page's own permission.
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (v) => (
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            className={actionButton}
            aria-label={t('fleet.vehicles.view')}
            title={t('fleet.vehicles.view')}
            onClick={() => navigate(v.id)}
          >
            <EyeIcon className="h-4 w-4" />
          </button>
          {can('fleetVehicle.edit') && v.status !== 'disposed' && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.vehicles.edit')}
              title={t('fleet.vehicles.edit')}
              onClick={() => {
                setEditing(v);
                setFormOpen(true);
              }}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetVehicle.changeStatus') && v.status !== 'disposed' && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.vehicles.changeStatus')}
              title={t('fleet.vehicles.changeStatus')}
              onClick={() => setStatusFor(v)}
            >
              <WrenchIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetVehicle.delete') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('common.delete')}
              title={t('common.delete')}
              onClick={() => setDeleting(v)}
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
        title={t('fleet.nav.vehicles')}
        description={t('fleet.vehicles.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.vehicles') },
        ]}
        actions={
          <Can permission="fleetVehicle.create">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              {t('fleet.vehicles.create')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ q: null, status: null, type: null, branch: null })}
        >
          <SearchInput
            value={search}
            onChange={(value) => patch({ q: value || null })}
            placeholder={t('fleet.vehicles.searchPlaceholder')}
            className="w-64"
          />
          <Select
            aria-label={t('fleet.vehicles.columns.status')}
            value={status}
            onChange={(e) => patch({ status: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.vehicles.allStatuses')}</option>
            {(['active', 'outOfService', 'disposed'] as const).map((s) => (
              <option key={s} value={s}>
                {t(`fleet.vehicles.status.${s}`)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t('fleet.vehicles.columns.type')}
            value={typeId}
            onChange={(e) => patch({ type: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.vehicles.allTypes')}</option>
            {(types.data?.items ?? []).map((type) => (
              <option key={type.id} value={type.id}>
                {localized(type.name, locale)}
              </option>
            ))}
          </Select>
          <BranchFilterSelect value={branchId} onChange={(id) => patch({ branch: id || null })} />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
          empty={undefined}
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
            meta={data.meta}
            onPageChange={(p) => patch({ page: String(p) }, false)}
            onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
          />
        )}
      </div>

      <VehicleFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        vehicle={editing}
      />
      <VehicleStatusDialog
        open={statusFor !== null}
        onClose={() => setStatusFor(null)}
        vehicle={statusFor}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.vehicles.deleteTitle')}
        description={deleting === null ? '' : `${deleting.code} — ${deleting.plateNumber}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => void confirmDelete()}
            >
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.vehicles.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
