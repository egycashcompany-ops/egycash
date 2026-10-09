// خصم الإيصالات — the papers the driver brings back: fuel off the car's card or out of the custody
// fund, tyres and washing out of the fund. Entry is a modal («الادخال يكون فى مودال»).
//
// «حسن الui زى شاشة السيارات و السواقيين»: no page title — a toolbar with the count, the
// «الإحصائيات» toggle, the Excel / PDF pill and «إيصال جديد»; the dark filter bar; the boards'
// table. The totals sit BETWEEN the filters and the table, as asked, behind «الإحصائيات».
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_RECEIPT_KINDS,
  type FleetReceiptDto,
  type FleetReceiptTotalsDto,
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
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Spinner } from '../../../shared/ui/Spinner';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate, formatMoney, formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { errorMessage } from '../../../shared/lib/errors';
import { cn } from '../../../shared/lib/cn';
import * as fleetApi from '../api/fleet-api';
import { useDeleteReceipt, useReceiptSummary, useReceipts } from '../api/fleet-queries';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FigureChip } from '../components/FleetFigures';
import { BoardIcon, PATH } from '../components/FuelCardBoard';
import { DARK_TABLE } from './VehiclesListPage';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DriverName } from '../components/EmployeeName';
import { FuelCompanyLogo } from '../components/FuelCardTiles';
import { ReceiptDialog } from '../components/ReceiptDialog';
import { ReceiptImageCell, ReceiptImagePreviewDialog } from '../components/ReceiptImageCell';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';

const REMEMBERED_FILTERS = [
  'from',
  'to',
  'vehicleCodes',
  'kind',
  'source',
  'driver',
  'size',
  'sort',
] as const;
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_SORT = 'date:desc';
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');
const one = (value: string): string[] => (value === '' ? [] : [value]);
/** Litres, two decimals, Latin digits — beside the money, which prints the same way. */
const litresText = (value: number): string => value.toFixed(2);
const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

/** Every filter is `density="tight"`, as on the vehicles board. */
const TIGHT = 'tight' as const;

/** The board's toolbar buttons, from the vehicles screen. */
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
const PILL_BUTTON =
  'inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold text-slate-800 transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs dark:text-slate-200';
const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';

/** The vehicles board's table, as the drivers board wears it — no column lines, Cairo bold. */
const RECEIPTS_TABLE = cn(
  DARK_TABLE,
  BOARD_TABLE_FILL,
  // «شيل الخطوط اللى بين العواميد»: no line between the columns.
  '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
  // «خلى الكلام bold»: every value heavy, the Arabic in Cairo's own bold.
  "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
);

/** «الكارت وطنية •••• 2231» or «العهدة». */
export const ReceiptSourceCell = ({ row }: { row: FleetReceiptDto }): JSX.Element => {
  const t = useT();
  if (row.source === 'card' && row.cardCompany !== null) {
    return (
      <span className="inline-flex items-center gap-2">
        <FuelCompanyLogo company={row.cardCompany} size="sm" />
        <span className="tabular-nums" dir="ltr">
          •••• {(row.cardNumber ?? '').replace(/\s+/g, '').slice(-4)}
        </span>
      </span>
    );
  }
  // A source, not a state: the boards keep green, amber and red for states.
  return <Badge tone="neutral">{t('fleet.receipts.source.custody')}</Badge>;
};

/**
 * The four sums behind «الإحصائيات» — the server's, over the whole filtered set, never the page:
 * the fund, the cards, fuel with its litres, tyres and washing together.
 */
export const ReceiptFigures = ({ totals }: { totals: FleetReceiptTotalsDto }): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const money = (value: number): string => formatMoney(value, 'EGP', locale);
  return (
    <section
      data-receipt-figures="true"
      className="grid shrink-0 animate-drop-in grid-cols-2 gap-3 lg:grid-cols-4"
    >
      {/* A sum of money takes the whole row on a phone, so «ج.م.» stays on the tile. */}
      <div className="col-span-2 sm:col-span-1">
        <FigureChip
          icon={PATH.box}
          iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
          label={t('fleet.receipts.totals.custody')}
          value={money(totals.custodyTotal)}
          unit=""
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <FigureChip
          icon={PATH.card}
          iconClass="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
          label={t('fleet.receipts.totals.card')}
          value={money(totals.cardTotal)}
          unit=""
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <FigureChip
          icon={FILTER_ICON.charge}
          iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          label={t('fleet.receipts.totals.fuel')}
          value={money(totals.fuelTotal)}
          unit=""
          note={t('fleet.receipts.fields.litres', { litres: litresText(totals.fuelLitres) })}
        />
      </div>
      <div className="col-span-2 sm:col-span-1">
        <FigureChip
          icon={FILTER_ICON.motor}
          iconClass="bg-slate-500/10 text-slate-600 dark:text-slate-300"
          label={t('fleet.receipts.totals.tyresWash')}
          value={money(totals.tyresTotal + totals.washTotal)}
          unit=""
        />
      </div>
    </section>
  );
};

