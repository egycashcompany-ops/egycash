// «مصروفات العهدة» (`/fleet/custody-expenses`, SCREEN 2) — «شاشه العهده اللى فيها التجميعه بتاعت
// مصروفات العهده»: everything the custody fund paid, summed per source and per car, with every
// movement under it. A VIEW over the receipts («خصم الإيصالات») — صيانة, وقود, كاوتش, غسيل — never a
// copy. «التوكيل لما بسجل فاتوره … ولا تنقص
// من العهدة وملهاش علاقة ب حاجة»: a dealership invoice is no custody movement, and «صيانة» stands
// where التوكيل stood.
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
// colours of this WHOLE screen — the kinds blue (صيانة, where التوكيل was), amber, rose and cyan.
// Not the toolbar: «لوحة التحكم والاحصائيات الاتنين يكون لونهم موف زى باقى الشاشات» —
// «الإحصائيات» and «لوحة تحكم» wear the site's purple, as on every other board (`PRESS_BUTTON`);
// nor the pager's current page, purple too («لا بنفسجى»).
//
// «عاوز اضيف علامه السجل لكل عربيه لما ادوس عليها يجيب كل اللى العربيه صرفته ك سجل للعربيه»: every
// car of «ملخص لكل سيارة» carries «السجل» — its log over the board, under the board's own filters.
// «الإجمالي» is the whole fund's, and has none. «عاوزك تشيل من الداش بورد الجدول اللى فى العربيات
// والسجل يكون برا زى ما هو»: this board is where both tables and «السجل» live — «لوحة تحكم» draws
// neither table now.
//
// «وخلى الالوان زى ما انت عامل فى الداش بورد»: both tables wear the dashboard's colours, in both
// themes. «ملخص لكل سيارة»: «—» muted where a car paid nothing that way, the car's code in its blue
// chip, the «الإجمالي» column set apart, and the «الإجمالي» line as the dashboard's foot — the
// emerald rule, the emerald word, the fund's total in its emerald box. «كل الحركات»: the date muted,
// the car's code in its slate chip, each kind's pale badge with its dot, a fuel receipt's company
// («وطنية» emerald, «شل أوت» amber), the amount slate-900 / white. Both heads in the dashboard's
// darker ink. The files (Excel / PDF) are as they were. A kind's sums and «من» are calmer since —
// below.
//
// «عاوزك تظبط الوان العهده ك شاشه مش داش بورد — الداش بورد زى ما هى حلوه»: the SCREEN in the
// dashboard's surfaces, the dashboard itself untouched — the filter bar on its card with its
// boxes, the figures as its KPI cards with the share's bar, each table on its table card under a
// strip with the title in Cairo and a count chip, the pager in the card's foot. «هادية»: the
// tables calmer — a car's sums in plain ink, the «الإجمالي» line's in the foot's slate-900 / white
// under its emerald rule, word and box; in «كل الحركات» only the kind's pill and the company's
// badge keep a colour, «من» in the row's plain ink.
//
// «انت مش كنت خليت الارقام بتاعت التوكيل و الوقود وكدا بيكون جمبهم نقط الوان غيرتها ليه»: the
// kind's colour stays beside its numbers — a small dot of it before every sum that is not zero (a
// car's and the foot's) and before each kind's heading (`KIND_HEAD_DOT`). A spec fails without them.
//
// «خلاص افصلهم»: the fund itself is SCREEN 1 «العهدة» now — its head, its three actions and their
// dialogs, «سجل العهدة», «المذكرات» and «لوحة تحكم العهدة». This board, a menu row of its own, keeps
// what the fund PAID: no tabs and no fund buttons; five figures behind «الإحصائيات» (the fund's own
// card heads SCREEN 1); «لوحة تحكم المصروفات», the spend's half of the dashboard; in «كل الحركات» a
// receipt that is a line of a custody memo carries that memo's chip under «من»; and the Excel / PDF
// files titled «مصروفات العهدة». The file and its export keep their names (`CustodyPage`).
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_CUSTODY_SOURCES,
  fleetVehicleCodeOrderKey,
  type FleetCustodyMovementDto,
  type FleetCustodySource,
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
import { CUSTODY_KIND, CustodyKindBadge } from '../components/CustodyKinds';
import { CustodyDashboard } from '../components/CustodyDashboard';
import { ReceiptMemoChip } from '../components/ReceiptMemoChip';
import {
  CustodyCarLog,
  custodyCarKey,
  CustodyCarLogButton,
  custodyCurrentCar,
  type CustodyOpenCarLog,
} from '../components/CustodyCarLog';
import { COMPANY, TITLE, useCount } from '../components/custody-dashboard-parts';
import {
  CARS_CHIP,
  CUSTODY_FILTER_LOOK,
  CUSTODY_TABLE,
  EMBEDDED_TABLE,
  GRAND_ROW,
  MOVES_CHIP,
  PILL_BUTTON,
  SECTION_CARD,
  SECTION_FOOT,
  SECTION_STRIP,
} from '../components/custody-board-looks';
import { BoardIcon, NUM, PATH, ymd } from '../components/FuelCardBoard';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DriverCell } from '../components/DriverPerson';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { sortRows, type SortValue } from '../lib/sort-rows';
import { ALARMS_CODE_TYPE } from './MaintenanceAlarmsPage';

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
/**
 * «المصدر» as the address holds it, kept to the kinds the server knows: a remembered or bookmarked
 * `source=dealership` (التوكيل, no custody movement any more) is dropped, not sent to be refused.
 */
