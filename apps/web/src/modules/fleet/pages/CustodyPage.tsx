// العهدة — «شاشه العهده اللى فيها التجميعه بتاعت مصروفات العهده»: everything the custody fund paid,
// summed per source and per car, with every movement under it. A VIEW over the two screens that
// write the fund's side — the receipts and the dealership — never a copy.
//
// «تعالى بقى نشتغل على العهده»: what the other Fleet boards were given, given here too — no page
// title, a toolbar with the count, «الإحصائيات» and the Excel / PDF pill; the dark filter bar with
// an icon on every filter; the figures behind «الإحصائيات», between the filters and the tables;
// both tables in the receipts board's look (no column lines, Cairo bold) and the alarms board's
// type, every value centred; the driver's whole name; and arrows — the movements ordered by the
// server over the whole filtered set, the per-car summary (which holds every car) in the browser.
//
// «عاوز اغير لون النوع بين كاوتش وبنزين وغسيل»: each kind wears its own colour, defined once in
// `CustodyKinds.tsx`; «عاوز الاحصائيات الكوتش لوحده والغسيل لوحده»: five figures, tyres and washing
// apart; and «لوحة تحكم» beside «الإحصائيات» opens everything in detail over the same filters.
//
// «عاوز دى تكون فى شاشه العهد … فى اللايت سيم والدارك سيم»: the owner's dashboard design sets the
// colours of this WHOLE screen — the kinds blue, amber, rose and cyan, and what is pressed (the two
// buttons, the current page) emerald rather than the site's purple. The other Fleet boards keep it.
//
// «عاوز اضيف علامه السجل لكل عربيه لما ادوس عليها يجيب كل اللى العربيه صرفته ك سجل للعربيه»: every
// car of «ملخص لكل سيارة» carries «السجل» here too, as in the dashboard — its log over the board,
// under the board's own filters. «الإجمالي الختامي» is the whole fund's, and has none.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_CUSTODY_SOURCES,
  fleetVehicleCodeOrderKey,
  type FleetCustodyMovementDto,
  type FleetCustodyVehicleRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { FleetPager } from '../components/FleetPager';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate, formatMoneyParts, formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import * as fleetApi from '../api/fleet-api';
import { useCustodyMovements, useCustodySummary } from '../api/fleet-queries';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { CustodyFigures } from '../components/CustodyFigures';
import { CustodyKindBadge } from '../components/CustodyKinds';
import { CustodyDashboard } from '../components/CustodyDashboard';
import {
  CustodyCarLog,
  custodyCurrentCar,
  type CustodyOpenCarLog,
} from '../components/CustodyCarLog';
import { custodyCarKey, CustodyCarLogButton } from '../components/CustodyDashboardTables';
import { BoardIcon, NUM, PATH, ymd } from '../components/FuelCardBoard';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DriverCell } from '../components/DriverPerson';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { sortRows, type SortValue } from '../lib/sort-rows';
import { DARK_TABLE } from './VehiclesListPage';
import { ALARMS_CODE_TYPE, ALARMS_TYPE } from './MaintenanceAlarmsPage';

/** Remembered across visits: the filters, the page size and both tables' orders. Never `page`. */
const REMEMBERED_FILTERS = [
  'from',
  'to',
  'vehicleCodes',
  'source',
  'driver',
  'size',
  'sort',
  'carSort',
] as const;
const DEFAULT_PAGE_SIZE = 25;
/** «كل الحركات» opens newest first, as it always did. */
const DEFAULT_SORT = 'date:desc';
/** «ملخص لكل سيارة» opens in the server's order — by the car's code. */
const DEFAULT_CAR_SORT = 'vehicleCode:asc';
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');
const GRAND_TOTAL = '__total__';

/** Every filter is `density="tight"`, as on the vehicles board. */
const TIGHT = 'tight' as const;

/** The boards' figure: monospace, tabular, never broken over two lines. */
const FIGURE = cn('whitespace-nowrap', NUM);
/** An empty cell, as the boards draw one. */
const DASH = <span className="text-slate-400">—</span>;

/**
 * The board's toolbar buttons, from the vehicles screen — a size down on a phone — in the emerald
 * of the owner's custody design rather than the site's purple.
 */
