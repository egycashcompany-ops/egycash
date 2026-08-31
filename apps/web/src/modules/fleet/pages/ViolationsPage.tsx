// Violations + grievances (FW-9, legacy car_villes): the §4.7 registry over FL-6 in two
// URL-synced views. The LIST shows the rows in their two backend shapes — a `vehicle` row is a
// bulk yearly statement whose amount the SERVER derived (count × unit value, FR-9), a `driver`
// row is a per-event fact whose amount was entered — and the page adds no arithmetic of its
// own. The ROLLUP view renders `GET /violations/rollup` verbatim: every figure per (vehicle,
// year), including the grievance, is server-assembled at query time; the grievance dialog PUTs
// the one per-(vehicle, year) figure and the board refreshes from the server.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  splitVehicleCodeList,
  type FleetViolationDto,
  type FleetViolationRollupDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Badge } from '../../../shared/ui/Badge';
import { Field, Input, Select } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, PlusIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate, formatMoney, formatNumber, localized } from '../../../shared/lib/format';
import {
  useDeleteViolation,
  useFleetCatalog,
  useVehicles,
  useViolationRollup,
  useViolations,
} from '../api/fleet-queries';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { EmployeeName } from '../components/EmployeeName';
import {
  DriverViolationDialog,
  GrievanceDialog,
  VehicleViolationDialog,
} from '../components/ViolationDialogs';

const DEFAULT_PAGE_SIZE = 25;
const currentYear = (): number => new Date().getFullYear();