export const ReceiptsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const signatories = useReportSignatories();

  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const vehicleCodes = csv(sp.get('vehicleCodes'));
  const kinds = csv(sp.get('kind'));
  const source = sp.get('source') ?? '';
  const driver = sp.get('driver') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
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
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };
  const hasActiveFilters =
    from !== '' ||
    to !== '' ||
    vehicleCodes.length > 0 ||
    kinds.length > 0 ||
    source !== '' ||
    driver !== '';

  const filters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      kind: kinds.length > 0 ? kinds : undefined,
      source: source || undefined,
      driver: driver || undefined,
    }),
    [paramsKey],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, ...sortQuery(sorts) }),
    [filters, page, pageSize, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useReceipts(params);
  const summary = useReceiptSummary(filters);
  const rows = data?.items ?? [];

  const [editing, setEditing] = useState<FleetReceiptDto | null>(null);
  const [adding, setAdding] = useState(false);
  const [previewing, setPreviewing] = useState<FleetReceiptDto | null>(null);
  const [deleting, setDeleting] = useState<FleetReceiptDto | null>(null);
  // One file at a time; the pressed one spins while the rows are gathered.
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  // The totals open from the toolbar, closed on the way in.
  const [statsOpen, setStatsOpen] = useState(false);
  const remove = useDeleteReceipt();
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.receipts.deleted'));
    setDeleting(null);
  };

  const money = (value: number): string => formatMoney(value, 'EGP', locale);
  const kindLabel = (row: FleetReceiptDto): string => t(`fleet.receipts.kind.${row.kind}`);
  const fuelLabel = (row: FleetReceiptDto): string =>
    row.fuelType === null ? '' : t(`fleet.receipts.fuelType.${row.fuelType}`);
  const sourceLabel = (row: FleetReceiptDto): string =>
    row.source === 'card'
      ? `${t(`fleet.fuelCards.company.${row.cardCompany ?? 'wataniya'}`)} ${row.cardNumber ?? ''}`
      : t('fleet.receipts.source.custody');
  const dash = <span className="text-slate-400">—</span>;

  const columns: Column<FleetReceiptDto>[] = [
    {
      key: 'date',
      header: t('fleet.receipts.columns.date'),
      sortable: true,
      render: (row) => <span className="tabular-nums">{formatDate(row.date, locale)}</span>,
    },
    {
      key: 'vehicleCode',
      header: t('fleet.odometer.columns.vehicle'),
      sortable: true,
      render: (row) => row.vehicleCode ?? dash,
    },
    {
      key: 'driverName',
      header: t('fleet.receipts.columns.driver'),
      sortable: true,
      render: (row) => <DriverName employeeId={row.driverEmployeeId} name={row.driverName} />,
    },
    {
      key: 'kind',
      header: t('fleet.receipts.columns.kind'),
      sortable: true,
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <Badge tone={row.kind === 'fuel' ? 'info' : 'neutral'}>{kindLabel(row)}</Badge>
          {row.fuelType !== null && <span className="text-sm">{fuelLabel(row)}</span>}
        </span>
      ),
    },
    {
      key: 'source',
      header: t('fleet.receipts.columns.source'),
      sortable: true,
      render: (row) => <ReceiptSourceCell row={row} />,
    },
    {
      key: 'amount',
      header: t('fleet.receipts.columns.amount'),
      sortable: true,
      align: 'end',
      render: (row) => <span className="tabular-nums">{money(row.amount)}</span>,
    },
    {
      key: 'litres',
      header: t('fleet.receipts.columns.litres'),
      sortable: true,
      align: 'end',
      render: (row) =>
        row.litres === null ? dash : <span className="tabular-nums">{litresText(row.litres)}</span>,
    },
    {
      key: 'image',
      header: t('fleet.receipts.columns.image'),
      render: (row) => <ReceiptImageCell row={row} onPreview={setPreviewing} />,
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (row) => (
        <span className="flex items-center justify-end gap-1">
          {can('fleetReceipt.edit') && (
            <button
              type="button"
              data-receipt-edit={row.id}
              className={actionButton}
              aria-label={t('fleet.receipts.edit')}
              title={t('fleet.receipts.edit')}
              onClick={() => setEditing(row)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetReceipt.delete') && (
            <button
              type="button"
              data-receipt-delete={row.id}
              className={actionButton}
              aria-label={t('common.delete')}
              title={t('common.delete')}
              onClick={() => setDeleting(row)}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  const header = [
    t('fleet.receipts.columns.date'),
    t('fleet.odometer.columns.vehicle'),
    t('fleet.receipts.columns.driver'),
    t('fleet.receipts.columns.kind'),
    t('fleet.receipts.columns.source'),
    t('fleet.receipts.columns.amount'),
    t('fleet.receipts.columns.litres'),
  ];
  const allRows = () =>
    fetchFilteredRows((pageNo, size) =>
      fleetApi.listReceipts({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );
  const writeSheet = async (): Promise<void> => {
    const all = await allRows();
    saveSheet({
      name: t('fleet.nav.receipts'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: all.map((row) => [
        formatDate(row.date, locale),
        row.vehicleCode ?? '',
        row.driverName ?? '',
        `${kindLabel(row)} ${fuelLabel(row)}`.trim(),
        sourceLabel(row),
        row.amount,
        row.litres ?? '',
      ]),
      moneyColumns: [5],
    });
  };
  const exportSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('excel');
    try {
      await writeSheet();
    } catch (error) {
      // NAMED, not swallowed — as the Excel button always said it.
      toast.error(errorMessage(error, locale));
    } finally {
      setExporting(null);
    }
  };
  const printSheet = async (): Promise<void> => {
    const all = await allRows();
    try {
      printFleetReport({
        title: t('fleet.nav.receipts'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header,
        rows: all.map((row) => [
          formatDate(row.date, locale),
          row.vehicleCode ?? '—',
          row.driverName ?? '—',
          `${kindLabel(row)} ${fuelLabel(row)}`.trim(),
          sourceLabel(row),
          reportMoney(row.amount),
          row.litres === null ? '—' : litresText(row.litres),
        ]),
        totals:
          summary.data === undefined
            ? []
            : [
                {
                  label: t('fleet.receipts.totals.custody'),
                  value: reportMoney(summary.data.custodyTotal),
                },
                {
                  label: t('fleet.receipts.totals.card'),
                  value: reportMoney(summary.data.cardTotal),
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
    } finally {
      setExporting(null);
    }
  };
  // «من» / «إلى» written in the box while it is empty: the date's own digits hidden and the word
  // laid over them, gone the moment the box is focused.
  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => (
    <FilterWithIcon
      icon={FILTER_ICON.calendar}
      tone="text-cyan-600 dark:text-cyan-400"
      className="w-36 shrink-0"
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
        <div className="flex items-center justify-between gap-2" data-receipts-toolbar="true">
          {/* How many receipts the filters matched, over the whole set — nothing while the answer
              is on its way. */}
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
          <span className="flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              data-receipt-stats-toggle="true"
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
                  data-export="receipts"
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
                  data-print="receipts"
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
            {can('fleetReceipt.create') && (
              <button
                type="button"
                data-receipt-new="true"
                onClick={() => setAdding(true)}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t('fleet.receipts.new')}
              </button>
            )}
          </span>
        </div>

        {/* The vehicles board's dark bar: every filter's name written in its box, an icon at its
            start, one row on a computer. */}
        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={hasActiveFilters}
            onClear={() =>
              patch({
                from: null,
                to: null,
                vehicleCodes: null,
                kind: null,
                source: null,
                driver: null,
              })
            }
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
            {/* «اى حاله فيها اكتر من 3 اخيار اقدر اعمل مالتى سلكت» — three kinds, so several at once. */}
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.receipts.columns.kind')}
                options={FLEET_RECEIPT_KINDS.map((value) => ({
                  value,
                  label: t(`fleet.receipts.kind.${value}`),
                }))}
                value={kinds}
                onChange={(next) => patch({ kind: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
            {/* The card or the fund — ONE answer: ticking one replaces the other, and clearing it
                is «all», as the boards' two-answer filters read. */}
            <FilterWithIcon icon={FILTER_ICON.card} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.receipts.columns.source')}
                options={[
                  { value: 'card', label: t('fleet.receipts.source.card') },
                  { value: 'custody', label: t('fleet.receipts.source.custody') },
                ]}
                value={one(source)}
                onChange={(next) => patch({ source: pickOne(one(source), next) })}
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

        {/* «الاجماليات تكون بين الجدول والفلاتر» — behind «الإحصائيات», as on the boards. */}
        {statsOpen && summary.data !== undefined && <ReceiptFigures totals={summary.data} />}

        <div className={RECEIPTS_TABLE}>
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

      <ReceiptDialog
        open={adding || editing !== null}
        onClose={() => {
          setAdding(false);
          setEditing(null);
        }}
        row={editing}
      />
      <ReceiptImagePreviewDialog
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        row={previewing}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.receipts.deleteTitle')}
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
          {t('fleet.receipts.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
