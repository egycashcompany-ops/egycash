// «مصروفات التراخيص» — every licensing-expenses memo the department wrote, in the boards' look.
//
// «مش قولتلك ضيف كل حاجه كنا عملنها فى شاشه مصروفات التراخيص»: what the other Fleet boards were
// given, given here too — no page title, a toolbar with the count, «الإحصائيات», the Excel / PDF pill,
// «إعداد النماذج» and «+ مذكرة جديدة»; the dark filter bar, the memo's dates with it; the receipts
// board's table (no column lines, Cairo bold) in the alarms board's type, every value centred; an
// arrow on every column, several at once, ordered by the server; and the figures over the whole
// filtered set, between the filters and the table.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { type FleetLicenseExpenseDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Input } from '../../../shared/ui/form';
import { Spinner } from '../../../shared/ui/Spinner';
import { CogIcon } from '../../../shared/ui/icons';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { formatDate, formatMoneyParts, formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import * as fleetApi from '../api/fleet-api';
import {
  useDeleteLicenseExpense,
  useLicenseExpenseSummary,
  useLicenseExpenses,
} from '../api/fleet-queries';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FigureChip, moneyChip } from '../components/FleetFigures';
import { FleetPager } from '../components/FleetPager';
import { BoardIcon, NUM, PATH, ymd } from '../components/FuelCardBoard';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { memoHtml, memoTitle, memosOf, printMemos, sumOf } from '../lib/license-expense-memo';
import { DARK_TABLE } from './VehiclesListPage';
import { ALARMS_TYPE } from './MaintenanceAlarmsPage';

/** Remembered across visits: the filters, the page size and the order. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['from', 'to', 'vehicleCodes', 'kind', 'size', 'sort'] as const;
const DEFAULT_PAGE_SIZE = 25;
/** The newest memo first, as the table always opened. */
const DEFAULT_SORT = 'date:desc';
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');

/** Every filter is `density="tight"`, as on the vehicles board. */
const TIGHT = 'tight' as const;

/** The boards' figure: monospace, tabular, never broken over two lines. */
const FIGURE = cn('whitespace-nowrap', NUM);
/** A count on the figures as the boards write one — Latin digits, grouped with a comma. */
const LATIN = new Intl.NumberFormat('en-US');
/** An empty cell, as the boards draw one. */
const DASH = <span className="text-slate-400">—</span>;
const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/** The board's toolbar buttons, from the vehicles screen — a size down on a phone. */
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';
const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';

/**
 * The receipts board's table — the vehicles table with no line between the columns, every value
 * heavy in Cairo's own bold — in the alarms board's TYPE, as the maintenance and odometer boards
 * wear it (`ALARMS_TYPE`): 16px values, 14px headers, a size up on a wide screen.
 */
const LICENSE_TABLE = cn(
  DARK_TABLE,
  BOARD_TABLE_FILL,
  '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
  "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
  ALARMS_TYPE,
);

/** The kind's pill: the alarms board's level pill in size (`Badge` `lg`), so it reads at the row's. */
const KIND_PILL =
  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[15px] leading-5';

// A record is a renewal, an extension, or both: its figures are both halves together.
type MemoRow = Pick<FleetLicenseExpenseDto, 'date' | 'renewal' | 'extension' | 'signatures'>;
const carsOf = (row: MemoRow): { code: string | null; plate: string }[] =>
  memosOf(row).flatMap((memo) => memo.vehicles.map((v) => ({ code: v.code, plate: v.plate })));
const carName = (car: { code: string | null; plate: string }): string => car.code ?? car.plate;

/**
 * «مش عاوز رقم اللوحة يظهر الكود بس»: what the list shows of a memo's cars — the registry's codes,
 * in the memo's order, and only HOW MANY were typed by hand with no code, never their plates. The
 * two add up to every car the memo names, so none silently drops out of the cell.
 */
export const carCodesOf = (row: MemoRow): { codes: string[]; unregistered: number } => {
  const cars = carsOf(row);
  const codes = cars.flatMap((car) =>
    car.code === null || car.code.trim() === '' ? [] : [car.code.trim()],
  );
  return { codes, unregistered: cars.length - codes.length };
};