export const ViolationsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const view = sp.get('view') === 'rollup' ? 'rollup' : 'list';
  const kind = sp.get('kind') ?? '';
  const vehicleCodes = splitVehicleCodeList(sp.get('vehicleCodes') ?? '');
  const yearParam = sp.get('year') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'createdAt:desc').split(':');
  const sort = { by: sortByRaw ?? 'createdAt', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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
      kind: kind || undefined,
      vehicleCodes: vehicleCodes.length === 0 ? undefined : vehicleCodes,
      year: yearParam || undefined,
    }),
    [paramsKey],
  );
  const listQuery = useViolations(params);
  // The rollup's axis is the year (required by the API); the list's optional year filter and
  // the rollup's axis share the URL param, defaulting to the current year on the board.
  const rollupYear = Number(yearParam) >= 2000 ? Number(yearParam) : currentYear();
  // Unfiltered registry map so rows of retired vehicles still resolve to their codes — and the
  // lookup the rollup below needs to turn a chosen CODE back into the id its axis takes.
  const vehiclesQuery = useVehicles({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
  // The ROLLUP's axis is one (vehicle, year) — that is the figure it reports, and widening it is
  // a different feature. So it follows the shared filter only when the filter names ONE car, and
  // otherwise reports the year unnarrowed rather than inventing a sum across a selection.
  const soleVehicleId =
    vehicleCodes.length === 1
      ? vehiclesQuery.data?.items.find((v) => v.code === vehicleCodes[0])?.id
      : undefined;
  const rollupQuery = useViolationRollup(rollupYear, soleVehicleId, view === 'rollup');
  const codeOf = (vehicleId: string): string =>
    vehiclesQuery.data?.items.find((v) => v.id === vehicleId)?.code ?? vehicleId.slice(-8);
  const types = useFleetCatalog('violationType');
  const typeName = (id: string): string => {
    const item = types.data?.items.find((entry) => entry.id === id);
    return item === undefined ? '—' : localized(item.name, locale);
  };

  const [recordVehicleOpen, setRecordVehicleOpen] = useState(false);
  const [recordDriverOpen, setRecordDriverOpen] = useState(false);
  const [editing, setEditing] = useState<FleetViolationDto | null>(null);
  const [deleting, setDeleting] = useState<FleetViolationDto | null>(null);
  const [grieving, setGrieving] = useState<FleetViolationRollupDto | null>(null);
  const remove = useDeleteViolation();

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.violations.deleted'));
    setDeleting(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const money = (amount: number): JSX.Element => (
    <span className="tabular-nums" dir="ltr">
      {formatMoney(amount, 'EGP', locale)}
    </span>
  );

  const listColumns: Column<FleetViolationDto>[] = [
    {
      key: 'kind',
      header: t('fleet.violations.fields.kind'),
      render: (r) => (
        <Badge tone={r.kind === 'vehicle' ? 'info' : 'brand'}>
          {t(`fleet.violations.kind.${r.kind}`)}
        </Badge>
      ),
    },
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      render: (r) => (
        <span className="font-mono text-xs" dir="ltr">
          {codeOf(r.vehicleId)}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('fleet.violations.fields.type'),
      render: (r) => typeName(r.violationTypeId),
    },
    {
      key: 'year',
      header: t('fleet.violations.fields.year'),
      sortable: true,
      render: (r) => (r.year === null ? '—' : <span className="tabular-nums">{r.year}</span>),
    },
    {
      key: 'date',
      header: t('fleet.violations.fields.date'),
      sortable: true,
      render: (r) =>
        r.date === null ? '—' : <span className="tabular-nums">{formatDate(r.date, locale)}</span>,
    },
    {
      key: 'driver',
      header: t('fleet.violations.fields.driver'),
      render: (r) =>
        r.driverEmployeeId === null ? '—' : <EmployeeName employeeId={r.driverEmployeeId} />,
    },
    {
      key: 'count',
      header: t('fleet.violations.fields.count'),
      align: 'end',
      render: (r) => (r.count === null ? '—' : formatNumber(r.count, locale)),
    },
    {
      key: 'unitValue',
      header: t('fleet.violations.fields.unitValue'),
      align: 'end',
      render: (r) => (r.unitValue === null ? '—' : money(r.unitValue)),
    },
    {
      key: 'amount',
      header: t('fleet.violations.fields.amount'),
      align: 'end',
      render: (r) => money(r.amount),
    },
    ...(can('fleetViolation.edit') || can('fleetViolation.delete')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetViolationDto) => (
              <span className="flex items-center justify-end gap-1">
                {can('fleetViolation.edit') && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.violations.edit')}
                    title={t('fleet.violations.edit')}
                    onClick={() => setEditing(r)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                )}
                {can('fleetViolation.delete') && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.violations.delete')}
                    title={t('fleet.violations.delete')}
                    onClick={() => setDeleting(r)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </span>
            ),
          } satisfies Column<FleetViolationDto>,
        ]
      : []),
  ];

  const rollupColumns: Column<FleetViolationRollupDto>[] = [
    {
      key: 'code',
      header: t('fleet.odometer.columns.vehicle'),
      render: (r) => (
        <span className="font-mono text-xs" dir="ltr">
          {r.code}
        </span>
      ),
    },
    {
      key: 'vehicleCount',
      header: t('fleet.violations.rollup.vehicleCount'),
      align: 'end',
      render: (r) => formatNumber(r.vehicleCount, locale),
    },
    {
      key: 'vehicleAmount',
      header: t('fleet.violations.rollup.vehicleAmount'),
      align: 'end',
      render: (r) => money(r.vehicleAmount),
    },
    {
      key: 'driverCount',
      header: t('fleet.violations.rollup.driverCount'),
      align: 'end',
      render: (r) => formatNumber(r.driverCount, locale),
    },
    {
      key: 'driverAmount',
      header: t('fleet.violations.rollup.driverAmount'),
      align: 'end',
      render: (r) => money(r.driverAmount),
    },
    {
      key: 'totalCount',
      header: t('fleet.violations.rollup.totalCount'),
      align: 'end',
      render: (r) => formatNumber(r.totalCount, locale),
    },
    {
      key: 'totalAmount',
      header: t('fleet.violations.rollup.totalAmount'),
      align: 'end',
      render: (r) => <span className="font-medium">{money(r.totalAmount)}</span>,
    },
    {
      key: 'totalBeforeGrievance',
      header: t('fleet.violations.rollup.totalBeforeGrievance'),
      align: 'end',
      render: (r) => money(r.totalBeforeGrievance),
    },
    ...(can('fleetViolation.grievance')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (r: FleetViolationRollupDto) => (
              <Button size="sm" variant="secondary" onClick={() => setGrieving(r)}>
                {t('fleet.violations.grievance')}
              </Button>
            ),
          } satisfies Column<FleetViolationRollupDto>,
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.violations')}
        description={t('fleet.violations.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.violations') },
        ]}
        actions={
          <Can permission="fleetViolation.record">
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setRecordDriverOpen(true)}
              >
                {t('fleet.violations.recordDriver')}
              </Button>
              <Button
                size="sm"
                leftIcon={<PlusIcon className="h-4 w-4" />}
                onClick={() => setRecordVehicleOpen(true)}
              >
                {t('fleet.violations.recordVehicle')}
              </Button>
            </div>
          </Can>
        }
      />

      <div
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800"
        role="tablist"
      >
        {(['list', 'rollup'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={view === k}
            type="button"
            onClick={() => patch({ view: k === 'list' ? null : k })}
            className={`rounded-t-lg px-4 py-2 text-sm ${
              view === k
                ? 'border-b-2 border-brand-600 font-semibold text-brand-700 dark:text-brand-300'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            {t(`fleet.violations.view.${k}`)}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={kind !== '' || vehicleCodes.length > 0 || yearParam !== ''}
          onClear={() => patch({ kind: null, vehicleCodes: null, year: null })}
        >
          {view === 'list' && (
            <Select
              aria-label={t('fleet.violations.fields.kind')}
              value={kind}
              onChange={(e) => patch({ kind: e.target.value || null })}
              className="w-auto"
            >
              <option value="">{t('fleet.violations.allKinds')}</option>
              <option value="vehicle">{t('fleet.violations.kind.vehicle')}</option>
              <option value="driver">{t('fleet.violations.kind.driver')}</option>
            </Select>
          )}
          <VehicleCodeFilter
            className="shrink-0"
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
          <Field label={t('fleet.violations.fields.year')} htmlFor="violations-year">
            <Input
              id="violations-year"
              type="number"
              min={2000}
              max={2100}
              step={1}
              value={view === 'rollup' ? String(rollupYear) : yearParam}
              onChange={(e) => patch({ year: e.target.value || null })}
              className="w-28"
              dir="ltr"
            />
          </Field>
        </FilterBar>

        {view === 'list' ? (
          <>
            <DataTable
              columns={listColumns}
              rows={listQuery.data?.items ?? []}
              rowKey={(r) => r.id}
              loading={listQuery.isLoading}
              error={listQuery.isError ? listQuery.error : undefined}
              onRetry={() => void listQuery.refetch()}
              sort={sort}
              onSortChange={changeSort}
            />
            {listQuery.data !== undefined && listQuery.data.meta.totalItems > 0 && (
              <Pagination
                meta={listQuery.data.meta}
                onPageChange={(p) => patch({ page: String(p) }, false)}
                onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
              />
            )}
          </>
        ) : (
          <DataTable
            columns={rollupColumns}
            rows={rollupQuery.data ?? []}
            rowKey={(r) => r.vehicleId}
            loading={rollupQuery.isPending}
            error={rollupQuery.isError ? rollupQuery.error : undefined}
            onRetry={() => void rollupQuery.refetch()}
          />
        )}
      </div>

      <VehicleViolationDialog
        open={recordVehicleOpen}
        onClose={() => setRecordVehicleOpen(false)}
        violation={null}
        // Carried over only when the filter names ONE car; the dialog still picks a single vehicle.
        initialVehicleId={soleVehicleId ?? ''}
      />
      <DriverViolationDialog
        open={recordDriverOpen}
        onClose={() => setRecordDriverOpen(false)}
        violation={null}
        // Carried over only when the filter names ONE car; the dialog still picks a single vehicle.
        initialVehicleId={soleVehicleId ?? ''}
      />
      <VehicleViolationDialog
        open={editing?.kind === 'vehicle'}
        onClose={() => setEditing(null)}
        violation={editing?.kind === 'vehicle' ? editing : null}
      />
      <DriverViolationDialog
        open={editing?.kind === 'driver'}
        onClose={() => setEditing(null)}
        violation={editing?.kind === 'driver' ? editing : null}
      />
      {grieving !== null && (
        <GrievanceDialog
          open
          onClose={() => setGrieving(null)}
          vehicleId={grieving.vehicleId}
          code={grieving.code}
          year={grieving.year}
          current={grieving.totalBeforeGrievance}
        />
      )}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.violations.deleteTitle')}
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
              {t('fleet.violations.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.violations.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
