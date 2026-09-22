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
  type FleetMaintenanceAlarmDto,
  type FleetOdometerLogDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { Can, useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Input } from '../../../shared/ui/form';
import { EditIcon, PlusIcon } from '../../../shared/ui/icons';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useMaintenanceAlarms, useOdometerLogs } from '../api/fleet-queries';
import { FilteredCount } from '../components/FilteredCount';
import { cn } from '../../../shared/lib/cn';
import { AlarmBadge, alarmCellTint } from '../components/AlarmBadge';
import { RegistryDriverPicker } from '../components/RegistryDriverPicker';
import { odometerRange, widerRange } from '../lib/odometer-range';
import { DriverName } from '../components/EmployeeName';
import { RecordOdometerDialog } from '../components/RecordOdometerDialog';
import { CorrectOdometerDialog } from '../components/CorrectOdometerDialog';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'alerts',
  'drv',
  'from',
  'to',
  'vehicleCodes',
  'notes',
  'size',
  'sort',
] as const;

const DEFAULT_PAGE_SIZE = 25;

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
const DEFAULT_SORT = 'date:desc';

export const OdometerPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const vehicleCodes = (sp.get('vehicleCodes') ?? '').split(',').filter((c) => c !== '');
  // What the URL asks for, and what is actually sent. They differ only on arrival: with neither
  // bound given the request is narrowed to the CURRENT MONTH rather than the whole history, and
  // the two date boxes show that month so the reader can see which days they are looking at.
  // `now` is read once per mount — a value that changed every render would rebuild the request.
  const now = useMemo(() => new Date(), []);
  const range = odometerRange({ from: sp.get('from') ?? '', to: sp.get('to') ?? '' }, now);
  const from = range.from;
  const to = range.to;
  // WHO, as ids picked off the drivers registry — not as a string HR has to search for.
  // `drv` is the drivers screen's own parameter name, so a filtered link reads the same on both.
  const drivers = (sp.get('drv') ?? '').split(',').filter((id) => id !== '');
  const alerts = (sp.get('alerts') ?? '').split(',').filter((a) => a !== '');
  const notes = sp.get('notes') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  /**
   * The columns this table is sorted by, in the order the reader clicked them —
   * «انا عاوز اقدر اعمل الاتنين مع بعض». One parameter carries the whole order; `date:desc`
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
  // The defaulted month is not an "active filter": it is where the page starts, so the reset
  // affordance stays off until the reader has actually narrowed something.
  const hasActiveFilters =
    vehicleCodes.length > 0 ||
    !range.defaulted ||
    drivers.length > 0 ||
    alerts.length > 0 ||
    notes !== '';

  // NO HR SEARCH STEP ANY MORE.
  //
  // The filter used to be a text box: whatever was typed went to HR as one `search`, and the ids
  // that came back narrowed this table. That is three failure modes the reader had to be told
  // about — HR still answering, HR matching more than one page, HR refusing — and each needed its
  // own banner above the grid. It also searched the WHOLE payroll, so a reader could type an
  // accountant's name and get an empty odometer with the bar insisting a driver was selected.
  //
  // Picking from the drivers REGISTRY removes all of it. The ids are already ids, so there is
  // nothing to resolve before the table can be asked; and everyone offered holds a seat that
  // requires a driving test, so every offer is a driver this table could actually show.
  const mayFilterByDriver = can('employee.view');

  /** WHAT THE READER IS LOOKING AT — the filters, and only the filters. */
  const filters = useMemo(
    () => ({
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      from: from || undefined,
      to: to || undefined,
      alerts: alerts.length > 0 ? alerts : undefined,
      driverEmployeeIds: drivers.length > 0 ? drivers : undefined,
      notes: notes || undefined,
    }),
    [paramsKey],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, ...sortQuery(sorts) }),
    [filters, page, pageSize, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useOdometerLogs(params);
  const rows = data?.items ?? [];

  /**
   * THE MONTH IS THE REASON THE TABLE IS EMPTY — say so, and offer the way out.
   *
   * Opening the screen narrows the request to the current month (`odometerRange`), which is right:
   * the log grows one row per vehicle per day it runs, and "no date filter" would be a request for
   * the whole history. But on a fleet whose last reading was filed in a previous month it means
   * the reader lands on an empty grid under a bar that shows no active filter, and nothing on the
   * screen says the range is why. «خليه زى ما هو وضيف رسالة وزرار» — the default stays exactly as
   * it was, and the empty cell explains itself instead.
   *
   * Only when the month is ACTUALLY the reason: the range must be the defaulted one, and no other
   * filter may be narrowing the question. With a car or a driver or an alarm level picked, the
   * honest answer is the generic «no results» — widening the dates would not necessarily find
   * anything, and a button promising it would be a guess.
   */
  const monthIsTheReason =
    range.defaulted && vehicleCodes.length === 0 && drivers.length === 0 && alerts.length === 0;
  const wider = widerRange(now);
  const emptyMonth = (
    <EmptyState
      title={t('fleet.odometer.emptyMonth.title')}
      description={t('fleet.odometer.emptyMonth.description')}
      action={
        <Button
          size="sm"
          variant="secondary"
          onClick={() => patch({ from: wider.from, to: wider.to })}
        >
          {t('fleet.odometer.emptyMonth.action')}
        </Button>
      }
    />
  );

  // The vehicle CODE arrives on the row (`vehicleCode`), resolved server-side. It used to be
  // joined here from one page of the registry, which silently bounded the answer at
  // `MAX_PAGE_SIZE` vehicles: every car past that page printed a dash instead of its code.

  // The maintenance figure, per vehicle, from the SAME derived projection the alarms board reads.
  // One call for the whole page; the join here is display only — the level filter is server-side.
  const alarmsQuery = useMaintenanceAlarms();
  const alarmByVehicle = useMemo(() => {
    const map = new Map<string, Pick<FleetMaintenanceAlarmDto, 'sinceServiceKm' | 'level'>>();
    for (const alarm of alarmsQuery.data ?? []) {
      map.set(alarm.vehicleId, { sinceServiceKm: alarm.sinceServiceKm, level: alarm.level });
    }
    return map;
  }, [alarmsQuery.data]);

  const [recordOpen, setRecordOpen] = useState(false);
  const [correcting, setCorrecting] = useState<FleetOdometerLogDto | null>(null);

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetOdometerLogDto>[] = [
    {
      key: 'date',
      header: t('fleet.odometer.fields.date'),
      sortable: true,
      render: (log) => <span className="tabular-nums">{formatDate(log.date, locale)}</span>,
    },
    {
      key: 'vehicle',
      header: t('fleet.odometer.columns.vehicle'),
      // Ordered by the car's CODE, which the server joins in from the registry before it cuts the
      // page — the register is paged, so ordering the rows in hand would sort twenty-five
      // readings out of thousands and call it the register's order.
      sortable: true,
      sortKey: 'vehicleCode',
      // A SERVER fact on the row, like every other number in this table. `null` only when the
      // vehicle no longer exists at all — a scrapped one keeps its code.
      render: (log) => (
        <span className="font-mono text-xs" dir="ltr">
          {log.vehicleCode ?? '—'}
        </span>
      ),
    },
    // TWO COLUMNS, ONE PER SHIFT — «تفصل الصباحى عن المسائى كل واحد فى عمود».
    //
    // They were one cell with two captioned lines, which fitted the grid's eleven columns onto a
    // screen and cost nothing a reader could name. What it did cost is an ORDER: a cell holding
    // two people has no single value, so «رتب بإسم السائق» had no column to point at. Split, each
    // shift is its own question and takes its own arrow — and the arrow orders the whole register,
    // because the name is joined in by the server before the page is cut (`driverNameSorts`).
    //
    // The tones stay what they were, one per shift, so the two columns still read as the pair they
    // were when they shared a cell. An empty shift is a dash, never a blank.
    {
      key: 'driver1',
      header: t('fleet.odometer.columns.driver1'),
      sortable: true,
      sortKey: 'driver1Name',
      render: (log) =>
        log.driver1EmployeeId === null && !log.driver1Name ? (
          '—'
        ) : (
          <span className="text-amber-700 dark:text-amber-300">
            <DriverName employeeId={log.driver1EmployeeId} name={log.driver1Name} />
          </span>
        ),
    },
    {
      key: 'driver2',
      header: t('fleet.odometer.columns.driver2'),
      sortable: true,
      sortKey: 'driver2Name',
      render: (log) =>
        log.driver2EmployeeId === null && !log.driver2Name ? (
          '—'
        ) : (
          <span className="text-indigo-700 dark:text-indigo-300">
            <DriverName employeeId={log.driver2EmployeeId} name={log.driver2Name} />
          </span>
        ),
    },
    {
      key: 'outReading',
      header: t('fleet.odometer.columns.outReading'),
      sortable: true,
      align: 'end',
      // A DAY RECORDED WITH NO READING says so, in words. A dash would read as "nothing here" in
      // a column where every other row carries a number, and the reader would take the day for a
      // gap in the log rather than for what it is: a day somebody recorded, with a counter nobody
      // wrote down. It is also why the two reading columns cannot simply be blank — «بدون قراءة»
      // is the fact, and the alarm counts it.
      render: (log) =>
        log.outReading === null ? (
          <Badge tone="neutral">{t('fleet.odometer.noReading')}</Badge>
        ) : (
          formatNumber(log.outReading, locale)
        ),
    },
    {
      key: 'inReading',
      header: t('fleet.odometer.columns.inReading'),
      align: 'end',
      // Such a row closes nothing, so it is NOT the open period either — the badge here means
      // "waiting for the next reading", and this row is not waiting for anything.
      render: (log) =>
        log.outReading === null ? (
          <span className="text-slate-400">—</span>
        ) : log.inReading === null ? (
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
      // Ordered by the CAR's figure, computed for the fleet and handed to the query — see
      // `alarm-sort.ts`. A car the projection has no answer for sorts with the other blanks.
      sortable: true,
      sortKey: 'alarmSinceService',
      render: (log) => {
        const alarm = log.vehicleId === null ? undefined : alarmByVehicle.get(log.vehicleId);
        // No rule, no service on file, or a vehicle that has left the registry: say nothing
        // rather than print a distance the projection deliberately refused to compute.
        // A DISTANCE column, and only that. The reason an alarm is unavailable is a fact about the
        // VEHICLE, and rows here are READINGS — one car has many, so a sentence repeated down all
        // of them reads as several problems instead of one. It is said once per car, on the
        // alarms board, where a row IS a vehicle.
        if (alarm === undefined || alarm.sinceServiceKm === null) {
          return <span className="text-slate-400">—</span>;
        }
        return (
          // The tint is on this element, NOT on the row: a row here is one READING, and a car has
          // many — tinting them all would show five alarms for one car.
          <span
            className={cn('inline-flex flex-wrap items-center gap-2', alarmCellTint(alarm.level))}
          >
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
          // 1400 was measured for this bar plus its reset; the count badge beside them is new
          // width, and `singleRow` does not SHORTEN a row that will not fit — it pushes it off
          // the page. So the threshold moves up with the row rather than staying where it was.
          singleRowFrom={1440}
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({
              vehicleCodes: null,
              from: null,
              to: null,
              drv: null,
              alerts: null,
              notes: null,
            })
          }
          // How many readings the filter matched, over the WHOLE set — `totalItems`, not the
          // page's length, so turning a page never moves it.
          trailing={<FilteredCount value={data?.meta.totalItems} />}
        >
          {/* One row on a desktop, in the order the question is asked: which cars, over which
              days, driven by whom, in what state. Every filter is `shrink-0` and sized to what it
              holds — none of them takes the leftover space, so the row reads as five controls
              rather than one stretched one. Narrower than the row needs, the bar wraps. */}

          {/* Several cars at once, picked by the code the registry calls them by — the same code
              the URL carries, so a filtered view is a link somebody else can read. */}
          <VehicleCodeFilter
            className="shrink-0"
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
          {/* WHO, picked off the drivers registry rather than typed. Several at once, because a
              question about a shift is usually a question about more than one person — and the
              same `multiple` the maintenance board's filter takes. The width is fixed like every
              other control on this bar: the picker is `fullWidth` inside a box this row owns, so
              a long Arabic name does not stretch the row the way an intrinsic width would. */}
          {mayFilterByDriver && (
            <div className="w-56 shrink-0">
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
          {/* THE NOTE, SEARCHED — «خلى في انبوت يسمح ان ابحث بالملاحظات». The register already
              SHOWS «ملاحظات» as a column, and a column a reader can see but not search is one
              they scroll past; this log runs to thousands of rows. Unlike the controls before it
              this one takes a SHARE of whatever the row has left rather than a fixed width, so
              adding it cannot push the bar off the page. */}
          <div className="min-w-[8rem] flex-1">
            <Input
              aria-label={t('fleet.odometer.columns.notes')}
              placeholder={t('fleet.maintenance.notesFilter')}
              value={notes}
              onChange={(e) => patch({ notes: e.target.value || null })}
              textScale="comfortable"
            />
          </div>
        </FilterBar>

        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(log) => log.id}
          loading={isLoading}
          error={isError ? error : undefined}
          onRetry={() => void refetch()}
          sort={sorts}
          onSortChange={changeSort}
          {...(monthIsTheReason ? { empty: emptyMonth } : {})}
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
        // Carried over from the filter, as it always was — but only when the filter names ONE
        // car. With several selected there is no single answer to preselect, and guessing one
        // would be worse than asking.
        // The CODE, not an id: the page no longer holds the whole registry to look an id up in,
        // and resolving one against the current search shortlist would drop the carry-over for
        // exactly the cars this change is about — a filtered code the shortlist does not carry.
        // The dialog asks the registry for the code it is given.
        initialVehicleCode={vehicleCodes.length === 1 ? (vehicleCodes[0] ?? '') : ''}
      />
      <CorrectOdometerDialog
        open={correcting !== null}
        onClose={() => setCorrecting(null)}
        log={correcting}
      />
    </PageContainer>
  );
};