const PRESS_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-2 py-1.5 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-emerald-300';
const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';

/**
 * Both tables: the receipts board's (the vehicles table with no line between the columns, every
 * value heavy in Cairo's own bold) in the alarms board's TYPE — see `ALARMS_TYPE`. The row-filling
 * part (`BOARD_TABLE_FILL`) goes on the movements only: the per-car table keeps its own bound.
 */
const CUSTODY_TABLE = cn(
  DARK_TABLE,
  '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
  "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
  ALARMS_TYPE,
);

type CarMoneyKey = keyof Pick<
  FleetCustodyVehicleRowDto,
  'dealership' | 'fuel' | 'tyres' | 'wash' | 'total'
>;

/** What a per-car column is worth to its arrow: the code in the fleet's order, a sum as a number. */
const carSortValue = (row: FleetCustodyVehicleRowDto, key: string): SortValue => {
  if (key === 'vehicleCode') return fleetVehicleCodeOrderKey(row.vehicleCode);
  const value = (row as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
};

export const CustodyPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const signatories = useReportSignatories();

  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const codesParam = sp.get('vehicleCodes') ?? '';
  const sourcesParam = sp.get('source') ?? '';
  const vehicleCodes = csv(codesParam);
  const sources = csv(sourcesParam);
  const driver = sp.get('driver') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);
  const carSortParam = sp.get('carSort');
  const carSorts = useMemo(() => readSorts(carSortParam, DEFAULT_CAR_SORT), [carSortParam]);

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  // An arrow reorders the same rows: the reader stays on the page they are reading.
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };
  const changeCarSort = (by: string): void => {
    patch({ carSort: writeSorts(clickSort(carSortParam, DEFAULT_CAR_SORT, by)) }, false);
  };
  const hasActiveFilters =
    from !== '' || to !== '' || vehicleCodes.length > 0 || sources.length > 0 || driver !== '';

  // The filters alone — the figures', the per-car summary's and the files' question. Keyed on the
  // values, so an arrow click does not rebuild it.
  const filters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      source: sources.length > 0 ? sources : undefined,
      driver: driver || undefined,
    }),
    [from, to, codesParam, sourcesParam, driver],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, ...sortQuery(sorts) }),
    [filters, page, pageSize, sorts],
  );
  const summary = useCustodySummary(filters);
  const { data, isLoading, isError, error, refetch } = useCustodyMovements(params);
  const rows = data?.items ?? [];

  // One file at a time; the pressed one spins while the rows are gathered.
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  // The figures open from the toolbar, closed on the way in.
  const [statsOpen, setStatsOpen] = useState(false);
  // «لوحة تحكم» — over the whole screen, read only while open.
  const [dashOpen, setDashOpen] = useState(false);
  // A car's «السجل» from «ملخص لكل سيارة», and the button that opened it.
  const [carLog, setCarLog] = useState<CustodyOpenCarLog | null>(null);
  // «تصفية متقدمة» in the dashboard closes it and sends the focus to the filter bar — after the
  // dashboard, on its way out, has handed it back to «لوحة تحكم» (its effect is torn down first).
  const filterBar = useRef<HTMLDivElement>(null);
  const focusFilters = useRef(false);
  useEffect(() => {
    if (dashOpen || !focusFilters.current) return;
    focusFilters.current = false;
    filterBar.current?.scrollIntoView({ block: 'nearest' });
    filterBar.current
      ?.querySelector<HTMLElement>('input, button, select, [tabindex]:not([tabindex="-1"])')
      ?.focus();
  }, [dashOpen]);
  const clearFilters = (): void =>
    patch({ from: null, to: null, vehicleCodes: null, source: null, driver: null });

  const sourceLabel = (row: FleetCustodyMovementDto): string =>
    t(`fleet.custody.source.${row.source}`);
  const detailOf = (row: FleetCustodyMovementDto): string =>
    row.fuelType !== null ? t(`fleet.receipts.fuelType.${row.fuelType}`) : (row.detail ?? '');
  /** «1,037.10» and «ج.م.» apart — the figure in the boards' monospace, the currency beside it. */
  const moneyCell = (value: number): JSX.Element => {
    const { figure, currency } = formatMoneyParts(value, 'EGP', locale);
    return (
      <span className="inline-flex items-baseline gap-1">
        <span className={FIGURE}>{figure}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{currency}</span>
      </span>
    );
  };
  /** The car's code as the alarms board writes it — bold, a size over the row; none, a dash. */
  const codeCell = (code: string | null): JSX.Element =>
    code === null ? (
      DASH
    ) : (
      <span dir="ltr" className={cn('font-bold', FIGURE, ALARMS_CODE_TYPE)}>
        {code}
      </span>
    );

  // «ملخص لكل سيارة» — the server's lines in the reader's order, the grand total ALWAYS last. With
  // no movement at all there is no line, and the table says so rather than adding up nothing.
  const perVehicle: FleetCustodyVehicleRowDto[] = useMemo(() => {
    if (summary.data === undefined || summary.data.vehicles.length === 0) return [];
    return [
      ...sortRows(summary.data.vehicles, carSorts, carSortValue),
      {
        vehicleId: GRAND_TOTAL,
        vehicleCode: t('fleet.custody.grandTotal'),
        dealership: summary.data.dealership,
        fuel: summary.data.fuel,
        tyres: summary.data.tyres,
        wash: summary.data.wash,
        total: summary.data.total,
      },
    ];
  }, [summary.data, carSorts, t]);
  const moneyCol = (key: CarMoneyKey, header: string): Column<FleetCustodyVehicleRowDto> => ({
    key,
    header,
    align: 'center',
    sortable: true,
    render: (row) => {
      // Nothing paid that way on a car is the grey dash; the grand total always says its figure.
      if (row[key] === 0 && row.vehicleId !== GRAND_TOTAL) return DASH;
      // The table is bold throughout; the car's total stands out by its colour alone.
      return key === 'total' ? (
        <span className="text-slate-900 dark:text-white">{moneyCell(row[key])}</span>
      ) : (
        moneyCell(row[key])
      );
    },
  });
  const vehicleColumns: Column<FleetCustodyVehicleRowDto>[] = [
    {
      key: 'vehicleCode',
      align: 'center',
      header: t('fleet.odometer.columns.vehicle'),
      sortable: true,
      // «الإجمالي» on the last row is a word, not a code — and the whole fund's, so it has no log.
      // A car's code with its «السجل» beside it.
      render: (row) =>
        row.vehicleId === GRAND_TOTAL ? (
          <span>{row.vehicleCode}</span>
        ) : (
          <span className="inline-flex items-center justify-center gap-2">
            {codeCell(row.vehicleCode)}
            <CustodyCarLogButton
              car={row}
              onOpen={(car, opener) => setCarLog({ key: custodyCarKey(car), car, opener })}
            />
          </span>
        ),
    },
    moneyCol('dealership', t('fleet.custody.source.dealership')),
    moneyCol('fuel', t('fleet.custody.source.fuel')),
    moneyCol('tyres', t('fleet.custody.source.tyres')),
    moneyCol('wash', t('fleet.custody.source.wash')),
    moneyCol('total', t('fleet.custody.columns.total')),
  ];

  // «كل الحركات»: every value and header centred, the date year first in Latin digits, the code
  // bold, money with «ج.م.» beside it, an empty cell a grey dash. Each column's key IS the
  // server's sort key (`CUSTODY_SORTABLE`).
  const columns: Column<FleetCustodyMovementDto>[] = [
    {
      key: 'date',
      align: 'center',
      header: t('fleet.receipts.columns.date'),
      sortable: true,
      render: (row) => (
        <span dir="ltr" className={FIGURE}>
          {ymd(row.date)}
        </span>
      ),
    },
    {
      key: 'vehicleCode',
      align: 'center',
      header: t('fleet.odometer.columns.vehicle'),
      sortable: true,
      render: (row) => codeCell(row.vehicleCode),
    },
    {
      key: 'source',
      align: 'center',
      header: t('fleet.receipts.columns.kind'),
      // In the filter's order — dealership, fuel, tyres, wash — not the word's alphabet.
      sortable: true,
      // The alarms board's pill size, so the kind reads at the row's 16px; the detail in a span
      // of its own, so the table's bold reaches it.
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <CustodyKindBadge kind={row.source} />
          {detailOf(row) !== '' && <span>{detailOf(row)}</span>}
        </span>
      ),
    },
    {
      key: 'driverName',
      align: 'center',
      header: t('fleet.receipts.columns.driver'),
      // A bill names no driver, so it sorts last whichever way the arrow points.
      sortable: true,
      // «عاوز الاسم بتاع السواق كامل وشيل الكود»: the WHOLE name, the code on hover — as on the
      // maintenance and odometer boards. A name from the old books stays grey.
      render: (row) => (
        <DriverCell employeeId={row.driverEmployeeId} name={row.driverName} look="name" />
      ),
    },
    {
      key: 'ref',
      align: 'center',
      header: t('fleet.custody.columns.from'),
      sortable: true,
      render: (row) => <span>{t(`fleet.custody.from.${row.ref}`)}</span>,
    },
    {
      key: 'amount',
      align: 'center',
      header: t('fleet.receipts.columns.amount'),
      sortable: true,
      render: (row) => moneyCell(row.amount),
    },
  ];

  const header = [
    t('fleet.receipts.columns.date'),
    t('fleet.odometer.columns.vehicle'),
    t('fleet.receipts.columns.kind'),
    t('fleet.receipts.columns.driver'),
    t('fleet.custody.columns.from'),
    t('fleet.receipts.columns.amount'),
  ];
  // Every movement the filters match, in the table's order — `params` carries the arrows.
  const allRows = () =>
    fetchFilteredRows((pageNo, size) =>
      fleetApi.listCustodyMovements({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );
  const line = (row: FleetCustodyMovementDto, empty: string): (string | number)[] => [
    formatDate(row.date, locale),
    row.vehicleCode ?? empty,
    `${sourceLabel(row)} ${detailOf(row)}`.trim(),
    row.driverName ?? empty,
    t(`fleet.custody.from.${row.ref}`),
    row.amount,
  ];
  const writeSheet = async (): Promise<void> => {
    const all = await allRows();
    saveSheet({
      name: t('fleet.nav.custody'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: all.map((row) => line(row, '')),
      moneyColumns: [5],
    });
  };
  const exportSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('excel');
    try {
      await writeSheet();
    } catch (failure) {
      // NAMED, not swallowed — as the Excel button always said it.
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(null);
    }
  };
  const printSheet = async (): Promise<void> => {
    const all = await allRows();
    try {
      printFleetReport({
        title: t('fleet.nav.custody'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header,
        rows: all.map((row) =>
          line(row, '—').map((cell, i) => (i === 5 ? reportMoney(Number(cell)) : String(cell))),
        ),
        totals:
          summary.data === undefined
            ? []
            : [
                { label: t('fleet.custody.totals.total'), value: reportMoney(summary.data.total) },
                {
                  label: t('fleet.custody.totals.dealership'),
                  value: reportMoney(summary.data.dealership),
                },
                { label: t('fleet.custody.totals.fuel'), value: reportMoney(summary.data.fuel) },
                { label: t('fleet.custody.totals.tyres'), value: reportMoney(summary.data.tyres) },
                { label: t('fleet.custody.totals.wash'), value: reportMoney(summary.data.wash) },
              ],
        signatories,
        serialHeader: t('fleet.violations.report.serial'),
        emptyLabel: t('fleet.violations.report.empty'),
      });
    } catch {
      toast.error(t('fleet.violations.popupBlocked'));
    }
  };
  const onPrint = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('pdf');
    try {
      await printSheet();
    } catch (failure) {
      // The rows could not be gathered: say why, as the Excel button does.
      toast.error(errorMessage(failure, locale));
    } finally {
      setExporting(null);
    }
  };

  // «من» / «إلى» as the receipts board draws them: the coloured calendar opens the picker, and the
  // word sits in the box while it is empty, gone the moment the box is focused.
  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => (
    <FilterWithIcon
      icon={FILTER_ICON.calendar}
      tone="text-cyan-600 dark:text-cyan-400"
      className="w-36 shrink-0"
      datePicker={{ label: t(labelKey) }}
    >
      <Input
        type="date"
        dir="ltr"
        density={TIGHT}
        aria-label={t(labelKey)}
        title={t(labelKey)}
        value={value}
        onChange={(e) => patch({ [param]: e.target.value || null })}
        className={cn(
          'dark:[color-scheme:dark]',
          value === '' && 'peer [&:not(:focus)::-webkit-datetime-edit]:opacity-0',
        )}
      />
      {value === '' && (
        <span
          aria-hidden="true"
          data-date-caption={param}
          className="pointer-events-none absolute inset-y-0 left-2 right-10 flex items-center justify-center truncate text-sm text-slate-500 peer-focus:hidden dark:text-slate-400"
        >
          {t(labelKey)}
        </span>
      )}
    </FilterWithIcon>
  );

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        {/* «زى شاشة السيارات و السواقيين»: no page title — the board opens on its toolbar. */}
        <div className="flex items-center justify-between gap-2" data-custody-toolbar="true">
          {/* How many movements the filters matched, over the whole set — nothing while the
              answer is on its way. */}
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {data === undefined
              ? ''
              : t('common.list.count', { count: formatNumber(data.meta.totalItems, locale) })}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            <button
              type="button"
              data-custody-stats-toggle="true"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((open) => !open)}
              className={PRESS_BUTTON}
            >
              {statsOpen
                ? t('fleet.vehicles.board.breakdownHide')
                : t('fleet.vehicles.board.breakdown')}
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className={cn(
                  'h-3 w-3 transition-transform sm:h-3.5 sm:w-3.5',
                  statsOpen && 'rotate-180',
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* «جمب الاحصائيات داش بورد تفتح ف الشاشه كلها» — right beside it, the same look. */}
            <button
              type="button"
              data-custody-dashboard-open="true"
              aria-haspopup="dialog"
              aria-expanded={dashOpen}
              onClick={() => setDashOpen(true)}
              className={PRESS_BUTTON}
            >
              <BoardIcon d={PATH.trend} className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              {t('fleet.custody.dashboard.open')}
            </button>
            {/* Not offered when the list failed: the file behind it would be empty or short. */}
            {!isError && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80">
                <button
                  type="button"
                  data-export="custody"
                  title={t('fleet.export.excel')}
                  disabled={exporting !== null}
                  onClick={() => void exportSheet()}
                  className={cn(
                    PILL_BUTTON,
                    'hover:bg-emerald-50 hover:text-emerald-700 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300',
                  )}
                >
                  {exporting === 'excel' ? (
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
                <span className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                <button
                  type="button"
                  data-print="custody"
                  title={t('common.print')}
                  disabled={exporting !== null}
                  onClick={() => void onPrint()}
                  className={cn(
                    PILL_BUTTON,
                    'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400',
                  )}
                >
                  {exporting === 'pdf' ? (
                    <Spinner className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />
                  ) : (
                    <BoardIcon
                      d={PATH.pdf}
                      className="h-3.5 w-3.5 text-red-600 dark:text-red-400"
                    />
                  )}
                  <span className="sm:hidden">PDF</span>
                  <span className="hidden sm:inline">{t('fleet.fuelCards.board.pdf')}</span>
                </button>
              </div>
            )}
          </span>
        </div>

        {/* The vehicles board's dark bar: every filter's name written in its box, an icon at its
            start, one row on a computer. */}
        <div
          ref={filterBar}
          data-custody-filter-bar="true"
          className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}
        >
          <FilterBar hasActiveFilters={hasActiveFilters} onClear={clearFilters}>
            {dateBound('fleet.receipts.filters.from', from, 'from')}
            {dateBound('fleet.receipts.filters.to', to, 'to')}
            <FilterWithIcon icon={FILTER_ICON.car} tone="text-emerald-600 dark:text-emerald-400">
              <VehicleCodeFilter
                fullWidth
                density={TIGHT}
                value={vehicleCodes}
                onChange={(next) =>
                  patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
                }
              />
            </FilterWithIcon>
            {/* «اى حاله فيها اكتر من 3 اخيار اقدر اعمل مالتى سلكت» — four sources, so several at once. */}
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.custody.columns.source')}
                options={FLEET_CUSTODY_SOURCES.map((value) => ({
                  value,
                  label: t(`fleet.custody.source.${value}`),
                }))}
                value={sources}
                onChange={(next) => patch({ source: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
            {/* A width on the WRAPPER: `Input` carries its own `w-full`, and a width passed as a
                class only joins it (`cn` does not merge). */}
            <FilterWithIcon
              icon={FILTER_ICON.person}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-44 shrink-0"
            >
              <Input
                aria-label={t('fleet.receipts.columns.driver')}
                title={t('fleet.receipts.columns.driver')}
                placeholder={t('fleet.receipts.filters.driver')}
                density={TIGHT}
                value={driver}
                onChange={(e) => patch({ driver: e.target.value || null })}
                rule="arabic"
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {/* «الاجماليات تكون بين الجدول والفلاتر» — behind «الإحصائيات», as on the money boards. */}
        {statsOpen && summary.data !== undefined && <CustodyFigures totals={summary.data} />}
        {/* The board's own `filters`: the dashboard asks exactly what the figures ask, and what it
            changes it changes HERE — clearing them, «المصدر» = التوكيل, the focus on the bar. */}
        <CustodyDashboard
          open={dashOpen}
          onClose={() => setDashOpen(false)}
          filters={filters}
          onClearFilters={clearFilters}
          onShowDealership={() => {
            patch({ source: 'dealership' });
            setDashOpen(false);
          }}
          onAdvancedFilter={() => {
            focusFilters.current = true;
            setDashOpen(false);
          }}
        />
        {/* A car's «السجل»: its line as the summary holds it now, its share of the same fund total,
            the board's own filters. Keyed by the car: another car's log starts on its first page. */}
        {carLog !== null && (
          <CustodyCarLog
            key={carLog.key}
            car={custodyCurrentCar(summary.data?.vehicles, carLog)}
            fundTotal={summary.data?.total ?? 0}
            filters={filters}
            opener={carLog.opener}
            onClose={() => setCarLog(null)}
          />
        )}

        {/* Two tables share the height: the per-car totals take what they need up to three tenths,
            and the movements take the rest — each scrolls its own rows. */}
        <section
          data-custody-per-vehicle="true"
          className="flex shrink-0 flex-col gap-2 lg:max-h-[30%]"
        >
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('fleet.custody.perVehicle')}
          </h2>
          <div className={cn(CUSTODY_TABLE, 'lg:flex lg:min-h-0 lg:flex-col [&>div]:min-h-0')}>
            <DataTable
              columns={vehicleColumns}
              rows={perVehicle}
              rowKey={(row) => row.vehicleId ?? `code:${row.vehicleCode ?? ''}`}
              loading={summary.isLoading}
              error={summary.isError ? summary.error : undefined}
              onRetry={() => void summary.refetch()}
              empty={t('fleet.custody.empty')}
              // The grand total in the table head's tone, so it reads as the table's own line.
              rowClassName={(row) =>
                row.vehicleId === GRAND_TOTAL ? 'bg-slate-100 dark:bg-[#0c121e]' : undefined
              }
              rowProps={(row) =>
                (row.vehicleId === GRAND_TOTAL
                  ? { 'data-custody-grand-total': 'true' }
                  : undefined) as never
              }
              sort={carSorts}
              onSortChange={changeCarSort}
              minColumnWidth={4}
              stickyHead
            />
          </div>
        </section>

        <section
          data-custody-movements="true"
          className="flex flex-col gap-2 lg:min-h-[12rem] lg:flex-1"
        >
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('fleet.custody.movements')}
          </h2>
          <div className={cn(CUSTODY_TABLE, BOARD_TABLE_FILL)}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => `${row.ref}:${row.id}`}
              loading={isLoading}
              error={isError ? error : undefined}
              onRetry={() => void refetch()}
              empty={t('fleet.custody.empty')}
              sort={sorts}
              onSortChange={changeSort}
              minColumnWidth={4}
              stickyHead
            />
          </div>
          {data !== undefined && data.meta.totalItems > 0 && (
            <FleetPager
              tone="emerald"
              meta={data.meta}
              onPageChange={(p) => patch({ page: String(p) }, false)}
              onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
            />
          )}
        </section>
      </div>
    </PageContainer>
  );
};
