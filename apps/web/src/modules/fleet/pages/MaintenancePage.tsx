// Maintenance visits (FW-6, legacy /cars_maintenance): the workshop lifecycle exactly as FL-4
// enforces it — one open visit per vehicle (FR-4), check-out records the exit reading and the
// custody, reopen undoes a mistaken check-out, and the closed counting visit is what resets the
// alarm cycle (owner point 5).
//
// Filtering is server-side throughout, including the two questions the visit collection cannot
// answer by itself: vehicle CODES resolve against the registry, and a driver NAME is HR's fact
// resolved through HR's own endpoint first. Nothing is filtered out of a fetched page.
//
// «حالة الصيانة» is ONE filter, not two, because the visit has exactly one state: design §4.2 gives
// it `open` ↔ `closed` and §2.6 stores no status beside them. «داخل الورشة» and «خرج من الورشة» are
// the two halves of that field. The derived alarm level (FR-3) is a property of the VEHICLE, not a
// maintenance status, and is deliberately not offered here as one.
//
// THE ALARM COLUMNS ARE THE SERVER'S PROJECTION, READ — never recomputed here. They come from the
// same `useMaintenanceAlarms` hook, on the same query key, that the alarms board and the odometer
// log read, so the three screens cannot disagree about a vehicle: one engine (`computeAlarm`),
// one cache entry. WHICH endpoint serves it is the hook's business, not this screen's — the same
// projection is exposed behind `fleetMaintenance.view` and behind `fleetOdometer.view`, and the
// hook picks the door the reader actually holds. A future change to the rule moves all three
// screens at once because there is only one thing to change.
//
// They describe the VEHICLE, not the row. Several visits of one car therefore repeat its figures,
// which is correct — «متبقٍ ٤٠٠ كم» is a fact about the car, not about the visit being looked at.
// What IS about the row is `lastServiceVisitId`: the visit that set the current baseline is marked,
// so a reader can see which service the countdown is measured from.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  type FleetCatalogItemDto,
  type FleetMaintenanceAlarmDto,
  type FleetMaintenanceVisitDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilteredCount } from '../components/FilteredCount';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input, Select } from '../../../shared/ui/form';
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
  useMaintenanceAlarms,
  useMaintenanceVisits,
  useReopenMaintenance,
} from '../api/fleet-queries';
import { RegistryDriverPicker } from '../components/RegistryDriverPicker';
import { DriverName } from '../components/EmployeeName';
import { RemainingKm } from '../components/AlarmBadge';
import {
  CheckInDialog,
  CheckOutDialog,
  MaintenanceEditDialog,
} from '../components/MaintenanceDialogs';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'drv',
  'from',
  'notes',
  'outFrom',
  'parts',
  'state',
  'vehicleCodes',
  'workTypes',
  'workshops',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/** A csv URL parameter as the list it stands for; an absent one is an empty list, never `['']`. */
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
const DEFAULT_SORT = 'inDate:desc';