const custodySources = (raw: string | null): FleetCustodySource[] =>
  csv(raw).filter((v): v is FleetCustodySource =>
    (FLEET_CUSTODY_SOURCES as readonly string[]).includes(v),
  );
const GRAND_TOTAL = '__total__';

/** Every filter is `density="tight"`, as on the vehicles board. */
const TIGHT = 'tight' as const;

/** The boards' figure: monospace, tabular, never broken over two lines. */
const FIGURE = cn('whitespace-nowrap', NUM);
/** An empty cell, as the boards draw one. */
const DASH = <span className="text-slate-400">—</span>;
/** «—» where a car paid nothing that way — the dashboard's muted dash, in both themes. */
const NONE = <span className="text-slate-400 dark:text-slate-500">—</span>;
// The filter bar's card, the tables' cards, strips, chips and foot, both tables' look, the
// «الإجمالي» line and the framed groups' buttons are the screen's, shared with «المذكرات» and
// «سجل العهدة»: `custody-board-looks.ts`.

/**
 * «هادية» — a car's sums in plain ink: slate-800 / slate-200 (the foot's slate-900 / white), «ج.م.»
 * muted. The kind is told by a small dot of its colour (`CUSTODY_KIND[kind].dot`) before every sum
 * that is not zero and before its heading — «انت مش كنت خليت الارقام بتاعت التوكيل و الوقود وكدا
 * بيكون جمبهم نقط الوان غيرتها ليه». The heading's dot rides on its arrow button (the board's
 * `Column` takes words only), in the same two shades as the cells' dot.
 */
const CALM_INK = 'text-slate-800 dark:text-slate-200';
const CALM_FOOT_INK = 'text-slate-900 dark:text-white';
const KIND_HEAD_DOT =
  "[&>button]:before:inline-block [&>button]:before:h-2 [&>button]:before:w-2 [&>button]:before:shrink-0 [&>button]:before:rounded-full [&>button]:before:content-['']";
const KIND_HEAD_DOT_INK: Record<FleetCustodySource, string> = {
  maintenance: '[&>button]:before:bg-blue-600 dark:[&>button]:before:bg-blue-400',
  fuel: '[&>button]:before:bg-amber-500 dark:[&>button]:before:bg-amber-400',
  tyres: '[&>button]:before:bg-rose-500 dark:[&>button]:before:bg-rose-400',
  wash: '[&>button]:before:bg-cyan-600 dark:[&>button]:before:bg-cyan-400',
};

/**
 * The board's toolbar buttons, from the vehicles screen — a size down on a phone — in the site's
 * purple: «لوحة التحكم والاحصائيات الاتنين يكون لونهم موف زى باقى الشاشات».
 */
const PRESS_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';

/**
 * «ملخص لكل سيارة» in the dashboard's colours. What the board's table forces on every cell with
 * `!important` is reached here one selector deeper:
 * - the head: the dashboard's slate-700 on the light map, the design's slate-300 dark (the board's
 *   are slate-500 / slate-400);
 * - «الإجمالي»'s heading (the last): slate-900 extra bold on the light map, emerald-300 on the dark
 *   design — its arrow in the heading's ink;
 * - «السجل» keeps its own size: the board's table squeezes a cell's buttons into 28px squares (its
 *   rows' icons), and the word would spill out of one.
 */
