// Accidents (FW-8, legacy car_accidents): the §4.6 file registry over FL-6, in the Fleet boards'
// look — «شكل تعديل الشاشه بتاعت الحوادث تمام» (the owner-approved board, 2026-11-09): no page
// title, a toolbar with «N نتيجة», «الإحصائيات», the Excel pill and the purple «تسجيل حادث»; the
// dark filter bar with an icon on every filter; the five totals between the filters and the table,
// behind «الإحصائيات» and closed on the way in; the boards' table, bold like Receipts («سيب شكل
// الخط كدا»), with Azeret Mono figures and year-first dates.
//
// AMOUNTS. The three money facts are shown exactly as stored, and «إجمالي المتبقي» beside them is
// DERIVED on read — `amountCollected + companyCost − paidAmount + in − out`, the contract's own
// `fleetAccidentRemaining`, which is also what the server sums for the figures. Nothing about it
// is stored: no column, no migration, no second copy to fall out of step. A file that took from or
// gave to another car prints «تحويل وارد» / «تحويل صادر» and the amount under its remaining, so
// the row's own figures add up on screen.
//
// THE FIGURES ARE THE SERVER'S. They describe every accident the filters match, not the page in
// front of the reader, so they come from their own endpoint whose query has no `page` at all —
// summing the rows in hand would produce a number that changed when you turned the page.
//
// OPEN/CLOSED is purely the backend's, and so is the green row: the tint is read from the
// persisted `status` on every render, never from anything the screen remembers, which is why a
// refresh cannot lose it and a failed flip cannot invent it. Flipping is one version-aware call in
// either direction (FR-10, one grant covers both), a no-op flip is refused server-side, and the UI
// offers the ONE direction the current state allows. There is no Status COLUMN: the state is the
// row's colour, the direction of its action, and a word for screen readers — three carriers, none
// of them colour alone.
//
// URL-synced filters (dates + vehicle codes + culprit drivers + note search + status + the
// dashboard's vehicle set), sortable columns and pagination, per the module idiom.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fleetAccidentRemaining,
  splitVehicleCodeList,
  type FleetAccidentDto,
  type FleetAccidentTotalsDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { FleetPager } from '../components/FleetPager';
import { Button } from '../../../shared/ui/Button';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { CheckIcon, CornerDownIcon, HistoryIcon } from '../../../shared/ui/icons';
import { ACTION_GROUP, actionTone } from '../components/row-actions-look';
import { SquarePenIcon, Trash2Icon } from '../components/row-action-icons';
import { formatDate, formatMoney, formatMoneyParts } from '../../../shared/lib/format';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import {
  useAccidentSummary,
  useAccidents,
  useAllVehicles,
  useDeleteAccident,
  useSetAccidentStatus,
} from '../api/fleet-queries';
import * as fleetApi from '../api/fleet-api';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FigureChip, moneyChip } from '../components/FleetFigures';
import { BoardIcon, NUM, PATH, ymd } from '../components/FuelCardBoard';
import { CUSTODY_NEGATIVE_INK } from '../components/CustodyFigures';
import { DARK_TABLE } from './VehiclesListPage';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { RegistryDriverPicker } from '../components/RegistryDriverPicker';
import { AccidentFormDialog } from '../components/AccidentFormDialog';
import { AccidentTransferLogDialog } from '../components/AccidentTransferLogDialog';
import { DriverHoverText } from '../components/DriverHoverCard';
import { VehicleHoverCode } from '../components/VehicleHoverCard';
import { useEmployeeRecords } from '../components/EmployeeName';
import { CatalogMultiSelect } from '../components/CatalogMultiSelect';
import { VehicleSetChip } from '../components/VehicleSetChip';
import { BranchFilterSelect } from '../../hr/recruitment/shared/BranchFilterSelect';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { readList, writeList } from '../../../shared/lib/list-param';
import {
  CLEAR_VEHICLE_SET,
  hasVehicleSet,
  useVehicleTypeOptions,
  vehicleSetReaders,
  vehicleSetQuery,
} from '../lib/vehicle-set-params';

/** Remembered across visits: this screen's filters and view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'branch',
  'culpritBy',
  'from',
  'notes',
  'operation',
  'status',
  'to',
  'type',
  'vehicleCodes',
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
const DEFAULT_SORT = 'occurredAt:desc';

/** «مفتوح» / «مغلق» is ONE answer: the list holds at most one. */
const one = (value: string): string[] => (value === '' ? [] : [value]);
/** A count in Latin digits, grouped — «1,204» — as the boards write every figure. */
const LATIN = new Intl.NumberFormat('en-US');

