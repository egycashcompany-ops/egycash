// Maintenance alarms (FW-6, legacy /cars_alarm): the FR-3 projection exactly as the server
// derives it per request — remaining = interval − (latest reading − counter at last counting
// service) — nothing recomputed here. The projection takes no query at all and answers with the
// WHOLE board, so both filters are client-side over live data; triage order is red first,
// most-overdue first.
//
// Both filters take more than one answer, because both questions usually have more than one:
// "which cars am I chasing?" is a shortlist, and "which alarms?" is «أحمر وأصفر, not the quiet
// ones». Within a filter the answers are OR'd; the two filters AND together.
//
// «حسن الui زى شاشة السيارات و السواقيين»: the drivers board's look — no page title, a bar with the
// count and the Excel pill, the dark filter bar with an icon on every filter, and the vehicles
// table. «الاحمر يكون الصف كله زى ما كان»: the red car's whole row stays red on that table, and
// the yellow one amber, at rest and under the pointer.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fleetVehicleCodeOrderKey,
  type FleetMaintenanceAlarmDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect, type MultiSelectOption } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { saveSheet } from '../lib/fleet-sheet';
import { formatDate, formatNumber } from '../../../shared/lib/format';
import { useMaintenanceAlarms } from '../api/fleet-queries';
import { boardVehicleOptions } from '../lib/board-vehicle-options';
import {
  ALARM_ROW_HOLD,
  AlarmBadge,
  RemainingKm,
  alarmRowAttrs,
  alarmRowTint,
  alarmText,
} from '../components/AlarmBadge';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { BoardIcon, PATH } from '../components/FuelCardBoard';
import { DARK_TABLE } from './VehiclesListPage';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { clickSort, readSorts, writeSorts } from '../lib/table-sort';
import { sortRows } from '../lib/sort-rows';

/** Remembered across visits: this screen's filters. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'level',
  'vehicleCodes',
  'sort',
] as const;

const LEVEL_ORDER = { red: 0, yellow: 1, none: 2 } as const;

/**
 * What one column of one alarm is worth, for the order the reader clicked.
 *
 * «المستوى» is ranked by TRIAGE, not by its name: red is more urgent than yellow, whatever the
 * two words do in an alphabet. The two distances are numbers, and a car the projection refused to
 * compute for answers `null` — which sorts last either way round, because «no figure» is not
 * «zero kilometres left».
 */
const alarmSortValue = (alarm: FleetMaintenanceAlarmDto, key: string): string | number | null => {
  // The fleet's own order, not the text of the code — see `fleetVehicleCodeOrderKey`.
  if (key === 'code') return fleetVehicleCodeOrderKey(alarm.code);
  if (key === 'level') return LEVEL_ORDER[alarm.level];
  if (key === 'sinceServiceKm') return alarm.sinceServiceKm;
  if (key === 'remainingKm') return alarm.remainingKm;
  if (key === 'lastServiceAt') {
    return alarm.lastServiceAt === null ? null : new Date(alarm.lastServiceAt).getTime();
  }
  return null;
};

/** A csv URL parameter as the list it stands for; an absent one is an empty list, never `['']`. */
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');

/**
 * The order this screen opens in, before the reader has asked for one.
 *
 * Named, because it is used twice and the two must agree: the table is DRAWN in it, and a
 * first click REPLACES it rather than joining it — see `clickSort`.
 */
const DEFAULT_SORT = 'level:asc';

/** Every filter is `density="tight"`, as on the vehicles board. */
const TIGHT = 'tight' as const;

/** The board's toolbar buttons, from the drivers screen. */
const PILL =
  'inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80';
const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';

/** Two arrows round a circle — «تحديث». */
const REFRESH_PATH = [
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
] as const;