/** A code as a chip: the boards' figure type, bold, Latin, in a neutral box — not a state. */
const CODE_CHIP =
  'rounded-md border border-slate-300 bg-slate-50 px-1.5 py-px text-[15px] leading-5 text-slate-900 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-white';
/** How many cars, ahead of the chips: a round neutral figure, so it never reads as one more code. */
const COUNT_BADGE =
  'inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-slate-200 px-1.5 text-[13px] leading-none text-slate-700 dark:bg-slate-700 dark:text-slate-100';

/**
 * A memo's figure under one money column — `null` where no line was paid that way (no line at all,
 * for the grand total). The table draws its grey dash there and the Excel and the PDF leave the
 * same cell empty, so the screen and its files never disagree on a «0.00» nobody paid.
 */
export const moneyOf = (
  row: Pick<FleetLicenseExpenseDto, 'date' | 'renewal' | 'extension' | 'signatures'>,
  column: 'visa' | 'cash' | 'total',
): number | null => {
  const lines = memosOf(row)
    .flatMap((memo) => memo.items)
    .filter((item) => column === 'total' || item.paidBy === column);
  return lines.length === 0 ? null : sumOf(lines);
};
/** The three money columns, in the table's order — the files' last three. */
const MONEY_COLUMNS = ['visa', 'cash', 'total'] as const;