const PER_CAR_TABLE = cn(
  '[&_thead_tr_th]:!text-slate-700 dark:[&_thead_tr_th]:!text-slate-300',
  '[&_thead_th:last-child]:!font-extrabold [&_thead_th:last-child]:!text-slate-900 dark:[&_thead_th:last-child]:!font-bold dark:[&_thead_th:last-child]:!text-emerald-300 [&_thead_th:last-child_button]:!text-inherit',
  '[&_td_button[data-custody-car-log-open]]:!h-auto [&_td_button[data-custody-car-log-open]]:!w-auto',
);
/** The «الإجمالي» column set apart, as on the dashboard: slate light, the design's #131f35 dark. */
const TOTAL_HEAD = 'bg-slate-200/80 dark:bg-[#131f35]';
const TOTAL_CELL = 'bg-slate-50 dark:bg-[#131f35]/50';
/** A car's total — the dashboard's slate-900 / white. */
const TOTAL_INK = 'text-slate-900 dark:text-white';
/** The car's code in «ملخص لكل سيارة» — the dashboard's blue chip, at the board's code size. */
const CAR_CHIP =
  'inline-flex h-8 min-w-[2rem] items-center justify-center whitespace-nowrap rounded border border-blue-200 bg-blue-50 px-1.5 font-bold text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-400';
/** «الإجمالي» itself, and the fund's total — the foot's emerald. */
const GRAND_WORD = 'text-emerald-800 dark:text-emerald-400';
const GRAND_INK = 'text-emerald-800 dark:text-emerald-300';
/** A fuel receipt's company in «كل الحركات» — the dashboard log's badge, a size under the kind's. */
const COMPANY_BADGE =
  'inline-flex items-center whitespace-nowrap rounded-md border px-2.5 py-0.5 text-[13px] leading-5';
/** «من» — the receipts screen's, in the row's plain ink. */
const CALM_FROM = 'text-slate-600 dark:text-slate-300';
/**
 * «كل الحركات» in the dashboard log's inks, on a span of each cell's own (the board's table sets
 * its ink on the `<td>` with `!important`; a span's own colour still wins):
 * - the head slate-700 on the light map (the board's is slate-500), one selector deeper as on
 *   «ملخص لكل سيارة»; the design's dark head is the board's own slate-400, which still wins dark;
 * - the date muted; «من» in the row's plain ink (`CALM_FROM`);
 * - the car's code in a slate chip on the light map, white on the dark design;
 * - the amount, figure and «ج.م.», slate-900 / white.
 */
const MOVEMENTS_TABLE = '[&_thead_tr_th]:!text-slate-700';
const MUTED_INK = 'text-slate-500 dark:text-slate-400';
const LOG_CODE_CHIP =
  'rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-slate-900 dark:border-transparent dark:bg-transparent dark:px-0 dark:text-white';