export const MaintenanceAlarmsPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // `level` keeps its name and now reads as a LIST, so a bookmarked `?level=red` still means
  // exactly what it used to.
  const levels = csv(sp.get('level'));
  const vehicleCodes = csv(sp.get('vehicleCodes'));
  /**
   * The columns the board is read in, in the order they were clicked.
   *
   * SORTED IN THE BROWSER, and that is the honest place for it: this board derives one row per
   * vehicle and holds every one of them — there is no second page for an arrow to be wrong about.
   * The default is the triage order the screen has always opened in, written in the same format
   * the address bar carries: level first, and `sortRows` is handed the remaining distance as the
   * tiebreak, which is exactly the comparator this board used before it had arrows.
   */
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);

  const patch = (updates: Record<string, string | null>): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    setSp(next);
  };

  const alarmsQuery = useMaintenanceAlarms();
  /** True while the file is being written — the pill shows a spinner and takes no second press. */
  const [exporting, setExporting] = useState(false);
  const rows = useMemo(() => {
    const all = alarmsQuery.data ?? [];
    // An empty filter is not a filter: it asks nothing and keeps every row. A non-empty one keeps
    // the rows matching ANY of its answers, and the two run in sequence, which is the AND.
    const shown = all
      .filter((alarm) => levels.length === 0 || levels.includes(alarm.level))
      .filter((alarm) => vehicleCodes.length === 0 || vehicleCodes.includes(alarm.code));
    // The remaining distance closes every tie, which is what keeps the default order identical to
    // the triage order this board opened in before it had arrows: reddest first, then nearest due.
    return sortRows(
      shown,
      sorts,
      alarmSortValue,
      (a, b) =>
        (a.remainingKm ?? Number.POSITIVE_INFINITY) - (b.remainingKm ?? Number.POSITIVE_INFINITY),
    );
  }, [alarmsQuery.data, levels.join(','), vehicleCodes.join(','), sortParam]);

  // Ascending, then descending, then out of the order altogether — and a column the table
  // is NOT sorted by joins the end of it rather than replacing what is there.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) });
  };

  // The cars the board is reporting on, as the picker's options — from the BOARD, never from a
  // second call to the registry: this screen already holds every active vehicle. The rule for
  // keeping a selected-but-unreported code lives beside its own test, because a closed dropdown
  // renders no options and an inline version could not be asserted.
  const vehicleOptions = useMemo(
    () => boardVehicleOptions(alarmsQuery.data ?? [], vehicleCodes),
    [alarmsQuery.data, vehicleCodes.join(',')],
  );

  // The alarm vocabulary, in TRIAGE order — the same three the board reports and the same order
  // the table sorts by. Nothing is added here: FR-3 derives these and only these.
  const levelOptions: MultiSelectOption[] = [
    { value: 'red', label: t('fleet.dashboard.level.red') },
    { value: 'yellow', label: t('fleet.dashboard.level.yellow') },
    { value: 'none', label: t('fleet.vehicle.alarmNone') },
  ];

  /**
   * «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات».
   *
   * THE ROWS IN HAND ARE THE WHOLE ANSWER HERE, which is why this export does not fetch.
   * FR-3 takes no query and returns one row per vehicle for the entire fleet — there is no
   * `meta`, no page and no second request to walk. Both filters and the sort run in the browser
   * over every row the projection sent, so `rows` already IS «اللى الفلتر عامله»: the file and
   * the board hold the same set, in the same triage order the reader is looking at.
   *
   * THE LEVEL CELL IS SPLIT. On screen one badge says two different things depending on the car:
   * the alarm's level, or — when the projection could not compute one — the guard that stopped
   * it. Folding both into a single spreadsheet column would mix two vocabularies under one
   * heading and make «المستوى» unfilterable. So the level always carries its own word and the
   * reason gets a column of its own, empty on every car whose alarm actually ran.
   *
   * THE THREE FIGURES GO IN AS NUMBERS, not as the sentences the table draws. `formatNumber`
   * renders Arabic-Indic digits under `ar` and `RemainingKm` wraps a negative distance in
   * «متأخر … كم»; either would land in the sheet as text that Excel cannot sort or sum, which is
   * the one thing a reader opens this file to do. The unit is already in the heading, and the
   * sign keeps its meaning — a negative «المتبقي» is exactly the overdue distance.
   */
  const exportSheet = async (): Promise<void> => {
    saveSheet(
      {
        name: t('fleet.nav.maintenanceAlarms'),
        serialHeader: t('fleet.violations.report.serial'),
        header: [
          t('fleet.odometer.columns.vehicle'),
          t('fleet.alarms.columns.level'),
          t('fleet.vehicle.statusReason'),
          t('fleet.alarms.columns.sinceService'),
          t('fleet.alarms.columns.daysWithoutReading'),
          t('fleet.alarms.columns.remaining'),
          t('fleet.vehicle.lastService'),
        ],
        rows: rows.map((alarm) => [
          alarm.code,
          // The screen's OWN vocabulary, read from the very list the filter dropdown is built
          // from — one table of the three words, not a second copy that could drift from it.
          levelOptions.find((option) => option.value === alarm.level)?.label ?? '',
          // AND THE REASON IN THE BADGE'S OWN WORDS. No page writes this text: the server names
          // the guard that stopped the calculation and `AlarmBadge` is the one place that turns
          // it into a sentence, so the sheet and the cell beside it cannot say different things.
          alarm.noAlarmReason === null ? '' : alarmText(t, 'none', alarm.noAlarmReason),
          alarm.sinceServiceKm ?? '',
          alarm.daysWithoutReading,
          alarm.remainingKm ?? '',
          alarm.lastServiceAt === null ? '' : formatDate(alarm.lastServiceAt, locale),
        ]),
      },
    );
  };
  // What the reader is told while the file is written, and when it fails — NAMED, not swallowed:
  // a button that silently does nothing is read as broken, and the next move is to press it again.
  const runExport = async (): Promise<void> => {
    if (exporting) return;
    setExporting(true);
    try {
      await exportSheet();
    } catch (error) {
      toast.error(errorMessage(error, locale));
    } finally {
      setExporting(false);
    }
  };

  const columns: Column<FleetMaintenanceAlarmDto>[] = [
    {
      key: 'code',
      sortable: true,
      header: t('fleet.odometer.columns.vehicle'),
      render: (alarm) => (
        <span className="font-mono text-xs" dir="ltr">
          {alarm.code}
        </span>
      ),
    },
    {
      key: 'level',
      sortable: true,
      header: t('fleet.alarms.columns.level'),
      render: (alarm) => (
        <AlarmBadge level={alarm.level} noAlarmReason={alarm.noAlarmReason} />
      ),
    },
    {
      key: 'sinceServiceKm',
      sortable: true,
      header: t('fleet.alarms.columns.sinceService'),
      align: 'end',
      render: (alarm) =>
        alarm.sinceServiceKm === null ? '—' : formatNumber(alarm.sinceServiceKm, locale),
    },
    {
      key: 'daysWithoutReading',
      sortable: true,
      header: t('fleet.alarms.columns.daysWithoutReading'),
      align: 'end',
      /*
       * «يدله انذار ان العربيه دى المفروض تدخل الرقم عشان احسب الصيانه».
       *
       * A day recorded with no counter is on no chain, so it moves NONE of the figures beside it
       * — and that is precisely why this column has to exist. `sinceServiceKm` is the distance
       * somebody measured; this is how many days of the cycle nobody did, which makes the real
       * distance at least what the row says and possibly more.
       *
       * Zero is the ordinary case and prints as a dash rather than a 0, so the eye lands only on
       * the cars that actually need a reading typed in.
       */
      render: (alarm) =>
        alarm.daysWithoutReading === 0 ? (
          <span className="text-slate-400 dark:text-slate-600">—</span>
        ) : (
          <span
            className="tabular-nums font-medium text-amber-700 dark:text-amber-300"
            title={t('fleet.alarms.daysWithoutReadingHint')}
          >
            {formatNumber(alarm.daysWithoutReading, locale)}
          </span>
        ),
    },
    {
      key: 'remainingKm',
      sortable: true,
      header: t('fleet.alarms.columns.remaining'),
      align: 'end',
      // Drawn by the shared cell, exactly as the maintenance screen draws it — the two print the
      // same figure for the same car, so they read the sign the same way too.
      render: (alarm) => (
        <RemainingKm remainingKm={alarm.remainingKm} locale={locale} formatNumber={formatNumber} />
      ),
    },
    {
      key: 'lastServiceAt',
      sortable: true,
      header: t('fleet.vehicle.lastService'),
      // A DATE column, so an absent date reads as one — the same dash the two figures beside it
      // use. It used to print a sentence, and that sentence was byte-identical to the reason the
      // LEVEL column prints for the very same car: «لا صيانة محسوبة بعد» appeared twice on one
      // row, in adjacent columns, which reads as two findings about a car that has one.
      //
      // The reason belongs to the level column and stays there (PR #383/#384); this column
      // answers only "when", and the honest answer to "when" is nothing.
      render: (alarm) =>
        alarm.lastServiceAt === null ? (
          <span className="text-slate-400 dark:text-slate-600">—</span>
        ) : (
          <span className="tabular-nums">{formatDate(alarm.lastServiceAt, locale)}</span>
        ),
    },
  ];

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        <div
          className="flex shrink-0 items-center justify-between gap-2"
          data-alarms-toolbar="true"
        >
          {/* This board holds the WHOLE set — it has no paging at all and both its filters run in
              the browser over every row — so the rows in hand ARE the answer. One row is one car,
              so the count is said in cars. Nothing is drawn while the answer is in flight: a 0
              there would be a claim. */}
          <span
            role="status"
            title={t('fleet.filters.matchedRows')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {alarmsQuery.isPending
              ? ''
              : t('fleet.vehicles.count', { count: formatNumber(rows.length, locale) })}
          </span>
          <span className="flex shrink-0 items-center gap-1 sm:gap-2">
            {/* NOT OFFERED WHEN THE LIST FAILED. A green button on a screen that has just
                told the reader it has no data reads as a way out of the failure, and the
                file behind it would be empty or short. Disabling is not enough — it still
                draws. */}
            {!alarmsQuery.isError && (
              <div className={PILL}>
                <button
                  type="button"
                  data-export="maintenance-alarms"
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
            <div className={PILL}>
              <button
                type="button"
                data-alarms-refresh="true"
                disabled={alarmsQuery.isFetching}
                aria-busy={alarmsQuery.isFetching}
                onClick={() => void alarmsQuery.refetch()}
                className={cn(
                  PILL_BUTTON,
                  'hover:bg-white hover:text-slate-900 dark:hover:bg-slate-700/60 dark:hover:text-white',
                )}
              >
                {alarmsQuery.isFetching ? (
                  <Spinner className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                ) : (
                  <BoardIcon
                    d={REFRESH_PATH}
                    className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400"
                  />
                )}
                {t('fleet.alarms.refresh')}
              </button>
            </div>
          </span>
        </div>

        {/* The vehicles board's dark bar: an icon at every filter's start, one row on a computer. */}
        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={levels.length > 0 || vehicleCodes.length > 0}
            onClear={() => patch({ level: null, vehicleCodes: null })}
          >
            {/* The same control as every other screen — but fed from the BOARD it already holds
                rather than a registry search, because this page is the whole fleet's alarms, not a
                page of them. That is also why its filtering stays client-side: there is no
                paginated list here to narrow server-side. */}
            <FilterWithIcon icon={FILTER_ICON.car} tone="text-emerald-600 dark:text-emerald-400">
              <VehicleCodeFilter
                fullWidth
                density={TIGHT}
                className="w-full"
                options={vehicleOptions}
                value={vehicleCodes}
                onChange={(next) =>
                  patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
                }
              />
            </FilterWithIcon>
            <FilterWithIcon icon={PATH.warn} tone="text-amber-700 dark:text-amber-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                className="w-full"
                label={t('fleet.alarms.allAlarms')}
                options={levelOptions}
                value={levels}
                onChange={(next) => patch({ level: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {/* The vehicles table — «زى السيارات» — as the drivers board draws it. */}
        <div
          className={cn(
            DARK_TABLE,
            BOARD_TABLE_FILL,
            // No line between the columns on this table, as on the drivers board.
            '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
            // Every value heavy, the Arabic in Cairo's own bold.
            "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
            // The board table paints every row's hover grey from here; the alarm rows keep their
            // red and amber through it — see `ALARM_ROW_HOLD`.
            ALARM_ROW_HOLD,
          )}
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(alarm) => alarm.vehicleId}
            // One row IS one vehicle here, so the level belongs to the whole row — this is the one
            // screen where that is true, and the triage sort already puts the red ones on top.
            rowClassName={(alarm) => alarmRowTint(alarm.level)}
            rowProps={(alarm) => alarmRowAttrs(alarm.level)}
            loading={alarmsQuery.isPending}
            error={alarmsQuery.isError ? alarmsQuery.error : undefined}
            onRetry={() => void alarmsQuery.refetch()}
            sort={sorts}
            onSortChange={changeSort}
            minColumnWidth={4}
            stickyHead
          />
        </div>
      </div>
    </PageContainer>
  );
};