/** Every filter is `density="tight"`, as on the vehicles, maintenance and receipts boards. */
const TIGHT = 'tight' as const;

/** The toolbar's three buttons — ReceiptsPage's / MaintenancePage's own (local there too). */
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';
const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';

/**
 * The closed file's green — MaintenancePage's `CLOSED_ROW` (local there). The boards' table paints
 * its own hover over every row, so the tint is restated on the row's `data-closed`, with a hover of
 * its own: a closed file stays green under the pointer too.
 */
const CLOSED_ROW =
  '[&_tbody_tr[data-closed=true]]:!bg-emerald-50 dark:[&_tbody_tr[data-closed=true]]:!bg-[#10241c] [&_tbody_tr[data-closed=true]:hover]:!bg-emerald-100 dark:[&_tbody_tr[data-closed=true]:hover]:!bg-[#143026]';

/**
 * The boards' table: DARK_TABLE, Arabic words in Cairo, every figure in `NUM` (Azeret Mono), the
 * values bold like Receipts. The date and the car code never break their heading over two lines,
 * so the heading row stays one line high as on the maintenance and receipts boards.
 */
const ACCIDENTS_TABLE = cn(
  DARK_TABLE,
  BOARD_TABLE_FILL,
  "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif]",
  '[&_thead_th:nth-child(-n+2)]:!whitespace-nowrap',
  CLOSED_ROW,
);

/** A figure on the row — «2026/11/07», «1,500.00»: monospace, tabular, one line. */
const FIGURE = cn('whitespace-nowrap', NUM);
const DASH = <span className="text-slate-400">—</span>;

/**
 * The five figures behind «الإحصائيات», straight from the server's own sums. Its fixes stay HERE
 * (the shared `FigureChip` is not changed): the negative remaining is isolated left to right so
 * its «−» reads in front of the figure, and its red is made to win over the chip's own colour.
 */