const AMOUNT_INK = 'text-slate-900 dark:text-white';

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
  const { count } = useCount();

  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const codesParam = sp.get('vehicleCodes') ?? '';
  const sourcesParam = sp.get('source') ?? '';
  const vehicleCodes = csv(codesParam);
  const sources = custodySources(sourcesParam);
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
  // «لوحة تحكم المصروفات» — over the whole screen, read only while open.
  const [dashOpen, setDashOpen] = useState(false);
  // A car's «السجل» from «ملخص لكل سيارة», and the button that opened it.
  const [carLog, setCarLog] = useState<CustodyOpenCarLog | null>(null);
  const clearFilters = (): void =>
    patch({ from: null, to: null, vehicleCodes: null, source: null, driver: null });

  const sourceLabel = (row: FleetCustodyMovementDto): string =>
    t(`fleet.custody.source.${row.source}`);
  const detailOf = (row: FleetCustodyMovementDto): string =>
    row.fuelType !== null ? t(`fleet.receipts.fuelType.${row.fuelType}`) : (row.detail ?? '');
  /**
   * «1,037.10» and «ج.م.» apart — the figure in the boards' monospace, the currency beside it; with
   * an `ink`, both in it (a total's, a movement's amount) unless `currencyInk` gives «ج.م.» its own
   * (a kind's calm sums keep it muted).
   */
  const moneyCell = (value: number, ink?: string, currencyInk?: string): JSX.Element => {
    const { figure, currency } = formatMoneyParts(value, 'EGP', locale);
    return (
      <span className={cn('inline-flex items-baseline gap-1', ink)}>
        <span className={FIGURE}>{figure}</span>
        <span className={cn('text-sm', currencyInk ?? ink ?? MUTED_INK)}>{currency}</span>
      </span>
    );
  };
  /**
   * A movement's car code as the alarms board writes it — bold, a size over the row — in the
   * dashboard log's chip (`LOG_CODE_CHIP`); none, a dash.
   */
  const codeCell = (code: string | null): JSX.Element =>
    code === null ? (
      DASH
    ) : (
      <span
        dir="ltr"
        data-custody-movement-code="true"
        className={cn(LOG_CODE_CHIP, 'font-bold', FIGURE, ALARMS_CODE_TYPE)}
      >
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
        maintenance: summary.data.maintenance,
        fuel: summary.data.fuel,
        tyres: summary.data.tyres,
        wash: summary.data.wash,
        total: summary.data.total,
      },
    ];
  }, [summary.data, carSorts, t]);
  // Nothing paid that way on a car is the muted dash; «الإجمالي» always says its figure. «هادية»:
  // every sum in plain ink, the kind's colour only in the small dot before it (none before a zero
  // of the foot) and on its heading — see `CALM_INK`, `KIND_HEAD_DOT`.
  const kindCol = (kind: FleetCustodySource): Column<FleetCustodyVehicleRowDto> => ({
    key: kind,
    header: t(`fleet.custody.source.${kind}`),
    align: 'center',
    sortable: true,
    headerClassName: cn(KIND_HEAD_DOT, KIND_HEAD_DOT_INK[kind]),
    render: (row) => {
      const grand = row.vehicleId === GRAND_TOTAL;
      if (row[kind] === 0 && !grand) return NONE;
      return (
        <span className="inline-flex items-center gap-1.5" data-custody-kind-sum={kind}>
          {row[kind] !== 0 && (
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', CUSTODY_KIND[kind].dot)}
            />
          )}
          {moneyCell(row[kind], grand ? CALM_FOOT_INK : CALM_INK, MUTED_INK)}
        </span>
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
      // A car's code in its blue chip, with its «السجل» beside it.
      render: (row) =>
        row.vehicleId === GRAND_TOTAL ? (
          <span className={GRAND_WORD}>{row.vehicleCode}</span>
        ) : (
          <span className="inline-flex items-center justify-center gap-2">
            {row.vehicleCode === null ? (
              NONE
            ) : (
              <span dir="ltr" className={cn(CAR_CHIP, FIGURE, ALARMS_CODE_TYPE)}>
                {row.vehicleCode}
              </span>
            )}
            <CustodyCarLogButton
              car={row}
              onOpen={(car, opener) => setCarLog({ key: custodyCarKey(car), car, opener })}
            />
          </span>
        ),
    },
    kindCol('maintenance'),
    kindCol('fuel'),
    kindCol('tyres'),
    kindCol('wash'),
    {
      key: 'total',
      header: t('fleet.custody.columns.total'),
      align: 'center',
      sortable: true,
      className: TOTAL_CELL,
      headerClassName: TOTAL_HEAD,
      render: (row) =>
        row.vehicleId === GRAND_TOTAL
          ? moneyCell(row.total, GRAND_INK)
          : row.total === 0
            ? NONE
            : moneyCell(row.total, TOTAL_INK),
    },
  ];

  // «كل الحركات»: every value and header centred, the date year first in Latin digits, the code
  // bold, money with «ج.م.» beside it, an empty cell a grey dash — in the dashboard log's inks
  // (`MOVEMENTS_TABLE`). Each column's key IS the server's sort key (`CUSTODY_SORTABLE`).
  const columns: Column<FleetCustodyMovementDto>[] = [
    {
      key: 'date',
      align: 'center',
      header: t('fleet.receipts.columns.date'),
      sortable: true,
      render: (row) => (
        <span dir="ltr" data-custody-movement-date="true" className={cn(FIGURE, MUTED_INK)}>
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
      // In the filter's order — maintenance, fuel, tyres, wash — not the word's alphabet.
      sortable: true,
      // The alarms board's pill size, so the kind reads at the row's 16px; the detail in a span
      // of its own, so the table's bold reaches it. A fuel receipt that names its company wears
      // the dashboard log's badge for it; one that names none, nothing.
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <CustodyKindBadge kind={row.source} />
          {detailOf(row) !== '' && <span>{detailOf(row)}</span>}
          {row.source === 'fuel' && row.company !== null && (
            <span
              data-custody-company-badge={row.company}
              className={cn(COMPANY_BADGE, COMPANY[row.company].badge)}
            >
              {t(`fleet.custody.dashboard.company.${row.company}`)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'driverName',
      align: 'center',
      header: t('fleet.receipts.columns.driver'),
      // A receipt that names no driver sorts last whichever way the arrow points.
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
      // «هادية»: in the row's plain ink — every movement is a receipt; the kind's pill says which.
      // A receipt that is a line of a custody memo carries that memo's chip under it, «مذكرة رقم 5»
      // (the receipts screen's own chip and rule: a link for whoever may open the memo).
      render: (row) => {
        const from = (
          <span data-custody-from={row.ref} className={CALM_FROM}>
            {t(`fleet.custody.from.${row.ref}`)}
          </span>
        );
        return row.memo === null ? (
          from
        ) : (
          <span
            className="inline-flex flex-col items-center gap-1"
            data-custody-memo-link={row.memo.no}
          >
            {from}
            <ReceiptMemoChip memo={row.memo} />
          </span>
        );
      },
    },
    {
      key: 'amount',
      align: 'center',
      header: t('fleet.receipts.columns.amount'),
      sortable: true,
      // The whole sum in the dashboard log's ink, «ج.م.» with it.
      render: (row) => moneyCell(row.amount, AMOUNT_INK),
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
      name: t('fleet.nav.custodyExpenses'),
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
        title: t('fleet.nav.custodyExpenses'),
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
                  label: t('fleet.custody.totals.maintenance'),
                  value: reportMoney(summary.data.maintenance),
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
              {t('fleet.custody.dashboard.spendOpen')}
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
          data-custody-filter-bar="true"
          className={cn(DARK_FILTER_BAR, CUSTODY_FILTER_LOOK, '[&_[role=listbox]]:animate-menu-in')}
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
        {/* The board's own `filters`: «لوحة تحكم المصروفات» asks exactly what the figures ask, and
            what it changes it changes HERE — clearing them, «المصدر» = صيانة. */}
        <CustodyDashboard
          open={dashOpen}
          onClose={() => setDashOpen(false)}
          filters={filters}
          onClearFilters={clearFilters}
          onShowMaintenance={() => {
            patch({ source: 'maintenance' });
            setDashOpen(false);
          }}
        />
        {/* A car's «السجل»: its line as the summary holds it now, its share of what the fund paid
            over the same filters (not of the fund itself, `fundTotal`), the board's own filters.
            Keyed by the car: another car's log starts on its first page. */}
        {carLog !== null && (
          <CustodyCarLog
            key={carLog.key}
            car={custodyCurrentCar(summary.data?.vehicles, carLog)}
            spendTotal={summary.data?.total ?? 0}
            filters={filters}
            opener={carLog.opener}
            onClose={() => setCarLog(null)}
          />
        )}

        {/* Two tables share the height, each on the dashboard's table card — the strip with its
            title and count, then rows that scroll on their own: the per-car totals take what they
            need up to a third, the movements the rest. */}
        <section
          data-custody-per-vehicle="true"
          className={cn(SECTION_CARD, 'flex shrink-0 flex-col lg:max-h-[34%]')}
        >
          <div className={SECTION_STRIP}>
            <h2 className={TITLE}>{t('fleet.custody.perVehicle')}</h2>
            {summary.data !== undefined && summary.data.vehicles.length > 0 && (
              <span data-custody-car-count="true" className={cn(CARS_CHIP, NUM)}>
                {count('car', summary.data.vehicles.length)}
              </span>
            )}
          </div>
          <div
            className={cn(
              CUSTODY_TABLE,
              PER_CAR_TABLE,
              EMBEDDED_TABLE,
              'lg:flex lg:min-h-0 lg:flex-col [&>div]:min-h-0',
            )}
          >
            <DataTable
              columns={vehicleColumns}
              rows={perVehicle}
              rowKey={(row) => row.vehicleId ?? `code:${row.vehicleCode ?? ''}`}
              loading={summary.isLoading}
              error={summary.isError ? summary.error : undefined}
              onRetry={() => void summary.refetch()}
              empty={t('fleet.custody.empty')}
              // «الإجمالي» as the dashboard's foot — see `GRAND_ROW`.
              rowClassName={(row) => (row.vehicleId === GRAND_TOTAL ? GRAND_ROW : undefined)}
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
          className={cn(SECTION_CARD, 'flex flex-col lg:min-h-[22rem] lg:flex-1')}
        >
          <div className={SECTION_STRIP}>
            <h2 className={TITLE}>{t('fleet.custody.movements')}</h2>
            {data !== undefined && data.meta.totalItems > 0 && (
              <span data-custody-movement-count="true" className={cn(MOVES_CHIP, NUM)}>
                {count('movement', data.meta.totalItems)}
              </span>
            )}
          </div>
          <div className={cn(CUSTODY_TABLE, MOVEMENTS_TABLE, EMBEDDED_TABLE, BOARD_TABLE_FILL)}>
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
            <div className={SECTION_FOOT}>
              {/* «لا بنفسجى»: the current page in the site's purple, as on every other board. */}
              <FleetPager
                meta={data.meta}
                onPageChange={(p) => patch({ page: String(p) }, false)}
                onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
              />
            </div>
          )}
        </section>
      </div>
    </PageContainer>
  );
};
