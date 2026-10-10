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
import { useQueryClient } from '@tanstack/react-query';
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
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { fetchEmployeeNames, personCell } from '../lib/fleet-people';
import * as fleetApi from '../api/fleet-api';
import { EmptyState } from '../../../shared/ui/states/EmptyState';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { FleetPager } from '../components/FleetPager';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Input } from '../../../shared/ui/form';
import { EditIcon, TrashIcon } from '../../../shared/ui/icons';
import { Dialog } from '../../../shared/ui/Dialog';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useDeleteOdometer, useMaintenanceAlarms, useOdometerLogs } from '../api/fleet-queries';
import { cn } from '../../../shared/lib/cn';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { BoardIcon, NUM, PATH, ymd } from '../components/FuelCardBoard';
import { DARK_TABLE } from './VehiclesListPage';
import { AlarmBadge, alarmCellTint } from '../components/AlarmBadge';
import { RegistryDriverPicker } from '../components/RegistryDriverPicker';
import { odometerRange, widerRange } from '../lib/odometer-range';
import { DriverCell } from '../components/DriverPerson';
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

/** Every filter is `density="tight"`, as on the vehicles and drivers boards. */
const TIGHT = 'tight' as const;

/** The boards' toolbar pill (Excel), from the drivers screen. */
const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';

/** The vehicles board's add button — the purple gradient, for the one thing this screen creates. */
const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
const DEFAULT_SORT = 'date:desc';

/**
 * «تحسين شكل البيانات فى جداول العدادات»: a figure in the table as the vehicles and drivers boards
 * write one — Latin digits grouped with a comma, «150,250», never the Arabic-Indic «١٥٠٬٢٥٠» whose
 * light separator reads as one long number. A counter is read against the car's own dial, which
 * is written in Latin digits. The count over the table and the dialogs keep `formatNumber`.
 */
const LATIN = new Intl.NumberFormat('en-US');

/** The boards' figure: monospace, tabular, left to right, never broken over two lines. */
const FIGURE = cn('whitespace-nowrap', NUM);

/** An empty cell, as the boards draw one. */
const DASH = <span className="text-slate-400">—</span>;

