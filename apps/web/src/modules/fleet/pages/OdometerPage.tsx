// Odometer log (FW-6, legacy /cars_log): the continuity chain as the server tells it.
//
// Every number in this table is a SERVER fact. The closing reading of a day IS the opening
// reading of the next — one physical reading stored on two rows (§4.3) — so `inReading` and `km`
// are derived backend-side and an unclosed day shows as the open period rather than a guess. The
// maintenance figure is derived too: distance since the last alarm-counting service, coloured by
// thresholds that live in Fleet Settings, never here.
//
// Filtering is server-side throughout, including the two questions the odometer collection cannot
// answer by itself: vehicle CODES resolve against the registry, and a driver NAME is HR's fact
// resolved through HR's own endpoint first (the same two-step join the drivers registry uses).
// Nothing is filtered out of a fetched page.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_ALARM_LEVELS,
  MAX_PAGE_SIZE,
  type FleetAlarmLevel,
  type FleetOdometerLogDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Input } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useMaintenanceAlarms, useOdometerLogs, useVehicles } from '../api/fleet-queries';
import { useDriverHrFilter } from '../api/driver-hr-filter';
import { EmployeeName } from '../components/EmployeeName';
import { RecordOdometerDialog } from '../components/RecordOdometerDialog';
import { CorrectOdometerDialog } from '../components/CorrectOdometerDialog';

const DEFAULT_PAGE_SIZE = 25;

/** The design system's answer for an alarm level — the same one the alarms board uses. */
const AlarmBadge = ({ level }: { level: FleetAlarmLevel }): JSX.Element => {
  const t = useT();
  if (level === 'none') return <Badge tone="neutral">{t('fleet.vehicle.alarmNone')}</Badge>;
  return (
    <Badge tone={level === 'red' ? 'danger' : 'warning'}>
      {t(`fleet.dashboard.level.${level}`)}
    </Badge>
  );
};

