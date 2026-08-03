// Odometer log (FW-6, legacy /cars_log): the continuity chain as the server tells it — every
// km figure and closing reading is DERIVED backend-side (§4.3), the open period shows as such,
// and the only ways to change history are recording (FR-2, monotonic) and the audited
// correction flow behind its own grant. URL-synced vehicle/date filters (the vehicle profile
// links here pre-filtered), sortable date/reading columns, pagination.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MAX_PAGE_SIZE, type FleetOdometerLogDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Field, Input } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useOdometerLogs, useVehicles } from '../api/fleet-queries';
import { EmployeeName } from '../components/EmployeeName';
import { VehicleSelect } from '../components/VehicleSelect';
import { RecordOdometerDialog } from '../components/RecordOdometerDialog';
import { CorrectOdometerDialog } from '../components/CorrectOdometerDialog';

const DEFAULT_PAGE_SIZE = 25;

export const OdometerPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const vehicleId = sp.get('vehicle') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const [sortByRaw, sortDirRaw] = (sp.get('sort') ?? 'date:desc').split(':');
  const sort = { by: sortByRaw ?? 'date', dir: sortDirRaw === 'asc' ? 'asc' : 'desc' } as {
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
  const hasActiveFilters = vehicleId !== '' || from !== '' || to !== '';

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      vehicleId: vehicleId || undefined,
      from: from || undefined,
      to: to || undefined,
    }),
    [paramsKey],
  );
  const { data, isLoading, isError, error, refetch } = useOdometerLogs(params);
  const rows = data?.items ?? [];

  // Code column: resolved from the registry WITHOUT a status filter — history rows may belong
  // to vehicles that have since left service.
  const vehicles = useVehicles({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
  const vehicleCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles.data?.items ?? []) map.set(v.id, v.code);
    return map;
  }, [vehicles.data]);

  const [recordOpen, setRecordOpen] = useState(false);
  const [correcting, setCorrecting] = useState<FleetOdometerLogDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetOdometerLogDto>[] = [
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      render: (log) => (
        <span className="font-mono text-xs" dir="ltr">
          {vehicleCode.get(log.vehicleId) ?? log.vehicleId.slice(-6)}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('fleet.odometer.fields.date'),
      sortable: true,
      render: (log) => <span className="tabular-nums">{formatDate(log.date, locale)}</span>,
    },
    {
      key: 'outReading',
      header: t('fleet.odometer.columns.outReading'),
      sortable: true,
      align: 'end',
      render: (log) => formatNumber(log.outReading, locale),
    },
    {
      key: 'inReading',
      header: t('fleet.odometer.columns.inReading'),
      align: 'end',
      render: (log) =>
        log.inReading === null ? (
          <Badge tone="info">{t('fleet.odometer.openPeriod')}</Badge>
        ) : (
          formatNumber(log.inReading, locale)
        ),
    },
    {
      key: 'km',
      header: t('fleet.odometer.columns.km'),
      align: 'end',
      render: (log) => (log.km === null ? '—' : formatNumber(log.km, locale)),
    },
    {
      key: 'drivers',
      header: t('fleet.odometer.columns.drivers'),
      render: (log) => (
        <span className="space-x-2 rtl:space-x-reverse">
          {log.driver1EmployeeId === null && log.driver2EmployeeId === null && '—'}
          {log.driver1EmployeeId !== null && <EmployeeName employeeId={log.driver1EmployeeId} />}
          {log.driver2EmployeeId !== null && <EmployeeName employeeId={log.driver2EmployeeId} />}
        </span>
      ),
    },
    ...(can('fleetOdometer.correct')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (log: FleetOdometerLogDto) => (
              <button
                type="button"
                className={actionButton}
                aria-label={t('fleet.odometer.correct')}
                title={t('fleet.odometer.correct')}
                onClick={() => setCorrecting(log)}
              >
                <EditIcon className="h-4 w-4" />
              </button>
            ),
          } satisfies Column<FleetOdometerLogDto>,
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.odometer')}
        description={t('fleet.odometer.subtitle')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.odometer') },
        ]}
        actions={
          <Can permission="fleetOdometer.record">
            <Button
              size="sm"
              leftIcon={<PlusIcon className="h-4 w-4" />}
              onClick={() => setRecordOpen(true)}
            >
              {t('fleet.odometer.record')}
            </Button>
          </Can>
        }
      />

      <div className="space-y-4">
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() => patch({ vehicle: null, from: null, to: null })}
        >
          <VehicleSelect
            value={vehicleId}
            onChange={(id) => patch({ vehicle: id || null })}
            allLabel={t('fleet.odometer.allVehicles')}
            ariaLabel={t('fleet.odometer.columns.vehicle')}
          />
          <Field label={t('fleet.odometer.from')} htmlFor="odometer-from">
            <Input
              id="odometer-from"
              type="date"
              value={from}
              onChange={(e) => patch({ from: e.target.value || null })}
              className="w-auto"
            />
          </Field>
          <Field label={t('fleet.odometer.to')} htmlFor="odometer-to">
            <Input
              id="odometer-to"
              type="date"
              value={to}
              onChange={(e) => patch({ to: e.target.value || null })}
              className="w-auto"
            />
          </Field>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(log) => log.id}
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

      <RecordOdometerDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        initialVehicleId={vehicleId}
      />
      <CorrectOdometerDialog
        open={correcting !== null}
        onClose={() => setCorrecting(null)}
        log={correcting}
      />
    </PageContainer>
  );
};