export const MaintenancePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const from = sp.get('from') ?? '';
  const outFrom = sp.get('outFrom') ?? '';
  const vehicleCodes = csv(sp.get('vehicleCodes'));
  // WHO, as ids picked off the drivers registry — the same `drv` parameter the drivers screen
  // and the odometer carry, so a filtered link reads the same on all three.
  const drivers = csv(sp.get('drv'));
  const workshopIds = csv(sp.get('workshops'));
  const workTypeIds = csv(sp.get('workTypes'));
  const sparePartIds = csv(sp.get('parts'));
  const notes = sp.get('notes') ?? '';
  const state = sp.get('state') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  /**
   * The columns this table is sorted by, in the order the reader clicked them —
   * «انا عاوز اقدر اعمل الاتنين مع بعض». One parameter carries the whole order; `inDate:desc`
   * is where the screen starts when the reader has not said otherwise.
   */
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);
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
  // Ascending, then descending, then out of the order altogether — and a column the table
  // is NOT sorted by joins the end of it rather than replacing what is there.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };
  const hasActiveFilters =
    from !== '' ||
    outFrom !== '' ||
    vehicleCodes.length > 0 ||
    drivers.length > 0 ||
    workshopIds.length > 0 ||
    workTypeIds.length > 0 ||
    sparePartIds.length > 0 ||
    notes !== '' ||
    state !== '';

  // NO HR SEARCH STEP ANY MORE — see the same note on `OdometerPage`. A text box routed through
  // HR's `search` brought three states the reader had to be warned about (still answering, more
  // matches than one page, refused) and searched the whole payroll, so a name that belonged to
  // nobody with a driving seat returned an empty grid under a bar insisting a driver was picked.
  // Ids picked off the registry need no resolving and can only name people this table can show.
  const mayFilterByDriver = can('employee.view');

  /** WHAT THE READER IS LOOKING AT — the filters, and only the filters. */
  const filters = useMemo(
    () => ({
      from: from || undefined,
      outFrom: outFrom || undefined,
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      workshopIds: workshopIds.length > 0 ? workshopIds : undefined,
      workTypeIds: workTypeIds.length > 0 ? workTypeIds : undefined,
      sparePartIds: sparePartIds.length > 0 ? sparePartIds : undefined,
      notes: notes || undefined,
      open: state === '' ? undefined : state === 'open',
      // Matched against the entry driver OR the exit driver, server-side.
      driverEmployeeIds: drivers.length > 0 ? drivers : undefined,
    }),
    [paramsKey],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, ...sortQuery(sorts) }),
    [filters, page, pageSize, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useMaintenanceVisits(params);
  const rows = data?.items ?? [];

  /**
   * The vehicle's maintenance alarm, from the ONE server projection the other two screens read.
   *
   * `useMaintenanceAlarms` is the same hook and the same query key the alarms
   * board and the odometer log use, so all three repaint together and none of them can hold a
   * different answer for the same car. Nothing about the level, the interval or the thresholds is
   * decided here — this screen only looks the vehicle up.
   *
   * Gated on `fleetOdometer.view` because that is the grant the endpoint carries. A reader who may
   * see the workshop but not the odometer gets the visits without these two columns rather than a
   * 403 that would take the whole page down — see the report's open question about that grant.
   */
  const alarmsQuery = useMaintenanceAlarms();
  const alarmByVehicle = useMemo(() => {
    const map = new Map<string, FleetMaintenanceAlarmDto>();
    for (const alarm of alarmsQuery.data ?? []) map.set(alarm.vehicleId, alarm);
    return map;
  }, [alarmsQuery.data]);

  // The three catalogs the screen names — the same admin-owned lists the Fleet Catalogs screen
  // edits, read through the same per-kind cached hook one request at a time.
  const workshops = useFleetCatalog('workshop');
  const workTypes = useFleetCatalog('workType');
  const spareParts = useFleetCatalog('sparePart');
  const optionsOf = (items: readonly FleetCatalogItemDto[] | undefined) =>
    (items ?? []).map((item) => ({ value: item.id, label: localized(item.name, locale) }));
  const workshopOptions = useMemo(() => optionsOf(workshops.data?.items), [workshops.data, locale]);
  const workTypeOptions = useMemo(() => optionsOf(workTypes.data?.items), [workTypes.data, locale]);
  const sparePartOptions = useMemo(
    () => optionsOf(spareParts.data?.items),
    [spareParts.data, locale],
  );
  const catalogName = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of [
      ...(workshops.data?.items ?? []),
      ...(workTypes.data?.items ?? []),
      ...(spareParts.data?.items ?? []),
    ]) {
      map.set(item.id, localized(item.name, locale));
    }
    return map;
  }, [workshops.data, workTypes.data, spareParts.data, locale]);

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
  const dash = <span className="text-slate-400">—</span>;

  const columns: Column<FleetMaintenanceVisitDto>[] = [
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
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      // The car's CODE, joined in by the server before the page is cut — see the odometer board.
      sortable: true,
      sortKey: 'vehicleCode',
      // A SERVER fact on the row. `null` only when the vehicle no longer exists at all — a
      // scrapped one keeps its code, so history stays readable.
      render: (visit) => (
        <span className="font-mono text-xs" dir="ltr">
          {visit.vehicleCode ?? '—'}
        </span>
      ),
    },
    // TWO COLUMNS, ONE PER LEG — «تفصل الصباحى عن المسائى كل واحد فى عمود», the same split the
    // odometer register just took. The grid printed both drivers in one cell, one above the other,
    // which reads perfectly well and cannot be ORDERED: a cell holding two people has no single
    // value for «رتب بإسم السائق» to point at. Each leg is now its own column with its own arrow,
    // and the arrow orders the whole register — the name is joined in by the server before the
    // page is cut.
    //
    // The tones are the ones the shared cell used: the entry driver in the danger tone, the exit
    // driver in the success tone. Deliberately NOT `takenInByEmployeeId` / `takenOutByEmployeeId`:
    // those are the custody employees, they belong to the audit trail, and this grid never showed
    // them. An open visit has no exit driver yet, and that is a dash.
    {
      key: 'driverIn',
      header: t('fleet.maintenance.fields.driverIn'),
      sortable: true,
      sortKey: 'driverInName',
      render: (visit) =>
        visit.driverInEmployeeId === null && !visit.driverInName ? (
          dash
        ) : (
          <span className="text-red-700 dark:text-red-300">
            <DriverName employeeId={visit.driverInEmployeeId} name={visit.driverInName} />
          </span>
        ),
    },
    {
      key: 'driverOut',
      header: t('fleet.maintenance.fields.driverOut'),
      sortable: true,
      sortKey: 'driverOutName',
      render: (visit) =>
        visit.driverOutEmployeeId === null && !visit.driverOutName ? (
          dash
        ) : (
          <span className="text-emerald-700 dark:text-emerald-300">
            <DriverName employeeId={visit.driverOutEmployeeId} name={visit.driverOutName} />
          </span>
        ),
    },
    {
      key: 'workshop',
      header: t('fleet.maintenance.fields.workshop'),
      render: (visit) => catalogName.get(visit.workshopId) ?? dash,
    },
    {
      key: 'workType',
      header: t('fleet.maintenance.fields.workType'),
      render: (visit) => catalogName.get(visit.workTypeId) ?? dash,
    },
    {
      key: 'spareParts',
      header: t('fleet.maintenance.fields.spareParts'),
      // Catalog parts first, then whatever an older visit recorded as free text. The old words
      // are the only record of what was fitted on those visits, so they are SHOWN rather than
      // migrated by name — a name match would have silently dropped everything it could not pair.
      render: (visit) => {
        const named = visit.sparePartIds.map((id) => catalogName.get(id) ?? id);
        const legacy = visit.spareParts;
        if (named.length === 0 && legacy.length === 0) return dash;
        return (
          <span className="flex flex-col gap-0.5">
            {named.length > 0 && (
              <span className="block max-w-xs break-words">{named.join('، ')}</span>
            )}
            {legacy.length > 0 && (
              <span className="block max-w-xs break-words text-xs text-slate-500 dark:text-slate-400">
                {t('fleet.maintenance.legacyParts')}: {legacy.join('، ')}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'odometerAtService',
      header: t('fleet.maintenance.fields.odometerAtService'),
      // A stored figure on the visit, so the whole register orders by it for free.
      sortable: true,
      align: 'end',
      render: (visit) => formatNumber(visit.odometerAtService, locale),
    },
    {
      key: 'sinceServiceKm',
      // A figure about the CAR, computed for the fleet and handed to the query — see
      // `alarm-sort.ts`; a car the projection cannot answer for sorts with the other blanks.
      sortable: true,
      sortKey: 'alarmSinceService',
      header: t('fleet.alarms.columns.sinceService'),
      align: 'end',
      render: (visit) => {
        const alarm = visit.vehicleId === null ? undefined : alarmByVehicle.get(visit.vehicleId);
        if (alarm === undefined || alarm.sinceServiceKm === null) return dash;
        return (
          <span className="tabular-nums">
            {t('fleet.odometer.kmValue', { km: formatNumber(alarm.sinceServiceKm, locale) })}
          </span>
        );
      },
    },
    {
      key: 'remainingKm',
      // A figure about the CAR, computed for the fleet and handed to the query — see
      // `alarm-sort.ts`; a car the projection cannot answer for sorts with the other blanks.
      sortable: true,
      sortKey: 'alarmRemaining',
      header: t('fleet.alarms.columns.remaining'),
      align: 'end',
      render: (visit) => {
        const alarm = visit.vehicleId === null ? undefined : alarmByVehicle.get(visit.vehicleId);
        if (alarm === undefined) return dash;
        // A negative remainder is OVERDUE, and says so — see `RemainingKm`.
        return (
          <RemainingKm
            remainingKm={alarm.remainingKm}
            locale={locale}
            formatNumber={formatNumber}
          />
        );
      },
    },
    {
      key: 'notes',
      // LAST of the data columns, by request — «الملاحظات تكون اخر حاجه خالص». It is also where
      // it does least harm: the one free-text column, and a table column is sized by its content,
      // so an unbroken run of characters has no break point to wrap at and the column grows to fit
      // it. A bounded box allowed to break inside a word keeps the rest of the row honest, and at
      // the end there is nothing left for it to push off the screen anyway.
      //
      // `actions` still follows it: those are the row's CONTROLS, not a fact about the visit, and
      // they sit at the end of every other grid in the module.
      header: t('fleet.odometer.columns.notes'),
      render: (visit) =>
        visit.notes === null ? (
          dash
        ) : (
          <span className="block max-w-xs break-words">{visit.notes}</span>
        ),
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

  /**
   * One date BOUND. The width lives on the wrapper: `Input` is `w-full` at its base and `cn` does
   * not merge Tailwind classes, so a `w-*` passed to it would only compete with that. `w-36` is
   * the floor — Chromium refuses to paint `type="date"` narrower than about 144px.
   */
  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => (
    <span className="w-36">
      <Input
        type="date"
        dir="ltr"
        aria-label={t(labelKey)}
        title={t(labelKey)}
        value={value}
        onChange={(e) => patch({ [param]: e.target.value || null })}
      />
    </span>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.maintenance')}
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
        {/* Ten filters, in the order the question is asked, each sized to what it holds so the row
            packs as tightly as it honestly can: the two date ranges and the counter range are ONE
            caption apiece rather than two, and nothing takes the leftover space.
            
            They are NOT pinned to one row. `flex-nowrap` does not shorten a row that will not fit,
            it pushes it off the page — so the bar wraps, filling a wide desktop left to right and
            flowing onto a second line only where the viewport actually runs out. No horizontal
            page scroll, nothing clipped, nothing overlapping. */}
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({
              from: null,
              outFrom: null,
              vehicleCodes: null,
              drv: null,
              workshops: null,
              workTypes: null,
              parts: null,
              notes: null,
              state: null,
            })
          }
          // How many visits the filter matched, over the WHOLE set — see the odometer register.
          trailing={<FilteredCount value={data?.meta.totalItems} />}
        >
          {/* One bound, not a range: the screen asks "checked in from this date". */}
          <label className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <span className="whitespace-nowrap">{t('fleet.maintenance.inRange')}</span>
            {dateBound('fleet.maintenance.inRange', from, 'from')}
          </label>
          <label className="flex flex-wrap items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <span className="whitespace-nowrap">{t('fleet.maintenance.outRange')}</span>
            {dateBound('fleet.maintenance.outRange', outFrom, 'outFrom')}
          </label>
          <VehicleCodeFilter
            className="shrink-0"
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
          {/* Several drivers at once: a visit is matched on its ENTRY driver or its EXIT driver,
              so asking about a crew is one question, not two searches run in turn. */}
          {mayFilterByDriver && (
            <div className="w-52 min-w-0">
              <RegistryDriverPicker
                multiple
                fullWidth
                value={drivers}
                onChange={(next) => patch({ drv: next.length === 0 ? null : next.join(',') })}
              />
            </div>
          )}
          <MultiSelect
            className="shrink-0"
            showSelectedValues
            label={t('fleet.maintenance.fields.workshop')}
            options={workshopOptions}
            value={workshopIds}
            onChange={(next) => patch({ workshops: next.length === 0 ? null : next.join(',') })}
          />
          <MultiSelect
            className="shrink-0"
            showSelectedValues
            label={t('fleet.maintenance.fields.workType')}
            options={workTypeOptions}
            value={workTypeIds}
            onChange={(next) => patch({ workTypes: next.length === 0 ? null : next.join(',') })}
          />
          <MultiSelect
            className="shrink-0"
            showSelectedValues
            label={t('fleet.maintenance.fields.spareParts')}
            options={sparePartOptions}
            value={sparePartIds}
            onChange={(next) => patch({ parts: next.length === 0 ? null : next.join(',') })}
          />
          <div className="w-40 min-w-0">
            <Input
              aria-label={t('fleet.odometer.columns.notes')}
              placeholder={t('fleet.maintenance.notesFilter')}
              value={notes}
              onChange={(e) => patch({ notes: e.target.value || null })}
            />
          </div>
          {/* «حالة الصيانة» — the visit's one state, in the words the screen uses for it. */}
          <Select
            aria-label={t('fleet.maintenance.stateFilter')}
            title={t('fleet.maintenance.stateFilter')}
            value={state}
            onChange={(e) => patch({ state: e.target.value || null })}
            className="w-auto shrink-0"
          >
            <option value="">{t('fleet.maintenance.allStates')}</option>
            <option value="open">{t('fleet.maintenance.stillIn')}</option>
            <option value="closed">{t('fleet.maintenance.leftWorkshop')}</option>
          </Select>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(visit) => visit.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sorts}
          onSortChange={changeSort}
          // A closed visit reads green across the whole row. The colour is a SECOND signal only:
          // the exit cell says «خرجت من الورشة» in words, so the state survives a reader who
          // cannot separate the two tints.
          rowClassName={(visit) =>
            visit.outDate === null ? undefined : 'bg-emerald-50/70 dark:bg-emerald-950/30'
          }
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
        // Carried over from the filter, but only when it names ONE car: with several selected
        // there is no single answer to preselect, and guessing one would be worse than asking.
        initialVehicleCode={vehicleCodes.length === 1 ? (vehicleCodes[0] ?? '') : ''}
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