export const LicenseExpensesPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const signatories = useReportSignatories();
  const [statsOpen, setStatsOpen] = useState(false);
  // One file at a time; the pressed one spins while the rows are gathered.
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  // «عاوز من الاجرات عين اعمل معينه»: the record's memos, read before they are printed.
  const [viewing, setViewing] = useState<FleetLicenseExpenseDto | null>(null);
  const [deleting, setDeleting] = useState<FleetLicenseExpenseDto | null>(null);
  const remove = useDeleteLicenseExpense();
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t('fleet.licenseExpenses.deletedToast'));
      setDeleting(null);
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const print = (row: FleetLicenseExpenseDto): void => {
    try {
      printMemos(memosOf(row));
    } catch {
      toast.error(t('fleet.vehicles.print.failed'));
    }
  };

  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const codesParam = sp.get('vehicleCodes');
  const vehicleCodes = useMemo(() => csv(codesParam), [codesParam]);
  const kind = sp.get('kind') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const sortParam = sp.get('sort');
  const sorts = useMemo(() => readSorts(sortParam, DEFAULT_SORT), [sortParam]);
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
  const hasActiveFilters = from !== '' || to !== '' || vehicleCodes.length > 0 || kind !== '';

  // The filters alone — the table's, the figures' and the files' question is one question.
  const filters = useMemo(
    () => ({
      ...(from === '' ? {} : { from }),
      ...(to === '' ? {} : { to }),
      ...(vehicleCodes.length === 0 ? {} : { vehicleCodes }),
      ...(kind === '' ? {} : { kind }),
    }),
    [from, to, vehicleCodes, kind],
  );
  const params = useMemo(
    () => ({ page, pageSize, ...filters, ...sortQuery(sorts) }),
    [page, pageSize, filters, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useLicenseExpenses(params);
  // «الإحصائيات» over every memo the filters match — the server's sums, never this page's.
  const summary = useLicenseExpenseSummary(filters);
  const rows = data?.items ?? [];

  const kindsText = (row: FleetLicenseExpenseDto): string =>
    memosOf(row)
      .map((memo) => t(`fleet.licenseExpenses.kinds.${memo.kind}`))
      .join(' + ');
  /**
   * «1,037.10» and «ج.م.» apart — the figure in the boards' monospace, the currency a size under;
   * nothing paid that way, the grey dash.
   */
  const moneyCell = (value: number | null): JSX.Element => {
    if (value === null) return DASH;
    const { figure, currency } = formatMoneyParts(value, 'EGP', locale);
    return (
      <span className="inline-flex items-baseline gap-1">
        <span className={FIGURE}>{figure}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400">{currency}</span>
      </span>
    );
  };

  // «تحسين شكل البيانات»: the drivers board's table — every value and header CENTRED, the date year
  // first with slashes, every figure in Latin digits with a comma, money with «ج.م.» beside it, the
  // car's code bold, an empty cell a grey dash. The row's actions stay at its end.
  const columns: Column<FleetLicenseExpenseDto>[] = [
    {
      key: 'date',
      align: 'center',
      header: t('fleet.licenseExpenses.date'),
      sortable: true,
      render: (row) => (
        <span dir="ltr" className={FIGURE}>
          {ymd(row.date)}
        </span>
      ),
    },
    {
      key: 'kind',
      align: 'center',
      header: t('fleet.licenseExpenses.kind'),
      // Renewal, then both, then extension — the pills as they read, computed by the server.
      sortable: true,
      sortKey: 'kindOrder',
      render: (row) => (
        <span className="inline-flex items-center gap-1">
          {memosOf(row).map((memo) => (
            <span
              key={memo.kind}
              className={cn(
                KIND_PILL,
                memo.kind === 'renewal'
                  ? 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
                  : 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
              )}
            >
              <i
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  memo.kind === 'renewal' ? 'bg-sky-400' : 'bg-violet-400',
                )}
              />
              {t(`fleet.licenseExpenses.kinds.${memo.kind}`)}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: 'cars',
      align: 'center',
      header: t('fleet.licenseExpenses.columns.cars'),
      sortable: true,
      sortKey: 'carsCount',
      // «وحسن شكله»: how many, then each registry code as a chip in a wrapping row — no plate at
      // all. A car typed by hand with no code is only counted, muted, after the chips. The cell's
      // title says the same in words, for a reader who hovers.
      render: (row) => {
        const { codes, unregistered } = carCodesOf(row);
        const count = codes.length + unregistered;
        if (count === 0) return DASH;
        const typedCount = t('fleet.licenseExpenses.unregisteredCount', {
          count: LATIN.format(unregistered),
        });
        return (
          <span
            className="inline-flex items-start justify-center gap-2"
            title={[...codes, ...(unregistered === 0 ? [] : [typedCount])].join('، ')}
            data-license-expense-cars={row.id}
          >
            {/* Every car the memo names, the hand-typed ones too — what the arrow orders by. */}
            <span
              dir="ltr"
              data-license-expense-cars-count={row.id}
              className={cn(COUNT_BADGE, FIGURE)}
            >
              {LATIN.format(count)}
            </span>
            {/* At least the badge's height, so a lone «غير مسجلة» sits level with the figure. */}
            <span className="flex min-h-6 max-w-[17rem] flex-wrap items-center justify-center gap-1">
              {codes.map((code, index) => (
                <span
                  key={`${index}:${code}`}
                  dir="ltr"
                  data-license-expense-car-code={code}
                  className={cn(CODE_CHIP, FIGURE)}
                >
                  {code}
                </span>
              ))}
              {unregistered > 0 && (
                <span
                  data-license-expense-unregistered={row.id}
                  className="whitespace-nowrap text-xs text-slate-500 dark:text-slate-400"
                >
                  {codes.length === 0
                    ? t('fleet.licenseExpenses.unregistered')
                    : t('fleet.licenseExpenses.unregisteredMore', {
                        count: LATIN.format(unregistered),
                      })}
                </span>
              )}
            </span>
          </span>
        );
      },
    },
    {
      key: 'visa',
      align: 'center',
      header: t('fleet.licenseExpenses.totals.visa'),
      sortable: true,
      sortKey: 'visaTotal',
      render: (row) => moneyCell(moneyOf(row, 'visa')),
    },
    {
      key: 'cash',
      align: 'center',
      header: t('fleet.licenseExpenses.totals.cash'),
      sortable: true,
      sortKey: 'cashTotal',
      render: (row) => moneyCell(moneyOf(row, 'cash')),
    },
    {
      key: 'total',
      align: 'center',
      header: t('fleet.licenseExpenses.totals.all'),
      sortable: true,
      // The table is bold throughout; the grand total stands out by its colour alone.
      render: (row) => (
        <span className="text-slate-900 dark:text-white">{moneyCell(moneyOf(row, 'total'))}</span>
      ),
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (row) => (
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            data-license-expense-view={row.id}
            title={t('fleet.licenseExpenses.view')}
            aria-label={t('fleet.licenseExpenses.view')}
            onClick={() => setViewing(row)}
            className={actionButton}
          >
            <BoardIcon d={PATH.eye} className="h-4 w-4" />
          </button>
          {can('fleetLicenseExpense.edit') && (
            <Link
              to={`/fleet/license-expenses/${row.id}`}
              data-license-expense-edit={row.id}
              title={t('common.edit')}
              aria-label={t('common.edit')}
              className={actionButton}
            >
              <BoardIcon d={PATH.edit} className="h-4 w-4" />
            </Link>
          )}
          <button
            type="button"
            data-license-expense-print={row.id}
            title={t('fleet.licenseExpenses.print')}
            aria-label={t('fleet.licenseExpenses.print')}
            onClick={() => print(row)}
            className={actionButton}
          >
            <BoardIcon d={PATH.pdf} className="h-4 w-4" />
          </button>
          {can('fleetLicenseExpense.delete') && (
            <button
              type="button"
              data-license-expense-delete={row.id}
              title={t('common.delete')}
              aria-label={t('common.delete')}
              onClick={() => setDeleting(row)}
              className={cn(actionButton, 'hover:text-red-600 dark:hover:text-red-400')}
            >
              <BoardIcon d={PATH.trash} className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  // «اكسلات هتاخد اللى الفلتر عامله بس»: every memo the filters match, in the table's order.
  const header = [
    t('fleet.licenseExpenses.date'),
    t('fleet.licenseExpenses.kind'),
    t('fleet.licenseExpenses.columns.carsCount'),
    t('fleet.licenseExpenses.columns.cars'),
    t('fleet.licenseExpenses.totals.visa'),
    t('fleet.licenseExpenses.totals.cash'),
    t('fleet.licenseExpenses.totals.all'),
  ];
  const allRows = () =>
    fetchFilteredRows((pageNo, size) =>
      fleetApi.listLicenseExpenses({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );
  const writeSheet = async (): Promise<void> => {
    const all = await allRows();
    saveSheet({
      name: t('fleet.licenseExpenses.title'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: all.map((row) => [
        formatDate(row.date, locale),
        kindsText(row),
        carsOf(row).length,
        carsOf(row).map(carName).join('، '),
        // A blank where the table draws its dash (`moneyOf`), as the dealership sheet leaves one.
        ...MONEY_COLUMNS.map((column) => moneyOf(row, column) ?? ''),
      ]),
      moneyColumns: [4, 5, 6],
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
    const figures = summary.data;
    try {
      printFleetReport({
        title: t('fleet.licenseExpenses.title'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header,
        rows: all.map((row) => [
          formatDate(row.date, locale),
          kindsText(row),
          String(carsOf(row).length),
          carsOf(row).map(carName).join('، ') || '—',
          // The table's dash where nothing was paid that way — never a «0.00».
          ...MONEY_COLUMNS.map((column) => {
            const value = moneyOf(row, column);
            return value === null ? '—' : reportMoney(value);
          }),
        ]),
        totals:
          figures === undefined
            ? []
            : [
                {
                  label: t('fleet.licenseExpenses.totals.visa'),
                  value: reportMoney(figures.visaTotal),
                },
                {
                  label: t('fleet.licenseExpenses.totals.cash'),
                  value: reportMoney(figures.cashTotal),
                },
                {
                  label: t('fleet.licenseExpenses.totals.all'),
                  value: reportMoney(figures.visaTotal + figures.cashTotal),
                },
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

  const figures = summary.data;
  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        {/* «زى شاشة السيارات و السواقيين»: no page title — the board opens on its toolbar. */}
        <div
          className="flex items-center justify-between gap-2"
          data-license-expenses-toolbar="true"
        >
          {/* How many memos the filters matched, over the whole set — nothing while the answer is
              on its way. */}
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {data === undefined
              ? ''
              : t('fleet.licenseExpenses.count', {
                  count: formatNumber(data.meta.totalItems, locale),
                })}
          </span>
          {/* Wraps: five buttons are wider than a phone. */}
          <span className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            <button
              type="button"
              data-license-expense-stats-toggle="true"
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
            {/* Not offered when the list failed: the file behind it would be empty or short. */}
            {!isError && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80">
                <button
                  type="button"
                  data-export="license-expenses"
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
                  data-print="license-expenses"
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
            {/* «زى شاشه الاخطارات»: the templates and names every new memo starts with. */}
            {can('fleetLicenseExpense.edit') && (
              <Link
                to="/fleet/license-expenses/setup"
                data-license-expense-setup="true"
                className={BRAND_BUTTON}
              >
                <CogIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                {t('fleet.licenseExpenses.setup.button')}
              </Link>
            )}
            {can('fleetLicenseExpense.create') && (
              <Link
                to="/fleet/license-expenses/new"
                data-license-expense-new="true"
                title={t('fleet.licenseExpenses.newMemo')}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                <span className="sm:hidden">{t('fleet.vehicles.board.addShort')}</span>
                <span className="hidden sm:inline">{t('fleet.licenseExpenses.newMemo')}</span>
              </Link>
            )}
          </span>
        </div>

        {/* The vehicles board's dark bar: every filter's name written in its box, an icon at its
            start, one row on a computer. */}
        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={hasActiveFilters}
            onClear={() => patch({ from: null, to: null, vehicleCodes: null, kind: null })}
          >
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
            <FilterWithIcon icon={FILTER_ICON.licence} tone="text-violet-600 dark:text-violet-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.licenseExpenses.kind')}
                options={[
                  { value: 'renewal', label: t('fleet.licenseExpenses.kinds.renewal') },
                  { value: 'extension', label: t('fleet.licenseExpenses.kinds.extension') },
                ]}
                value={kind === '' ? [] : [kind]}
                onChange={(next) => patch({ kind: pickOne(kind === '' ? [] : [kind], next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {/* «الاجماليات تكون بين الجدول والفلاتر» — behind «الإحصائيات», as on the money boards. */}
        {statsOpen && figures !== undefined && (
          <section
            data-license-expense-figures="true"
            className="grid shrink-0 animate-drop-in grid-cols-2 gap-3 lg:grid-cols-5"
          >
            <FigureChip
              icon={PATH.card}
              iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              label={t('fleet.licenseExpenses.stats.memos')}
              value={LATIN.format(figures.count)}
              unit={t('fleet.licenseExpenses.stats.memoUnit')}
            />
            <FigureChip
              icon={PATH.truck}
              iconClass="bg-slate-500/10 text-slate-600 dark:text-slate-300"
              label={t('fleet.licenseExpenses.stats.cars')}
              value={LATIN.format(figures.cars)}
              unit={t('fleet.vehicles.board.totalUnit')}
            />
            {/* A sum of money takes the whole row on a phone, so «ج.م.» stays on the tile. */}
            <div className="col-span-2 sm:col-span-1">
              <FigureChip
                icon={PATH.card}
                iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-300"
                label={t('fleet.licenseExpenses.totals.visa')}
                {...moneyChip(figures.visaTotal, locale)}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <FigureChip
                icon={PATH.trend}
                iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                label={t('fleet.licenseExpenses.totals.cash')}
                {...moneyChip(figures.cashTotal, locale)}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <FigureChip
                icon={PATH.box}
                iconClass="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                label={t('fleet.licenseExpenses.totals.all')}
                {...moneyChip(
                  Math.round((figures.visaTotal + figures.cashTotal) * 100) / 100,
                  locale,
                )}
              />
            </div>
          </section>
        )}

        <div className={LICENSE_TABLE}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            sort={sorts}
            onSortChange={changeSort}
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

      <Dialog
        open={viewing !== null}
        onClose={() => setViewing(null)}
        size="xl"
        title={t('fleet.licenseExpenses.view')}
        description={viewing === null ? '' : memosOf(viewing).map(memoTitle).join(' — ')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setViewing(null)}>
              {t('common.close')}
            </Button>
            <Button onClick={() => viewing !== null && print(viewing)}>
              {t('fleet.licenseExpenses.print')}
            </Button>
          </>
        }
      >
        <div className="max-h-[70vh] space-y-4 overflow-auto rounded-lg bg-slate-200 p-3 dark:bg-slate-800">
          {viewing !== null &&
            memosOf(viewing).map((memo) => (
              <div
                key={memo.kind}
                className="mx-auto w-[640px] max-w-full overflow-hidden rounded shadow-xl"
              >
                <div
                  data-license-expense-view-sheet={memo.kind}
                  className="origin-top-right"
                  style={{ zoom: 0.8, width: '210mm' }}
                  dangerouslySetInnerHTML={{ __html: memoHtml(memo) }}
                />
              </div>
            ))}
        </div>
      </Dialog>

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.licenseExpenses.deleteTitle')}
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
          {deleting === null ? '' : memosOf(deleting).map(memoTitle).join(' — ')}
        </p>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          {t('fleet.licenseExpenses.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