export const OdometerPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const vehicleCodes = (sp.get('vehicleCodes') ?? '').split(',').filter((c) => c !== '');
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const driver = sp.get('driver') ?? '';
  const alerts = (sp.get('alerts') ?? '').split(',').filter((a) => a !== '');
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
  const hasActiveFilters =
    vehicleCodes.length > 0 || from !== '' || to !== '' || driver !== '' || alerts.length > 0;

  // The driver NAME is HR's fact: ask HR first, filter Fleet by the ids it returns. Reuses the
  // drivers registry's own hook, so the "HR matched more than one page" refusal is the same here.
  const mayFilterByDriver = can('employee.view');
  const hr = useDriverHrFilter({
    search: mayFilterByDriver ? driver : '',
    jobTitleId: '',
    branchId: '',
    governorate: '',
    phone: '',
  });
  const driverEmployeeIds = hr.employeeIds;

  const params = useMemo(
    () => ({
      page,
      pageSize,
      sortBy: sort.by,
      sortDir: sort.dir,
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      from: from || undefined,
      to: to || undefined,
      alerts: alerts.length > 0 ? alerts : undefined,
      // Always sent once a driver filter is set, including when HR matched nobody: an empty list
      // is "no matches", and dropping it would answer a narrowed question with every reading.
      driverEmployeeIds: driverEmployeeIds ?? undefined,
    }),
    [paramsKey, driverEmployeeIds],
  );
  // Three states must hold the query back rather than let it answer the wrong question: the HR
  // step still running, HR matching more than one page, HR refusing.
  const blocked = hr.loading || hr.tooMany || hr.failed;
  const emptyMatch = driverEmployeeIds !== null && driverEmployeeIds.length === 0;
  const { data, isLoading, isError, error, refetch } = useOdometerLogs(
    params,
    !blocked && !emptyMatch,
  );
  const rows = blocked || emptyMatch ? [] : (data?.items ?? []);

  // Code column: resolved from the registry WITHOUT a status filter — history rows may belong
  // to vehicles that have since left service.
  const vehicles = useVehicles({ pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
  const vehicleCode = useMemo(() => {
    const map = new Map<string, string>();
    for (const v of vehicles.data?.items ?? []) map.set(v.id, v.code);
    return map;
  }, [vehicles.data]);
  const vehicleOptions = useMemo(
    () =>
      (vehicles.data?.items ?? []).map((v) => ({
        value: v.code,
        label: `${v.code} — ${v.plateNumber}`,
      })),
    [vehicles.data],
  );

  // The maintenance figure, per vehicle, from the SAME derived projection the alarms board reads.
  // One call for the whole page; the join here is display only — the level filter is server-side.
  const alarmsQuery = useMaintenanceAlarms(can('fleetOdometer.view'));
  const alarmByVehicle = useMemo(() => {
    const map = new Map<string, { sinceServiceKm: number | null; level: FleetAlarmLevel }>();
    for (const alarm of alarmsQuery.data ?? []) {
      map.set(alarm.vehicleId, { sinceServiceKm: alarm.sinceServiceKm, level: alarm.level });
    }
    return map;
  }, [alarmsQuery.data]);

  const [recordOpen, setRecordOpen] = useState(false);
  const [correcting, setCorrecting] = useState<FleetOdometerLogDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  // The serial a reader calls a row by, and it counts through the WHOLE filtered list rather than
  // restarting at 1 on every page: row 1 of page 2 is 26 when the page holds 25. The offset comes
  // from the server's own `meta`, not from the URL — the server is free to clamp a page size it
  // was handed, and numbering off the unclamped request would drift from the rows on screen. The
  // URL values are only the fallback for the render before the first response lands.
  const firstRowNumber = ((data?.meta.page ?? page) - 1) * (data?.meta.pageSize ?? pageSize) + 1;

  const columns: Column<FleetOdometerLogDto>[] = [
    {
      key: 'no',
      header: t('fleet.odometer.columns.no'),
      align: 'end',
      render: (_log, index) => formatNumber(firstRowNumber + index, locale),
    },
    {
      key: 'date',
      header: t('fleet.odometer.fields.date'),
      sortable: true,
      render: (log) => <span className="tabular-nums">{formatDate(log.date, locale)}</span>,
    },
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      render: (log) => (
        <span className="font-mono text-xs" dir="ltr">
          {vehicleCode.get(log.vehicleId) ?? '—'}
        </span>
      ),
    },
    {
      key: 'driver1',
      header: t('fleet.odometer.columns.driver1'),
      render: (log) =>
        log.driver1EmployeeId === null ? '—' : <EmployeeName employeeId={log.driver1EmployeeId} />,
    },
    {
      key: 'driver2',
      header: t('fleet.odometer.columns.driver2'),
      render: (log) =>
        log.driver2EmployeeId === null ? '—' : <EmployeeName employeeId={log.driver2EmployeeId} />,
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
      key: 'notes',
      // The one free-text column, and a table column is sized by its content: a note carrying an
      // unbroken run of characters — a pasted reference, a URL — has no break point to wrap at, so
      // the column grows to fit it and pushes the columns after it off the screen. A bounded box
      // that is allowed to break inside a word gives the run somewhere to wrap, and keeps the
      // maintenance figure and the row's actions where the reader left them.
      header: t('fleet.odometer.columns.notes'),
      render: (log) =>
        log.notes === null ? '—' : <span className="block max-w-xs break-words">{log.notes}</span>,
    },
    {
      key: 'maintenance',
      header: t('fleet.odometer.columns.sinceService'),
      render: (log) => {
        const alarm = alarmByVehicle.get(log.vehicleId);
        // No rule, no service on file, or a vehicle that has left the registry: say nothing
        // rather than print a distance the projection deliberately refused to compute.
        if (alarm === undefined || alarm.sinceServiceKm === null) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">
              {t('fleet.odometer.kmValue', { km: formatNumber(alarm.sinceServiceKm, locale) })}
            </span>
            <AlarmBadge level={alarm.level} />
          </span>
        );
      },
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
          singleRow
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({ vehicleCodes: null, from: null, to: null, driver: null, alerts: null })
          }
        >
          {/* One row on a desktop, in the order the question is asked: which cars, over which
              days, driven by whom, in what state. Every filter is `shrink-0` and sized to what it
              holds — none of them takes the leftover space, so the row reads as five controls
              rather than one stretched one. Narrower than the row needs, the bar wraps. */}

          {/* Several cars at once, picked by the code the registry calls them by — the same code
              the URL carries, so a filtered view is a link somebody else can read. */}
          <MultiSelect
            className="shrink-0"
            label={t('fleet.odometer.columns.vehicle')}
            options={vehicleOptions}
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
          {/* Either bound alone is a valid question ("from the 1st", "up to the 18th"), and the
              same date in both is one day — the server's `to` covers the whole day it names.

              A date input ignores `placeholder` in every browser and paints its own `yyyy/mm/dd`
              hint instead, so the two bounds are identical to look at and a caption is the only
              thing that can tell them apart. It goes BESIDE the control, inside the `<label>` that
              owns it — the same inline shape the recruitment filter bars already use for their
              date ranges — never stacked above it, which is what would put this bar out of step
              with the label-less filters around it and cost the row its height.

              `dir="ltr"` keeps the date reading left-to-right on an Arabic page, also as those
              bars do. The width is fixed and narrow: a date needs about ten characters and no
              more, and anything wider would eat the row. */}
          <label className="flex shrink-0 items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <span className="whitespace-nowrap">{t('fleet.odometer.fromDate')}</span>
            {/* The width lives on the wrapper: `Input` is `w-full` at its base and `cn` does not
                merge Tailwind classes, so a `w-*` passed to it would only compete with that. */}
            <span className="w-36">
              <Input
                id="odometer-from"
                type="date"
                dir="ltr"
                aria-label={t('fleet.odometer.fromDate')}
                title={t('fleet.odometer.fromDate')}
                value={from}
                onChange={(e) => patch({ from: e.target.value || null })}
              />
            </span>
          </label>
          <label className="flex shrink-0 items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <span className="whitespace-nowrap">{t('fleet.odometer.toDate')}</span>
            <span className="w-36">
              <Input
                id="odometer-to"
                type="date"
                dir="ltr"
                aria-label={t('fleet.odometer.toDate')}
                title={t('fleet.odometer.toDate')}
                value={to}
                onChange={(e) => patch({ to: e.target.value || null })}
              />
            </span>
          </label>
          {mayFilterByDriver && (
            <div className="w-44 shrink-0">
              <Input
                aria-label={t('fleet.odometer.columns.driver')}
                placeholder={t('fleet.odometer.driverPlaceholder')}
                value={driver}
                onChange={(e) => patch({ driver: e.target.value || null })}
              />
            </div>
          )}
          <MultiSelect
            className="shrink-0"
            label={t('fleet.odometer.columns.alert')}
            options={FLEET_ALARM_LEVELS.map((level) => ({
              value: level,
              label:
                level === 'none'
                  ? t('fleet.vehicle.alarmNone')
                  : t(`fleet.dashboard.level.${level}`),
            }))}
            value={alerts}
            onChange={(next) => patch({ alerts: next.length === 0 ? null : next.join(',') })}
          />
        </FilterBar>

        {hr.tooMany && (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('fleet.drivers.hrFilterTooMany', { matched: hr.matched, max: MAX_PAGE_SIZE })}
          </p>
        )}
        {hr.failed && (
          <p
            role="status"
            className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
          >
            {t('fleet.drivers.hrFilterUnavailable')}
          </p>
        )}

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(log) => log.id}
          loading={hr.loading || (isLoading && !blocked && !emptyMatch)}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sort}
          onSortChange={changeSort}
        />
        {data !== undefined && !blocked && !emptyMatch && data.meta.totalItems > 0 && (
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
        // Carried over from the filter, as it always was — but only when the filter names ONE
        // car. With several selected there is no single answer to preselect, and guessing one
        // would be worse than asking.
        initialVehicleId={
          vehicleCodes.length === 1
            ? ((vehicles.data?.items ?? []).find((v) => v.code === vehicleCodes[0])?.id ?? '')
            : ''
        }
      />
      <CorrectOdometerDialog
        open={correcting !== null}
        onClose={() => setCorrecting(null)}
        log={correcting}
      />
    </PageContainer>
  );
};