export const AccidentFigures = ({ totals }: { totals: FleetAccidentTotalsDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const negative = totals.remaining < 0;
  const remaining = moneyChip(Math.abs(totals.remaining), locale);
  return (
    <section
      data-accident-figures="true"
      className="grid shrink-0 animate-drop-in grid-cols-2 gap-3 lg:grid-cols-5"
    >
      <div className="col-span-2 sm:col-span-1">
        <FigureChip
          icon={PATH.warn}
          iconClass="bg-rose-500/10 text-rose-600 dark:text-rose-400"
          label={t('fleet.accidents.totals.count')}
          value={LATIN.format(totals.count)}
          unit=""
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <FigureChip
          icon={PATH.box}
          iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
          label={t('fleet.accidents.totals.amountCollected')}
          {...moneyChip(totals.amountCollected, locale)}
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <FigureChip
          icon={FILTER_ICON.branch}
          iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-300"
          label={t('fleet.accidents.totals.companyCost')}
          {...moneyChip(totals.companyCost, locale)}
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <FigureChip
          icon={PATH.card}
          iconClass="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
          label={t('fleet.accidents.totals.paidAmount')}
          {...moneyChip(totals.paidAmount, locale)}
        />
      </div>
      <div className="col-span-2 sm:col-span-1" data-accident-figure="remaining">
        <FigureChip
          icon={PATH.trend}
          iconClass={
            negative
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          }
          label={t('fleet.accidents.totals.remaining')}
          // FigureChip writes its value in the page's direction, which sends a leading «−» to the
          // far end («11,287.50−»); the figure is isolated left to right (LRI … PDI) so it reads
          // «−11,287.50», as the custody header's `dir="ltr"` negative does.
          value={negative ? `⁦−${remaining.value}⁩` : remaining.value}
          unit={remaining.unit}
          // FigureChip hard-codes `text-slate-900 dark:text-white` beside `valueClass`, and that
          // colour comes later in the stylesheet than the red — so the red is made to win here.
          {...(negative ? { valueClass: '!text-red-600 dark:!text-red-400' } : {})}
        />
      </div>
    </section>
  );
};

/**
 * The culprit as the accident wrote it, and — when it was one or several of our drivers — their
 * card on hover. A third party's name is the text alone.
 */
const CulpritCell = ({ accident }: { accident: FleetAccidentDto }): JSX.Element => {
  const people = useEmployeeRecords(accident.culpritEmployeeIds);
  return <DriverHoverText people={[...people.values()]}>{accident.culprit}</DriverHoverText>;
};

export const AccidentsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const vehicleCodes = splitVehicleCodeList(sp.get('vehicleCodes') ?? '');
  // WHICH drivers, exactly — by name or code, several at once.
  const culpritBy = splitVehicleCodeList(sp.get('culpritBy') ?? '');
  // «عاوز اقدر ابحث فى الملاحظات» — part of the note, matched server-side over the WHOLE set.
  // Not a filter the browser could apply: the table holds one page, and the note that would have
  // found the file is usually on a page nobody is looking at.
  const notes = sp.get('notes') ?? '';
  const status = sp.get('status') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  // The cars a dashboard figure was counted over — «النوع» · «التشغيل» · «الفرع» — resolved by the
  // server against the registry, so the files here are the ones the figure counted.
  const vehicleSet = {
    typeIds: readList(sp, 'type'),
    operationIds: readList(sp, 'operation'),
    branchIds: readList(sp, 'branch'),
  };
  const narrowedToSet = hasVehicleSet(vehicleSet);
  // The types list and the operations catalog are their own endpoints' (TYPE_READERS /
  // OPERATION_READERS), not this screen's guard: never asked for without them.
  const sets = vehicleSetReaders(can);
  const typeOptions = useVehicleTypeOptions(narrowedToSet && sets.types);
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  /**
   * The columns this table is sorted by, in the order the reader clicked them —
   * «انا عاوز اقدر اعمل الاتنين مع بعض». One parameter carries the whole order; `occurredAt:desc`
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

  /**
   * WHAT THE READER IS LOOKING AT — the filters, and only the filters.
   *
   * This object is also exactly what the totals are asked for, which is the whole reason it is
   * split out from the page: the figures describe THIS set, and paging cannot reach them.
   */
  const filters = useMemo(
    () => ({
      vehicleCodes: vehicleCodes.length === 0 ? undefined : vehicleCodes,
      culpritEmployeeId: culpritBy.length === 0 ? undefined : culpritBy.join(','),
      notes: notes || undefined,
      status: status || undefined,
      from: from || undefined,
      to: to || undefined,
      ...vehicleSetQuery(vehicleSet),
    }),
    [paramsKey],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, ...sortQuery(sorts) }),
    [filters, page, pageSize, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useAccidents(params);
  const rows = data?.items ?? [];
  const summary = useAccidentSummary(filters);

  const clearFilters = (): void =>
    // ONE update, every key — leaving any behind would hand back a "cleared" bar that is still
    // filtering.
    patch({
      vehicleCodes: null,
      culpritBy: null,
      notes: null,
      status: null,
      from: null,
      to: null,
      ...CLEAR_VEHICLE_SET,
    });
  const hasFilters =
    vehicleCodes.length > 0 ||
    culpritBy.length > 0 ||
    notes !== '' ||
    status !== '' ||
    from !== '' ||
    to !== '' ||
    narrowedToSet;

  // Unfiltered registry map so files of retired vehicles still resolve to their codes — the WHOLE
  // registry, not its first page of 100. Asked for only by a reader who may read the registry
  // (`fleetVehicle.view`); for anyone else the row's own code — the server joins it — is the code.
  const vehiclesQuery = useAllVehicles({ anyStatus: true }, can('fleetVehicle.view'));
  // The row's own code first — the server resolves it, and a file kept from the old book for a
  // car the registry never had carries the book's code and no vehicle at all.
  const codeOf = (r: { vehicleId: string | null; vehicleCode: string | null }): string =>
    r.vehicleCode ??
    (r.vehicleId === null
      ? '—'
      : (vehiclesQuery.data?.items.find((v) => v.id === r.vehicleId)?.code ??
        r.vehicleId.slice(-8)));

  const [recordOpen, setRecordOpen] = useState(false);
  const [editing, setEditing] = useState<FleetAccidentDto | null>(null);
  const [flipping, setFlipping] = useState<FleetAccidentDto | null>(null);
  const [deleting, setDeleting] = useState<FleetAccidentDto | null>(null);
  /** The car whose transfer log is open — «خدت من مين او ادت ل مين». */
  const [logOf, setLogOf] = useState<FleetAccidentDto | null>(null);
  // «الإحصائيات» — the five totals open from the toolbar, closed on the way in, as on the boards.
  const [statsOpen, setStatsOpen] = useState(false);
  const setStatus = useSetAccidentStatus();
  const remove = useDeleteAccident();

  const confirmFlip = async (): Promise<void> => {
    if (flipping === null) return;
    const next = flipping.status === 'open' ? 'closed' : 'open';
    await setStatus.mutateAsync({
      id: flipping.id,
      body: { status: next, version: flipping.version },
    });
    toast.success(t(next === 'closed' ? 'fleet.accidents.closed' : 'fleet.accidents.reopened'));
    setFlipping(null);
  };

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.accidents.deleted'));
    setDeleting(null);
  };

  /**
   * A sum of money on the row as the receipts board writes one: the figure in `NUM`, «ج.م.» beside
   * it in the page's type. `signed`: a negative remaining in the boards' red, «−1,850.00», read
   * left to right so the minus stays in front of the figure.
   */
  const money = (amount: number, signed = false): JSX.Element => {
    const negative = signed && amount < 0;
    const { figure, currency } = formatMoneyParts(Math.abs(amount), 'EGP', locale);
    return (
      <span
        className="inline-flex items-baseline gap-1"
        {...(negative ? { 'data-negative': 'true' } : {})}
      >
        <span dir="ltr" className={cn(FIGURE, negative && CUSTODY_NEGATIVE_INK)}>
          {negative ? `−${figure}` : figure}
        </span>
        <span className="text-xs text-slate-500 dark:text-slate-400">{currency}</span>
      </span>
    );
  };

  /** «تحويل وارد +500.00» / «تحويل صادر −1,000.00» — small and muted, under the remaining. */
  const transferLine = (way: 'in' | 'out', amount: number): JSX.Element => (
    <span
      data-transfer-line={way}
      className="inline-flex items-baseline gap-1.5 whitespace-nowrap text-[11px] font-semibold leading-none text-slate-500 dark:text-slate-400"
    >
      <span>{t(`fleet.accidents.transferLine.${way}`)}</span>
      <span dir="ltr" className={NUM}>
        {way === 'in' ? '+' : '−'}
        {formatMoneyParts(amount, 'EGP', locale).figure}
      </span>
    </span>
  );

  /**
   * «للشاشات دى اعملى اكسلات هتاخد اللى الفلتر عامله بس · ومفيش امضاءات».
   *
   * THE FILTER'S WHOLE ANSWER, not the page's. `params` carries the reader's filters, their sort
   * AND their page; `filtersOnly` drops the last of the three and `fetchFilteredRows` walks every
   * page, so a reader who narrows to four hundred files gets four hundred rows rather than the
   * twenty-five in front of them. The sort rides along untouched.
   *
   * THE CODE CELL IS SPLIT. On screen it carries two facts — the car's code and, for anyone the
   * green tint does not reach, the open/closed state. A spreadsheet has neither the tint nor the
   * action button, so the state becomes a column of its own.
   *
   * THE FOUR SUMS GO IN AS NUMBERS, never as `formatMoney` strings, so the reader can total a
   * filtered set in the sheet itself. «إجمالي المتبقي» is computed by the CONTRACT's own formula,
   * the same one the column prints and the server sums for the figures.
   */
  const exportSheet = async (): Promise<void> => {
    const sheetFilters = filtersOnly(params);
    const all = await fetchFilteredRows((pageNo, size) =>
      fleetApi.listAccidents({ ...sheetFilters, page: pageNo, pageSize: size }),
    );
    // «الحوادث ضيف السجل فى الاكسيل» — the SAME log the row's button opens, one line per car, read
    // once for each car that has any. A car with none leaves the cell empty.
    const withLog = [
      ...new Set(
        all
          .filter((r) => r.carHasTransfers && r.vehicleId !== null)
          .map((r) => r.vehicleId as string),
      ),
    ];
    const logs = new Map(
      await Promise.all(
        withLog.map(
          async (vehicleId) => [vehicleId, await fleetApi.accidentCarTransfers(vehicleId)] as const,
        ),
      ),
    );
    const logCell = (vehicleId: string | null): string =>
      vehicleId === null
        ? ''
        : (logs.get(vehicleId)?.entries ?? [])
            .map(
              (entry) =>
                `${t(entry.direction === 'in' ? 'fleet.accidents.log.paidFrom' : 'fleet.accidents.log.paidTo')} ${entry.otherVehicleCode ?? '—'}: ${formatMoney(entry.amount, 'EGP', locale)}`,
            )
            .join(' — ');
    saveSheet({
      name: t('fleet.nav.accidents'),
      serialHeader: t('fleet.violations.report.serial'),
      // The car's column is headed «كود السيارة», as on the screen.
      header: [
        t('fleet.odometer.columns.vehicle'),
        t('fleet.vehicles.columns.status'),
        t('fleet.accidents.fields.occurredAt'),
        t('fleet.accidents.fields.culprit'),
        t('fleet.accidents.fields.statement'),
        t('fleet.accidents.fields.amountCollected'),
        t('fleet.accidents.fields.companyCost'),
        t('fleet.accidents.fields.paidAmount'),
        t('fleet.accidents.fields.remaining'),
        t('fleet.accidents.log.column'),
        t('fleet.accidents.fields.notes'),
      ],
      // `codeOf` is the table's own resolver, reused rather than repeated, so a file kept from
      // the old book reads in the sheet exactly as it reads on screen.
      rows: all.map((r) => [
        codeOf(r),
        t(`fleet.accidents.status.${r.status}`),
        formatDate(r.occurredAt, locale),
        r.culprit,
        r.statement,
        r.amountCollected,
        r.companyCost,
        r.paidAmount,
        fleetAccidentRemaining(r),
        logCell(r.vehicleId),
        r.notes ?? '',
      ]),
      moneyColumns: [5, 6, 7, 8],
    });
  };
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

  // The boards' table — every value centred under a centred header, the date year first, every
  // figure in Latin digits; the row's controls at its end. The date first, then «كود السيارة», as
  // on maintenance, receipts and the dealership.
  const columns: Column<FleetAccidentDto>[] = [
    {
      key: 'occurredAt',
      align: 'center',
      header: t('fleet.accidents.fields.occurredAt'),
      sortable: true,
      render: (r) =>
        r.occurredAt === null ? (
          DASH
        ) : (
          <span dir="ltr" className={FIGURE}>
            {ymd(r.occurredAt)}
          </span>
        ),
    },
    {
      key: 'vehicle',
      align: 'center',
      header: t('fleet.odometer.columns.vehicle'),
      // The car's CODE, joined in by the server before the page is cut: the register is paged, so
      // ordering the rows in hand would sort one page and claim to have sorted the file.
      sortable: true,
      sortKey: 'vehicleCode',
      // «عاوز لما اماوس يقف على كود عربيه يجيب بيانات» — the car card hangs on the code's own
      // element; a file kept from the old book with no registry car (`vehicleId` null) has none.
      render: (r) => (
        <VehicleHoverCode
          vehicleId={r.vehicleId}
          code={codeOf(r)}
          dir="ltr"
          className={cn('text-sm font-bold', FIGURE)}
        >
          {codeOf(r)}
          {/*
            The row's state, for anyone the colour does not reach. With no Status column the
            open/closed fact is carried by the tint and by the direction of the action button —
            and a reader who has neither the colour nor the close grant would be left with
            nothing. This is that third carrier, and it costs no width.
          */}
          <span className="sr-only"> — {t(`fleet.accidents.status.${r.status}`)}</span>
        </VehicleHoverCode>
      ),
    },
    {
      key: 'culprit',
      align: 'center',
      header: t('fleet.accidents.fields.culprit'),
      render: (r) => <CulpritCell accident={r} />,
    },
    {
      key: 'statement',
      align: 'center',
      header: t('fleet.accidents.fields.statement'),
      render: (r) => (
        <span className="mx-auto block min-w-[9rem] max-w-[13rem] whitespace-normal break-words leading-snug [text-wrap:balance]">
          {r.statement}
        </span>
      ),
    },
    {
      key: 'amountCollected',
      align: 'center',
      header: t('fleet.accidents.fields.amountCollected'),
      sortable: true,
      render: (r) => money(r.amountCollected),
    },
    {
      key: 'companyCost',
      align: 'center',
      header: t('fleet.accidents.fields.companyCost'),
      sortable: true,
      render: (r) => money(r.companyCost),
    },
    {
      key: 'paidAmount',
      align: 'center',
      header: t('fleet.accidents.fields.paidAmount'),
      sortable: true,
      render: (r) => money(r.paidAmount),
    },
    {
      // Derived here from the facts beside it, by the CONTRACT's formula — the same one the
      // server sums for the figures. ORDERED BY THE SAME SUBTRACTION, computed in the query
      // before the page is cut: «مين لسه عليه أكتر» is a question about the whole file.
      key: 'remaining',
      align: 'center',
      header: t('fleet.accidents.fields.remaining'),
      sortable: true,
      render: (r) =>
        r.transferredIn > 0 || r.transferredOut > 0 ? (
          <span className="inline-flex flex-col items-center gap-1">
            {money(fleetAccidentRemaining(r), true)}
            {r.transferredIn > 0 && transferLine('in', r.transferredIn)}
            {r.transferredOut > 0 && transferLine('out', r.transferredOut)}
          </span>
        ) : (
          money(fleetAccidentRemaining(r), true)
        ),
    },
    {
      // «يتحط زرار فى كل صف يكون قبل الملاحظات» — the CAR's log, opened from any of its files.
      key: 'transferLog',
      align: 'center',
      header: t('fleet.accidents.log.column'),
      render: (r) =>
        r.vehicleId === null ? (
          DASH
        ) : (
          <span className={ACTION_GROUP}>
            <button
              type="button"
              data-transfer-log-open={r.id}
              data-has-transfers={r.carHasTransfers ? 'true' : undefined}
              // A log, so slate among the actions. «لو السجل فى عمليه واحده على الاقل يخليه باللون
              // الاصفر» — the owner's own yellow once the car has paid from or to another car at
              // least once is a fact about the car, not the colour of an action, and stays.
              className={cn(
                actionTone('history'),
                r.carHasTransfers &&
                  '!bg-amber-100 !text-amber-800 hover:!bg-amber-200 dark:!bg-amber-900/60 dark:!text-amber-200 dark:hover:!bg-amber-900',
              )}
              aria-label={t('fleet.accidents.log.open', { code: codeOf(r) })}
              title={t('fleet.accidents.log.open', { code: codeOf(r) })}
              onClick={() => setLogOf(r)}
            >
              <HistoryIcon className="h-4 w-4" />
            </button>
          </span>
        ),
    },
    {
      key: 'notes',
      align: 'center',
      header: t('fleet.accidents.fields.notes'),
      render: (r) =>
        r.notes === null ? (
          DASH
        ) : (
          <span className="mx-auto block max-w-[12.5rem] whitespace-normal break-words leading-snug [text-wrap:balance]">
            {r.notes}
          </span>
        ),
    },
    ...(can('fleetAccident.edit') || can('fleetAccident.close') || can('fleetAccident.delete')
      ? [
          {
            key: 'actions',
            header: t('fleet.vehicles.columns.actions'),
            align: 'center',
            // «اعملى الالوان دى»: the owner's picture — the pen, the close or reopen in its own
            // calm colour, the bin (`row-actions-look`).
            render: (r: FleetAccidentDto) => (
              <span className={ACTION_GROUP} data-row-actions="accident">
                {can('fleetAccident.edit') && (
                  <button
                    type="button"
                    className={actionTone('edit')}
                    aria-label={t('fleet.accidents.edit')}
                    title={t('fleet.accidents.edit')}
                    onClick={() => setEditing(r)}
                  >
                    <SquarePenIcon className="h-4 w-4" />
                  </button>
                )}
                {can('fleetAccident.close') &&
                  (r.status === 'open' ? (
                    <button
                      type="button"
                      className={actionTone('status')}
                      aria-label={t('fleet.accidents.close')}
                      title={t('fleet.accidents.close')}
                      onClick={() => setFlipping(r)}
                    >
                      <CheckIcon className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={actionTone('reopen')}
                      aria-label={t('fleet.accidents.reopen')}
                      title={t('fleet.accidents.reopen')}
                      onClick={() => setFlipping(r)}
                    >
                      <CornerDownIcon className="h-4 w-4" />
                    </button>
                  ))}
                {can('fleetAccident.delete') && (
                  <button
                    type="button"
                    className={actionTone('delete')}
                    aria-label={t('fleet.accidents.delete')}
                    title={t('fleet.accidents.delete')}
                    onClick={() => setDeleting(r)}
                  >
                    <Trash2Icon className="h-4 w-4" />
                  </button>
                )}
              </span>
            ),
          } satisfies Column<FleetAccidentDto>,
        ]
      : []),
  ];

  /** «من» / «إلى» written inside the box while it is empty — MaintenancePage's `dateBound`. */
  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => (
    <FilterWithIcon
      icon={FILTER_ICON.calendar}
      tone="text-cyan-600 dark:text-cyan-400"
      className="w-36 shrink-0 max-sm:basis-[calc(50%-4px)]"
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
          className="pointer-events-none absolute inset-y-0 left-1.5 right-11 flex items-center justify-center truncate text-sm text-slate-500 peer-focus:hidden lg:max-xl:text-xs dark:text-slate-400"
        >
          {t(labelKey)}
        </span>
      )}
    </FilterWithIcon>
  );

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME} data-accidents-board="true">
        {/* «زى باقى شاشات الحركة»: no page title — the board opens on its toolbar. */}
        <div className="flex items-center justify-between gap-2" data-accidents-toolbar="true">
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {data === undefined
              ? ''
              : // Latin digits, as every figure on the board — `formatNumber` would print «١٢».
                t('common.list.count', { count: LATIN.format(data.meta.totalItems) })}
          </span>
          <span className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              data-accident-stats-toggle="true"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((open) => !open)}
              className={BRAND_BUTTON}
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
            {/* Excel ONLY — the accidents screen has never printed a PDF. NOT OFFERED WHEN THE
                LIST FAILED: a green button on a screen that has just told the reader it has no
                data reads as a way out of the failure, and the file behind it would be empty or
                short. */}
            {!isError && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80">
                <button
                  type="button"
                  data-export="accidents"
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
            {can('fleetAccident.create') && (
              <button
                type="button"
                data-accident-new="true"
                onClick={() => setRecordOpen(true)}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t('fleet.accidents.record')}
              </button>
            )}
          </span>
        </div>

        {/* The vehicles board's dark bar: every filter's name in its box, an icon at its start. */}
        <div
          className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}
          data-accidents-filters="true"
        >
          <FilterBar hasActiveFilters={hasFilters} onClear={clearFilters}>
            {dateBound('fleet.odometer.from', from, 'from')}
            {dateBound('fleet.odometer.to', to, 'to')}
            {/* On a phone the bar reads in clean pairs — من/إلى · كود/الحالة — then the culprit and
                the note search each across the row (`order`). ONE vehicle control: a substring
                code box beside a single-car dropdown, intersected by the server, once produced an
                empty page the bar itself had offered. */}
            <FilterWithIcon
              icon={FILTER_ICON.car}
              tone="text-emerald-600 dark:text-emerald-400"
              className="max-sm:basis-[calc(50%-4px)]"
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
            {/* WHICH of our drivers was at fault, several at once — a third party is found by the
                note search or by the code. */}
            <FilterWithIcon
              icon={FILTER_ICON.person}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-52 max-sm:order-1 max-sm:basis-full"
            >
              <RegistryDriverPicker
                multiple
                fullWidth
                density={TIGHT}
                className="w-full"
                placeholder={t('fleet.accidents.fields.culprit')}
                value={culpritBy}
                onChange={(next) => patch({ culpritBy: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
            {/* THE NOTE, SEARCHED — «عاوز اقدر ابحث فى الملاحظات». */}
            <FilterWithIcon
              icon={PATH.edit}
              tone="text-slate-500 dark:text-slate-400"
              className="w-40 max-sm:order-1 max-sm:basis-full"
            >
              <Input
                aria-label={t('fleet.odometer.columns.notes')}
                placeholder={t('fleet.maintenance.notesFilter')}
                density={TIGHT}
                value={notes}
                onChange={(e) => patch({ notes: e.target.value || null })}
              />
            </FilterWithIcon>
            {/* «مفتوح» / «مغلق» — ONE answer: ticking one replaces the other, empty is every file. */}
            <FilterWithIcon
              icon={FILTER_ICON.status}
              tone="text-emerald-600 dark:text-emerald-400"
              className="max-sm:basis-[calc(50%-4px)]"
            >
              <MultiSelect
                clearable
                fullWidth
                className="w-full"
                density={TIGHT}
                showSelectedValues
                label={t('fleet.vehicles.columns.status')}
                options={[
                  { value: 'open', label: t('fleet.accidents.status.open') },
                  { value: 'closed', label: t('fleet.accidents.status.closed') },
                ]}
                value={one(status)}
                onChange={(next) => patch({ status: pickOne(one(status), next) })}
              />
            </FilterWithIcon>
            {/* The vehicle set a dashboard link narrowed the files to — shown only while it does,
                so a remembered one is never a filter with nothing on the bar saying so. The same
                controls the registry (type) and the maintenance screen (operation, branch) use. */}
            {narrowedToSet && (
              <>
                {sets.types ? (
                  <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
                    <MultiSelect
                      clearable
                      className="w-full"
                      fullWidth
                      density={TIGHT}
                      showSelectedValues
                      chips
                      label={t('fleet.vehicles.filters.short.make')}
                      options={typeOptions}
                      value={vehicleSet.typeIds}
                      onChange={(ids) => patch({ type: writeList(ids) })}
                    />
                  </FilterWithIcon>
                ) : (
                  vehicleSet.typeIds.length > 0 && (
                    <VehicleSetChip kind="type" onClear={() => patch({ type: null })} />
                  )
                )}
                {sets.operations ? (
                  <FilterWithIcon
                    icon={FILTER_ICON.operation}
                    tone="text-slate-600 dark:text-slate-300"
                  >
                    <CatalogMultiSelect
                      kind="operation"
                      className="w-full"
                      fullWidth
                      density={TIGHT}
                      value={vehicleSet.operationIds}
                      onChange={(ids) => patch({ operation: writeList(ids) })}
                      label={t('fleet.vehicles.filters.short.operation')}
                    />
                  </FilterWithIcon>
                ) : (
                  vehicleSet.operationIds.length > 0 && (
                    <VehicleSetChip kind="operation" onClear={() => patch({ operation: null })} />
                  )
                )}
                {/* `BranchFilterSelect` takes no width of its own, so its trigger is sized here. */}
                <FilterWithIcon
                  icon={FILTER_ICON.branch}
                  tone="text-violet-600 dark:text-violet-300"
                  className="[&>div>div:not([role=listbox])]:flex [&>div>div:not([role=listbox])]:w-full [&_button[aria-haspopup]]:w-full [&_button[aria-haspopup]]:justify-between"
                >
                  <BranchFilterSelect
                    clearable
                    value={vehicleSet.branchIds}
                    onChange={(ids) => patch({ branch: writeList(ids) })}
                  />
                </FilterWithIcon>
              </>
            )}
          </FilterBar>
        </div>

        {/* «الاجماليات تكون بين الجدول والفلاتر» — behind «الإحصائيات», as on the boards. */}
        {statsOpen && summary.data !== undefined && <AccidentFigures totals={summary.data} />}

        <div className={ACCIDENTS_TABLE} data-accidents-table="true">
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            sort={sorts}
            onSortChange={changeSort}
            // Read from the PERSISTED status on every render, and from nothing else. A file the
            // server says is closed is green after a refresh, in another tab, and for the next
            // reader; a flip that fails leaves the row exactly as the server still has it. The
            // boards' table paints its own hover, so the tint is restated on `data-closed` too —
            // see `CLOSED_ROW`.
            rowClassName={(r) =>
              r.status === 'closed' ? 'bg-emerald-50/70 dark:bg-emerald-950/30' : undefined
            }
            rowProps={(r) => ({ 'data-closed': r.status === 'closed' ? 'true' : 'false' }) as never}
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

      <AccidentFormDialog
        open={recordOpen}
        onClose={() => setRecordOpen(false)}
        accident={null}
        // Carried over from the filter, but only when it names ONE car — the same rule the other
        // screens' dialogs use. The id comes from the registry this screen holds to print codes
        // on its rows; the DIALOG still picks a single vehicle, as it should.
        initialVehicleId={
          vehicleCodes.length === 1
            ? (vehiclesQuery.data?.items.find((v) => v.code === vehicleCodes[0])?.id ?? '')
            : ''
        }
      />
      <AccidentTransferLogDialog
        vehicleId={logOf?.vehicleId ?? null}
        code={logOf === null ? '' : codeOf(logOf)}
        mayRemove={can('fleetAccident.edit')}
        onClose={() => setLogOf(null)}
      />
      <AccidentFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        accident={editing}
      />
      <Dialog
        open={flipping !== null}
        onClose={() => setFlipping(null)}
        title={
          flipping?.status === 'open'
            ? t('fleet.accidents.closeTitle', { code: codeOf(flipping) })
            : t('fleet.accidents.reopenTitle', {
                code: flipping === null ? '' : codeOf(flipping),
              })
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setFlipping(null)}>
              {t('common.cancel')}
            </Button>
            <Button loading={setStatus.isPending} onClick={() => void confirmFlip()}>
              {flipping?.status === 'open'
                ? t('fleet.accidents.close')
                : t('fleet.accidents.reopen')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {flipping?.status === 'open'
            ? t('fleet.accidents.closeBody')
            : t('fleet.accidents.reopenBody')}
        </p>
      </Dialog>
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.accidents.deleteTitle')}
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
              {t('fleet.accidents.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.accidents.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