export const OdometerPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  // The shared query cache, for the export's driver names — see `driverNames` below.
  const queryClient = useQueryClient();

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
  // The picker reads FLEET's roster now — see the workshop register beside this one.
  const mayFilterByDriver = can('fleetDriver.view');

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
  // «عاوز اقدر امسح قراءه» — the reading asked about, until it is confirmed or let go.
  const [deleting, setDeleting] = useState<FleetOdometerLogDto | null>(null);
  const remove = useDeleteOdometer();
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.odometer.deleted'));
    setDeleting(null);
  };

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  /**
   * THE DRIVERS' NAMES FOR A WHOLE EXPORT, through the very cache the table's cells fill.
   *
   * A driver column on screen is a `DriverCell`, and for an employee-backed row that is an HR
   * read: `driver1Name` is set only where HR has no employee for the spelling, so the register
   * itself carries an ID and nothing else for everyone still on the payroll. The export cannot
   * call the cell's hook — it runs in a callback, over rows that were never rendered — so it asks
   * for the same records by the SAME query key, fetcher and staleTime `useEmployeeRecord` uses.
   * That is not a second cache and not a second map: a name a cell already fetched is served from
   * the entry that cell filled, and a name fetched here makes the next cell free.
   *
   * ONE request, whatever the filter matched — Fleet's people are one list, and it is the very
   * list the cells read. Its own gate is inside `fetchEmployeeNames`: a reader who may not see the
   * roster gets an empty map, which is the same degradation the cells make rather than a failed
   * export.
   */
  const driverNames = async (
    logs: readonly FleetOdometerLogDto[],
  ): Promise<Map<string, string>> =>
    fetchEmployeeNames(
      queryClient,
      logs
        .flatMap((log) => [log.driver1EmployeeId, log.driver2EmployeeId])
        .filter((id): id is string => id !== null),
    );

  /**
   * «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات».
   *
   * THE FILTER'S WHOLE ANSWER, not the page's. `params` carries the reader's filters, their sort
   * AND their page; `filtersOnly` drops the last of the three and `fetchFilteredRows` walks every
   * page, so a reader who narrows to a month of three hundred readings gets three hundred rows
   * rather than the twenty-five in front of them. A file that is silently short is the worst kind
   * of wrong, because it looks complete. The sort rides along untouched: the file opens in the
   * order the reader is looking at, which is the order they will look for a row in.
   *
   * TWO CELLS ARE SPLIT, because a spreadsheet cell cannot stack a value and a badge. The
   * maintenance cell shows the distance since the last counting service AND the alarm level it
   * has reached; each takes a column. The reading columns keep their WORDS — «بدون قراءة» and the
   * open period are facts about the day, not blanks, and the column says so exactly as the table
   * does. Every genuine number goes in as a number, so the sheet stays summable; nothing here is
   * money, so there are no money columns. The row's correct action is a control, so it is left out.
   */
  const exportSheet = async (): Promise<void> => {
    const all = await fetchFilteredRows((pageNo, size) =>
      fleetApi.listOdometerLogs({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );
    const names = await driverNames(all);
    saveSheet(
      {
        name: t('fleet.nav.odometer'),
        serialHeader: t('fleet.violations.report.serial'),
        header: [
          t('fleet.odometer.fields.date'),
          t('fleet.odometer.columns.vehicle'),
          t('fleet.odometer.columns.driver1'),
          t('fleet.odometer.columns.driver2'),
          t('fleet.odometer.columns.outReading'),
          t('fleet.odometer.columns.inReading'),
          t('fleet.odometer.columns.km'),
          t('fleet.odometer.columns.notes'),
          t('fleet.odometer.columns.sinceService'),
          t('fleet.odometer.columns.alert'),
        ],
        rows: all.map((log) => {
          // The same join the maintenance column makes, and the same refusal: a car with no rule,
          // no service on file or no registry row prints nothing rather than a computed distance
          // the projection deliberately withheld.
          const alarm = log.vehicleId === null ? undefined : alarmByVehicle.get(log.vehicleId);
          const measured = alarm === undefined || alarm.sinceServiceKm === null ? undefined : alarm;
          return [
            formatDate(log.date, locale),
            log.vehicleCode ?? '',
            personCell(log.driver1EmployeeId, log.driver1Name, names),
            personCell(log.driver2EmployeeId, log.driver2Name, names),
            log.outReading ?? t('fleet.odometer.noReading'),
            // A day nobody wrote a counter down for closes nothing, so it is not the open period
            // either — the column is empty there, as the table's dash is.
            log.outReading === null ? '' : (log.inReading ?? t('fleet.odometer.openPeriod')),
            log.km ?? '',
            log.notes ?? '',
            measured?.sinceServiceKm ?? '',
            measured === undefined
              ? ''
              : measured.level === 'none'
                ? t('fleet.vehicle.alarmNone')
                : t(`fleet.dashboard.level.${measured.level}`),
          ];
        }),
      },
    );
  };
  /**
   * The toolbar's «Excel», as `ExportSheetButton` ran it: one file at a time, a spinner while the
   * rows are gathered, and a failure NAMED rather than swallowed — a button that silently does
   * nothing is read as broken, and the reader's next move is to press it again.
   */
  const [exporting, setExporting] = useState(false);
  const runExport = async (): Promise<void> => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportSheet();
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(false);
    }
  };

  /**
   * «2026/09/01» or «150,250»: one figure on the row, in the boards' figure — see `FIGURE`. An
   * empty cell is `DASH`, and a reading that is a STATE («بدون قراءة», the open period) keeps its
   * badge; neither comes through here.
   */
  const figure = (text: string): JSX.Element => (
    <span dir="ltr" className={FIGURE}>
      {text}
    </span>
  );
  /**
   * «5,250 كم»: the figure in the boards' figure, the unit in the page's own words — and in the
   * order the locale's sentence puts them, which is why the template is split rather than the
   * unit appended. A monospace face has no Arabic letters, so the unit must not wear it.
   */
  const [kmBefore = '', kmAfter = ''] = t('fleet.odometer.kmValue', { km: '\u0000' }).split(
    '\u0000',
  );

  // «تحسين شكل البيانات»: the drivers board's table — every value and header CENTRED, a date year
  // first with slashes, every figure in Latin digits with a comma, the car's code bold, an empty
  // cell a grey dash, and each driver drawn as the drivers board draws one (badge, name, code).
  // The row's actions stay at its end.
  const columns: Column<FleetOdometerLogDto>[] = [
    {
      key: 'date',
      align: 'center',
      header: t('fleet.odometer.fields.date'),
      sortable: true,
      render: (log) => figure(ymd(log.date)),
    },
    {
      key: 'vehicle',
      align: 'center',
      header: t('fleet.odometer.columns.vehicle'),
      // Ordered by the car's CODE, which the server joins in from the registry before it cuts the
      // page — the register is paged, so ordering the rows in hand would sort twenty-five
      // readings out of thousands and call it the register's order.
      sortable: true,
      sortKey: 'vehicleCode',
      // A SERVER fact on the row, like every other number in this table. `null` only when the
      // vehicle no longer exists at all — a scrapped one keeps its code.
      render: (log) =>
        log.vehicleCode === null ? (
          DASH
        ) : (
          <span dir="ltr" className={cn('text-sm font-bold', FIGURE)}>
            {log.vehicleCode}
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
    // were when they shared a cell. «اعتمد دى»: each shift in look ج — a person mark, the name in
    // the shift's tone, a rule, the code faint after it. An empty shift is a dash, never a blank.
    {
      key: 'driver1',
      align: 'center',
      header: t('fleet.odometer.columns.driver1'),
      sortable: true,
      sortKey: 'driver1Name',
      render: (log) => (
        <DriverCell
          employeeId={log.driver1EmployeeId}
          name={log.driver1Name}
          nameClassName="text-amber-700 dark:text-amber-300"
          look="person"
        />
      ),
    },
    {
      key: 'driver2',
      align: 'center',
      header: t('fleet.odometer.columns.driver2'),
      sortable: true,
      sortKey: 'driver2Name',
      render: (log) => (
        <DriverCell
          employeeId={log.driver2EmployeeId}
          name={log.driver2Name}
          nameClassName="text-indigo-700 dark:text-indigo-300"
          look="person"
        />
      ),
    },
    {
      key: 'outReading',
      header: t('fleet.odometer.columns.outReading'),
      sortable: true,
      align: 'center',
      // A DAY RECORDED WITH NO READING says so, in words. A dash would read as "nothing here" in
      // a column where every other row carries a number, and the reader would take the day for a
      // gap in the log rather than for what it is: a day somebody recorded, with a counter nobody
      // wrote down. It is also why the two reading columns cannot simply be blank — «بدون قراءة»
      // is the fact, and the alarm counts it.
      render: (log) =>
        log.outReading === null ? (
          <Badge tone="neutral">{t('fleet.odometer.noReading')}</Badge>
        ) : (
          figure(LATIN.format(log.outReading))
        ),
    },
    {
      key: 'inReading',
      header: t('fleet.odometer.columns.inReading'),
      align: 'center',
      // Such a row closes nothing, so it is NOT the open period either — the badge here means
      // "waiting for the next reading", and this row is not waiting for anything.
      render: (log) =>
        log.outReading === null ? (
          DASH
        ) : log.inReading === null ? (
          <Badge tone="info">{t('fleet.odometer.openPeriod')}</Badge>
        ) : (
          figure(LATIN.format(log.inReading))
        ),
    },
    {
      key: 'km',
      header: t('fleet.odometer.columns.km'),
      align: 'center',
      render: (log) => (log.km === null ? DASH : figure(LATIN.format(log.km))),
    },
    {
      key: 'notes',
      align: 'center',
      // The one free-text column, and a table column is sized by its content: a note carrying an
      // unbroken run of characters — a pasted reference, a URL — has no break point to wrap at, so
      // the column grows to fit it and pushes the columns after it off the screen. A bounded box
      // that is allowed to break inside a word gives the run somewhere to wrap, and keeps the
      // maintenance figure and the row's actions where the reader left them.
      header: t('fleet.odometer.columns.notes'),
      // `whitespace-normal`: the boards' table keeps its cells on one line, and a note that may
      // not wrap would spill over the columns beside it however bounded its box. `mx-auto`: a
      // block ignores the cell's centring, so the box itself is centred.
      render: (log) =>
        log.notes === null ? (
          DASH
        ) : (
          <span className="mx-auto block max-w-xs whitespace-normal break-words">{log.notes}</span>
        ),
    },
    {
      key: 'maintenance',
      align: 'center',
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
          return DASH;
        }
        return (
          // The tint is on this element, NOT on the row: a row here is one READING, and a car has
          // many — tinting them all would show five alarms for one car.
          <span
            className={cn(
              'inline-flex flex-wrap items-center justify-center gap-2',
              alarmCellTint(alarm.level),
            )}
          >
            <span className="whitespace-nowrap">
              {kmBefore}
              {figure(LATIN.format(alarm.sinceServiceKm))}
              {kmAfter}
            </span>
            <AlarmBadge level={alarm.level} />
          </span>
        );
      },
    },
    ...(can('fleetOdometer.correct') || can('fleetOdometer.delete')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'end',
            render: (log: FleetOdometerLogDto) => (
              // The boards' row actions: grey icons, the delete as grey as the rest.
              <span className="flex items-center justify-end gap-1">
                {can('fleetOdometer.correct') && (
                  <button
                    type="button"
                    className={actionButton}
                    aria-label={t('fleet.odometer.correct')}
                    title={t('fleet.odometer.correct')}
                    onClick={() => setCorrecting(log)}
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                )}
                {can('fleetOdometer.delete') && (
                  <button
                    type="button"
                    data-odometer-delete={log.id}
                    className={actionButton}
                    aria-label={t('common.delete')}
                    title={t('common.delete')}
                    onClick={() => setDeleting(log)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
              </span>
            ),
          } satisfies Column<FleetOdometerLogDto>,
        ]
      : []),
  ];

  /**
   * One date BOUND, in the boards' dark bar: the calendar icon inside the box, as every filter on
   * the vehicles board carries its icon.
   *
   * A date input ignores `placeholder` in every browser and paints its own `yyyy/mm/dd` hint
   * instead, and on this screen both bounds always hold a date (the defaulted month) — so the two
   * are identical to look at and a caption is the only thing that can tell them apart. It goes
   * BESIDE the control, inside the `<label>` that owns it, never stacked above it, which is what
   * would put this bar out of step with the label-less filters around it and cost the row its
   * height.
   *
   * `dir="ltr"` keeps the date reading left-to-right on an Arabic page. The width lives on the
   * wrapper: `Input` is `w-full` at its base and `cn` does not merge Tailwind classes, so a `w-*`
   * passed to it would only compete with that. A date needs about ten characters and no more —
   * until the bar shares its row on a computer, where the box fills its share beside its caption.
   */
  const dateBound = (id: string, labelKey: string, value: string, param: string): JSX.Element => (
    <label className="flex shrink-0 items-center gap-1.5 text-xs font-bold text-slate-500 dark:text-slate-400">
      <span className="whitespace-nowrap">{t(labelKey)}</span>
      <span className="w-36 lg:flex-1">
        <FilterWithIcon icon={FILTER_ICON.calendar} tone="text-cyan-600 dark:text-cyan-400">
          <Input
            id={id}
            type="date"
            dir="ltr"
            density={TIGHT}
            aria-label={t(labelKey)}
            title={t(labelKey)}
            value={value}
            onChange={(e) => patch({ [param]: e.target.value || null })}
            className="dark:[color-scheme:dark]"
          />
        </FilterWithIcon>
      </span>
    </label>
  );

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        {/* «زى شاشة السيارات و السواقيين»: no page title — the boards open on their toolbar. */}
        <div className="flex items-center justify-between gap-2" data-odometer-toolbar="true">
          {/* How many readings the filter matched, over the WHOLE set — `totalItems`, not the
              page's length, so turning a page never moves it. Nothing is written while the answer
              is in flight: a 0 there would be a claim. */}
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {data?.meta.totalItems === undefined
              ? ''
              : t('fleet.vehicle.count.odometer', {
                  count: formatNumber(data.meta.totalItems, locale),
                })}
          </span>
          <span className="flex shrink-0 items-center gap-1 sm:gap-2">
            {/* NOT OFFERED WHEN THE LIST FAILED. A green button on a screen that has just told
                the reader it has no data reads as a way out of the failure, and the file behind
                it would be empty or short. Disabling is not enough — it still draws. */}
            {!isError && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80">
                <button
                  type="button"
                  data-export="odometer"
                  title={t('fleet.export.excel')}
                  disabled={exporting}
                  onClick={() => void runExport()}
                  className={cn(
                    PILL_BUTTON,
                    'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300',
                  )}
                >
                  {exporting ? (
                    <Spinner className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <BoardIcon
                      d={PATH.excel}
                      className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                    />
                  )}
                  <span className="sm:hidden">Excel</span>
                  <span className="hidden sm:inline">{t('fleet.fuelCards.board.excel')}</span>
                </button>
              </div>
            )}
            <Can permission="fleetOdometer.record">
              <button
                type="button"
                data-odometer-record="true"
                onClick={() => setRecordOpen(true)}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t('fleet.odometer.record')}
              </button>
            </Can>
          </span>
        </div>

        {/* The vehicles board's dark bar: every filter's name written in its box, an icon at its
            start, one row on a computer — the bar shares the row between its filters there. */}
        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
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
          >
            {/* In the order the question is asked: which cars, over which days, driven by whom,
                in what state, saying what. Below a computer's width the bar wraps, each filter
                holding its own width and only the note box taking the leftover. */}

            {/* Several cars at once, picked by the code the registry calls them by — the same code
                the URL carries, so a filtered view is a link somebody else can read. */}
            <FilterWithIcon
              icon={FILTER_ICON.car}
              tone="text-emerald-600 dark:text-emerald-400"
              className="shrink-0"
            >
              <VehicleCodeFilter
                fullWidth
                density={TIGHT}
                value={vehicleCodes}
                onChange={(next) =>
                  patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
                }
              />
            </FilterWithIcon>
            {/* Either bound alone is a valid question ("from the 1st", "up to the 18th"), and the
                same date in both is one day — the server's `to` covers the whole day it names. */}
            {dateBound('odometer-from', 'fleet.odometer.fromDate', from, 'from')}
            {dateBound('odometer-to', 'fleet.odometer.toDate', to, 'to')}
            {/* WHO, picked off the drivers registry rather than typed. Several at once, because a
                question about a shift is usually a question about more than one person — and the
                same `multiple` the maintenance board's filter takes. The picker is `fullWidth`
                inside a box this row owns, so a long Arabic name does not stretch the row. */}
            {mayFilterByDriver && (
              <FilterWithIcon
                icon={FILTER_ICON.person}
                tone="text-emerald-600 dark:text-emerald-400"
                className="w-56 shrink-0"
              >
                <RegistryDriverPicker
                  multiple
                  fullWidth
                  density={TIGHT}
                  className="w-full"
                  value={drivers}
                  onChange={(next) => patch({ drv: next.length === 0 ? null : next.join(',') })}
                />
              </FilterWithIcon>
            )}
            <FilterWithIcon
              icon={FILTER_ICON.status}
              tone="text-amber-600 dark:text-amber-400"
              className="shrink-0"
            >
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
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
            </FilterWithIcon>
            {/* THE NOTE, SEARCHED — «خلى في انبوت يسمح ان ابحث بالملاحظات». The register already
                SHOWS «ملاحظات» as a column, and a column a reader can see but not search is one
                they scroll past; this log runs to thousands of rows. Below a computer's width it
                takes a SHARE of whatever the row has left rather than a fixed width. */}
            <FilterWithIcon
              icon={PATH.edit}
              tone="text-slate-500 dark:text-slate-400"
              className="min-w-[8rem] flex-1"
            >
              <Input
                aria-label={t('fleet.odometer.columns.notes')}
                placeholder={t('fleet.maintenance.notesFilter')}
                density={TIGHT}
                value={notes}
                onChange={(e) => patch({ notes: e.target.value || null })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {/* The drivers board's table — «زى السيارات و السواقيين». */}
        <div
          className={cn(
            DARK_TABLE,
            BOARD_TABLE_FILL,
            // «شيل الخطوط اللى بين العواميد»: no line between the columns, as on the drivers board.
            '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
            // «خلى الكلام bold»: every value heavy, the Arabic in Cairo's own bold.
            "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
          )}
        >
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
            minColumnWidth={4}
            stickyHead
          />
        </div>
        {data !== undefined && data.meta.totalItems > 0 && (
          <FleetPager
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
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.odometer.deleteTitle')}
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
        {deleting !== null && (
          <div className="space-y-2 text-sm text-slate-600 dark:text-slate-300">
            <p className="font-medium text-slate-800 dark:text-slate-100">
              {t('fleet.odometer.deleteWhich', {
                code: deleting.vehicleCode ?? '—',
                date: formatDate(deleting.date, locale),
                reading:
                  deleting.outReading === null ? '—' : formatNumber(deleting.outReading, locale),
              })}
            </p>
            <p>{t('fleet.odometer.deleteBody')}</p>
          </div>
        )}
      </Dialog>
    </PageContainer>
  );
};
