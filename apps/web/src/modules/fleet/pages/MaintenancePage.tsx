// Maintenance visits (FW-6, legacy /cars_maintenance): the workshop lifecycle exactly as FL-4
// enforces it — one open visit per vehicle (FR-4), check-out records the exit and the custody,
// reopen undoes a mistaken check-out, and the closed counting visit is what resets the alarm
// cycle (owner point 5). URL-synced vehicle/state/workshop filters, sortable dates, pagination.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetMaintenanceVisitDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/Dialog';
import { Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import {
  CornerDownIcon,
  EditIcon,
  PlusIcon,
  TrashIcon,
  WrenchIcon,
} from '../../../shared/ui/icons';
import { formatDate, formatNumber, localized } from '../../../shared/lib/format';
import {
  useDeleteMaintenance,
  useFleetCatalog,
  useMaintenanceVisits,
  useReopenMaintenance,
  useVehicles,
} from '../api/fleet-queries';
import { VehicleSelect } from '../components/VehicleSelect';
import { CatalogSelect } from '../components/CatalogSelect';
import {
  CheckInDialog,
  CheckOutDialog,
  MaintenanceEditDialog,
} from '../components/MaintenanceDialogs';

const DEFAULT_PAGE_SIZE = 25;

export const MaintenancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const vehicleId = sp.get('vehicle') ?? '';
  const state = sp.get('state') ?? '';
  const workshopId = sp.get('workshop') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'inDate:desc').split(':');
  const sort = { by: sortByRaw ?? 'inDate', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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
  const hasActiveFilters = vehicleId !== '' || state !== '' || workshopId !== '';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      vehicleId: vehicleId || undefined,
      open: state === '' ? undefined : state === 'open',
      workshopId: workshopId || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useMaintenanceVisits(params);
  const rows = data?.items ?? [];

  const vehicles = useVehicles({ pageSize: 200, sortBy: 'code', sortDir: 'asc' });
  const vehicleCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles.data?.items ?? []) map.set(v.id, v.code);
    return map;
  }, [vehicles.data]);
  const workshops = useFleetCatalog('workshop');
  const workTypes = useFleetCatalog('workType');
  const catalogName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of [...(workshops.data?.items ?? []), ...(workTypes.data?.items ?? [])]) {
      map.set(item.id, localized(item.name, locale));
    }
    return map;
  }, [workshops.data, workTypes.data, locale]);

  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState<FleetMaintenanceVisitDto | null>(null);
  const [editing, setEditing] = useState<FleetMaintenanceVisitDto | null>(null);
  const [reopening, setReopening] = useState<FleetMaintenanceVisitDto | null>(null);
  const [deleting, setDeleting] = useState<FleetMaintenanceVisitDto | null>(null);
  const reopen = useReopenMaintenance();
  const remove = useDeleteMaintenance();

  const confirmReopen = async (): Promise<void> => {
    if (reopening === null) return;
    await reopen.mutateAsync({ id: reopening.id, version: reopening.version });
    toast.success(t('fleet.maintenance.reopened'));
    setReopening(null);
  };
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.maintenance.deleted'));
    setDeleting(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetMaintenanceVisitDto>[] = [
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      render: (visit) => (
        <span className="font-mono text-xs" dir="ltr">
          {vehicleCode.get(visit.vehicleId) ?? visit.vehicleId.slice(-6)}
        </span>
      ),
    },
    {
      key: 'inDate',
      header: t('fleet.maintenance.fields.inDate'),
      sortable: true,
      render: (visit) => <span className="tabular-nums">{formatDate(visit.inDate, locale)}</span>,
    },
    {
      key: 'outDate',
      header: t('fleet.maintenance.fields.outDate'),
      sortable: true,
      render: (visit) =>
        visit.outDate === null ? (
          <Badge tone="info">{t('fleet.maintenance.open')}</Badge>
        ) : (
          <span className="tabular-nums">{formatDate(visit.outDate, locale)}</span>
        ),
    },
    {
      key: 'workshop',
      header: t('fleet.maintenance.fields.workshop'),
      render: (visit) => catalogName.get(visit.workshopId) ?? '—',
    },
    {
      key: 'workType',
      header: t('fleet.maintenance.fields.workType'),
      render: (visit) => catalogName.get(visit.workTypeId) ?? '—',
    },
    {
      key: 'odometerAtService',
      header: t('fleet.maintenance.fields.odometerAtService'),
      align: 'end',
      render: (visit) => formatNumber(visit.odometerAtService, locale),
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (visit) => (
        <span className="flex items-center justify-end gap-1">
          {can('fleetMaintenance.checkOut') && visit.outDate === null && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.maintenance.checkOut')}
              title={t('fleet.maintenance.checkOut')}
              onClick={() => setCheckingOut(visit)}
            >
              <WrenchIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetMaintenance.checkOut') && visit.outDate !== null && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.maintenance.reopen')}
              title={t('fleet.maintenance.reopen')}
              onClick={() => setReopening(visit)}
            >
              <CornerDownIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetMaintenance.edit') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.maintenance.edit')}
              title={t('fleet.maintenance.edit')}
              onClick={() => setEditing(visit)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetMaintenance.delete') && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('common.delete')}
              title={t('common.delete')}
              onClick={() => setDeleting(visit)}
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
        title={t('fleet.nav.maintenance')}
        description={t('fleet.maintenance.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.maintenance') },
        ]}
        actions={
          <Can permission="fleetMaintenance.checkIn">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setCheckInOpen(true)}
            >
              {t('fleet.maintenance.checkIn')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ vehicle: null, state: null, workshop: null })}
        >
          <VehicleSelect
            value={vehicleId}
            onChange={(id) => patch({ vehicle: id || null })}
            allLabel={t('fleet.odometer.allVehicles')}
            ariaLabel={t('fleet.odometer.columns.vehicle')}
          />
          <Select
            aria-label={t('fleet.maintenance.stateFilter')}
            value={state}
            onChange={(e) => patch({ state: e.target.value || null })}
            className="w-auto"
          >
            <option value="">{t('fleet.maintenance.allStates')}</option>
            <option value="open">{t('fleet.maintenance.open')}</option>
            <option value="closed">{t('fleet.maintenance.closed')}</option>
          </Select>
          <CatalogSelect
            kind="workshop"
            value={workshopId}
            onChange={(id) => patch({ workshop: id || null })}
            allLabel={t('fleet.maintenance.allWorkshops')}
            ariaLabel={t('fleet.maintenance.fields.workshop')}
          />
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(visit) => visit.id}
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

      <CheckInDialog
        open={checkInOpen}
        onClose={() => setCheckInOpen(false)}
        initialVehicleId={vehicleId}
      />
      <CheckOutDialog
        open={checkingOut !== null}
        onClose={() => setCheckingOut(null)}
        visit={checkingOut}
      />
      <MaintenanceEditDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        visit={editing}
      />
      <Dialog
        open={reopening !== null}
        onClose={() => setReopening(null)}
        title={t('fleet.maintenance.reopenTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReopening(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={reopen.isPending} onClick={() => void confirmReopen()}>
              {t('fleet.maintenance.reopen')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.maintenance.reopenBody')}
        </p>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.maintenance.deleteTitle')}
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
          {t('fleet.maintenance.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
