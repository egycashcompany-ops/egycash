// التوكيل — every workshop exit's bill. «العربيه اللى بتخرج من الصيانه بتظهر فى الشاشه دى بس الصف
// بيكون باللون الاصفر»: a row the workshop opened waits, yellow, until its invoice is recorded.
//
// «يبقى زى شاشات الاخطارات و بطاقات الوقود وشحن الكروت»: no page title, a bar with the count, the
// «الإحصائيات» toggle and the Excel / PDF pill, the dark filter bar, the boards' table. The totals
// sit BETWEEN the filters and the table, as asked, and are the server's, over the whole filtered
// set, never the page.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetDealershipInvoiceDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
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
import { cn } from '../../../shared/lib/cn';
import * as fleetApi from '../api/fleet-api';
import {
  useDealershipInvoices,
  useDealershipSummary,
  useDeleteDealershipInvoice,
} from '../api/fleet-queries';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FigureChip } from '../components/FleetFigures';
import { BoardIcon, PATH } from '../components/FuelCardBoard';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DealershipInvoiceDialog } from '../components/DealershipInvoiceDialog';
import {
  DealershipImageCell,
  DealershipImagePreviewDialog,
} from '../components/DealershipImageCell';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';

/** Remembered across visits: the filters and the view preferences. `page` is derived, never kept. */
const REMEMBERED_FILTERS = [
  'from',
  'to',
  'vehicleCodes',
  'side',
  'state',
  'work',
  'size',
  'sort',
] as const;
const DEFAULT_PAGE_SIZE = 25;
const DEFAULT_SORT = 'outDate:desc';
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');
const one = (value: string): string[] => (value === '' ? [] : [value]);

/** The boards' table — «زى شاشات الاخطارات». */
const BOARD_TABLE = cn(
  '[&>div]:!rounded-2xl [&>div]:!border-slate-200 dark:[&>div]:!border-slate-800 [&>div]:!bg-white dark:[&>div]:!bg-[#111827]',
  '[&_thead_tr]:!bg-slate-100 dark:[&_thead_tr]:!bg-[#0c121e] [&_thead_th]:!text-slate-500 dark:[&_thead_th]:!text-slate-400',
  '[&_tbody_tr]:!border-slate-200 dark:[&_tbody_tr]:!border-slate-800 [&_tbody_td]:!text-slate-800 dark:[&_tbody_td]:!text-slate-200',
  '[&_th]:!text-[13px] [&_th]:!font-bold [&_td]:!py-2.5 [&_td]:whitespace-nowrap [&_td]:!text-sm [&_td]:!font-semibold',
  // «حاجه قريبه من الشكل دا واللون دا»: the row waiting for its invoice in a warm amber wash,
  // with the «⚠ بانتظار الفاتورة» tag beside its car.
  '[&_tbody_tr[data-pending=true]]:!bg-amber-50 dark:[&_tbody_tr[data-pending=true]]:!bg-[#241d17] [&_tbody_tr[data-pending=true]:hover]:!bg-amber-100 dark:[&_tbody_tr[data-pending=true]:hover]:!bg-[#2c2319]',
);
/** The work's tag: a dot and a word, each kind its own colour. */
const WORK_TAG: Record<'maintenance' | 'repair' | 'other', string> = {
  maintenance: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300 [&>i]:bg-sky-400',
  repair:
    'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 [&>i]:bg-amber-400',
  other:
    'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300 [&>i]:bg-violet-400',
};
/** `2026-10-05…` → `2026/10/05`, the way the Fleet boards write a day. */
const day = (iso: string): string => iso.slice(0, 10).replace(/-/gu, '/');
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';

export const DealershipPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const signatories = useReportSignatories();

  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const vehicleCodes = csv(sp.get('vehicleCodes'));
  const side = sp.get('side') ?? '';
  const state = sp.get('state') ?? '';
  const work = sp.get('work') ?? '';
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
    side !== '' ||
    state !== '' ||
    work !== '';

  /** What the reader is looking at — the filters alone, which is also what the totals are asked for. */
  const filters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      side: side || undefined,
      pending: state === '' ? undefined : state === 'pending',
      workKind: work || undefined,
    }),
    [paramsKey],
  );
  const params = useMemo(
    () => ({ ...filters, page, pageSize, ...sortQuery(sorts) }),
    [filters, page, pageSize, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useDealershipInvoices(params);
  const summary = useDealershipSummary(filters);
  const rows = data?.items ?? [];

  const [recording, setRecording] = useState<FleetDealershipInvoiceDto | null>(null);
  const [previewing, setPreviewing] = useState<FleetDealershipInvoiceDto | null>(null);
  const [deleting, setDeleting] = useState<FleetDealershipInvoiceDto | null>(null);
  const remove = useDeleteDealershipInvoice();
  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    await remove.mutateAsync(deleting.id);
    toast.success(t('fleet.dealership.deleted'));
    setDeleting(null);
  };

  const money = (value: number | null): string =>
    value === null ? '—' : formatMoney(value, 'EGP', locale);
  const sideLabel = (row: FleetDealershipInvoiceDto): string =>
    row.side === null ? '' : t(`fleet.dealership.side.${row.side}`);
  const dash = <span className="text-slate-400">—</span>;

  const actionButton =
    'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

  const columns: Column<FleetDealershipInvoiceDto>[] = [
    {
      key: 'outDate',
      header: t('fleet.dealership.columns.outDate'),
      sortable: true,
      render: (row) => <span className="font-bold tabular-nums">{day(row.outDate)}</span>,
    },
    {
      key: 'vehicleCode',
      header: t('fleet.odometer.columns.vehicle'),
      sortable: true,
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {row.vehicleCode ?? dash}
          {row.pending && (
            <span
              data-dealership-waiting="true"
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300"
            >
              <BoardIcon d={PATH.warn} className="h-3 w-3" width={2.5} />
              {t('fleet.dealership.pending')}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'workTypeLabel',
      header: t('fleet.dealership.columns.workType'),
      sortable: true,
      render: (row) => (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold',
            WORK_TAG[
              row.workKind === 'maintenance'
                ? 'maintenance'
                : // A repair with its trade named — «إصلاح (كهرباء)» — takes its own colour.
                  row.workTypeLabel.includes('(')
                  ? 'other'
                  : 'repair'
            ],
          )}
        >
          <i className="h-1.5 w-1.5 rounded-full" />
          {row.workTypeLabel}
        </span>
      ),
    },
    {
      key: 'invoiceNumber',
      header: t('fleet.dealership.columns.invoiceNumber'),
      sortable: true,
      render: (row) =>
        row.invoiceNumber === null ? (
          dash
        ) : (
          <span className="tabular-nums">{row.invoiceNumber}</span>
        ),
    },
    {
      key: 'invoiceAmount',
      header: t('fleet.dealership.columns.invoiceAmount'),
      sortable: true,
      align: 'end',
      render: (row) =>
        row.invoiceAmount === null ? (
          dash
        ) : (
          <span className="tabular-nums">{money(row.invoiceAmount)}</span>
        ),
    },
    {
      key: 'insurer',
      header: t('fleet.vehicles.fields.insuranceCompany'),
      render: (row) => row.insuranceCompanyName ?? t('fleet.dealership.noInsurer'),
    },
    {
      key: 'side',
      header: t('fleet.dealership.columns.side'),
      render: (row) =>
        row.side === null ? (
          dash
        ) : (
          <Badge tone={row.side === 'custody' ? 'warning' : 'info'}>{sideLabel(row)}</Badge>
        ),
    },
    {
      key: 'image',
      header: t('fleet.dealership.columns.image'),
      render: (row) => <DealershipImageCell row={row} onPreview={setPreviewing} />,
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (row) => (
        <span className="inline-flex items-center gap-1">
          {can('fleetDealership.edit') && row.pending && (
            <button
              type="button"
              data-dealership-record={row.id}
              onClick={() => setRecording(row)}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-3 py-1.5 text-xs font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 active:scale-95"
            >
              <BoardIcon d={PATH.plus} className="h-3 w-3" width={3} />
              {t('fleet.dealership.record')}
            </button>
          )}
          {can('fleetDealership.edit') && !row.pending && (
            <button
              type="button"
              className={actionButton}
              aria-label={t('fleet.dealership.edit')}
              title={t('fleet.dealership.edit')}
              onClick={() => setRecording(row)}
            >
              <EditIcon className="h-4 w-4" />
            </button>
          )}
          {can('fleetDealership.delete') && (
            <button
              type="button"
              data-dealership-delete={row.id}
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
    t('fleet.dealership.columns.outDate'),
    t('fleet.odometer.columns.vehicle'),
    t('fleet.dealership.columns.workType'),
    t('fleet.dealership.columns.invoiceNumber'),
    t('fleet.dealership.columns.invoiceAmount'),
    t('fleet.vehicles.fields.insuranceCompany'),
    t('fleet.dealership.columns.side'),
  ];
  const allRows = () =>
    fetchFilteredRows((pageNo, size) =>
      fleetApi.listDealershipInvoices({ ...filtersOnly(params), page: pageNo, pageSize: size }),
    );
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const exportSheet = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('excel');
    try {
      await saveAll();
    } finally {
      setExporting(null);
    }
  };
  const saveAll = async (): Promise<void> => {
    const all = await allRows();
    saveSheet({
      name: t('fleet.nav.dealership'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: all.map((row) => [
        formatDate(row.outDate, locale),
        row.vehicleCode ?? '',
        row.workTypeLabel,
        row.invoiceNumber ?? '',
        row.invoiceAmount ?? '',
        row.insuranceCompanyName ?? '',
        row.pending ? t('fleet.dealership.pending') : sideLabel(row),
      ]),
      moneyColumns: [4],
    });
  };
  const onPrint = async (): Promise<void> => {
    if (exporting !== null) return;
    setExporting('pdf');
    try {
      await printAll();
    } finally {
      setExporting(null);
    }
  };
  const printAll = async (): Promise<void> => {
    const all = await allRows();
    try {
      printFleetReport({
        title: t('fleet.nav.dealership'),
        department: t('fleet.violations.report.department'),
        subtitle: '',
        header,
        rows: all.map((row) => [
          formatDate(row.outDate, locale),
          row.vehicleCode ?? '—',
          row.workTypeLabel,
          row.invoiceNumber ?? '—',
          row.invoiceAmount === null ? '—' : reportMoney(row.invoiceAmount),
          row.insuranceCompanyName ?? '—',
          row.pending ? t('fleet.dealership.pending') : sideLabel(row),
        ]),
        totals:
          summary.data === undefined
            ? []
            : [
                {
                  label: t('fleet.dealership.totals.dealership'),
                  value: reportMoney(summary.data.dealershipTotal),
                },
                {
                  label: t('fleet.dealership.totals.custody'),
                  value: reportMoney(summary.data.custodyTotal),
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

  // «من» / «إلى» written in the box, as on the notices screen: empty, it is a text box showing the
  // word; pressed (or Enter / Space / ↓), it turns into the date box and opens its calendar.
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => {
    const asDate = value !== '' || editingDate === param;
    const openCalendar = (box: HTMLInputElement): void => {
      setEditingDate(param);
      requestAnimationFrame(() => {
        try {
          box.focus();
          box.showPicker();
        } catch {
          // A browser without the picker call opens it on the next press.
        }
      });
    };
    return (
      <FilterWithIcon icon={FILTER_ICON.calendar} tone="text-cyan-600 dark:text-cyan-400">
        <Input
          type={asDate ? 'date' : 'text'}
          {...(asDate ? { dir: 'ltr' } : {})}
          data-dealership-date-filter={param}
          aria-label={t(labelKey)}
          title={t(labelKey)}
          placeholder={t(labelKey)}
          value={value}
          readOnly={!asDate}
          onPointerDown={(e) => {
            if (!asDate) openCalendar(e.currentTarget);
          }}
          onKeyDown={(e) => {
            if (!asDate && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) {
              e.preventDefault();
              openCalendar(e.currentTarget);
            }
          }}
          onBlur={() => setEditingDate((prev) => (prev === param ? null : prev))}
          onChange={(e) => {
            if (e.currentTarget.type === 'date') patch({ [param]: e.target.value || null });
          }}
        />
      </FilterWithIcon>
    );
  };

  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2" data-dealership-toolbar="true">
          <span
            data-filtered-count
            className="text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {data === undefined
              ? ''
              : t('common.list.count', { count: formatNumber(data.meta.totalItems, locale) })}
          </span>
          <span className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              data-dealership-stats-toggle="true"
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
                className={cn('h-3.5 w-3.5 transition-transform', statsOpen && 'rotate-180')}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {!isError && (
              <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800/80">
                <button
                  type="button"
                  data-export="dealership"
                  disabled={exporting !== null}
                  onClick={() => void exportSheet()}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs text-slate-800 transition hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-emerald-950/60 dark:hover:text-emerald-300"
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
                  data-print="dealership"
                  disabled={exporting !== null}
                  onClick={() => void onPrint()}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-semibold sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-xs text-slate-800 transition hover:bg-red-50 hover:text-red-600 active:scale-95 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-red-950/40 dark:hover:text-red-400"
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

        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={hasActiveFilters}
            onClear={() =>
              patch({
                from: null,
                to: null,
                vehicleCodes: null,
                side: null,
                state: null,
                work: null,
              })
            }
          >
            {dateBound('fleet.dealership.filters.from', from, 'from')}
            {dateBound('fleet.dealership.filters.to', to, 'to')}
            <FilterWithIcon icon={FILTER_ICON.car} tone="text-emerald-600 dark:text-emerald-400">
              <VehicleCodeFilter
                fullWidth
                density="tight"
                value={vehicleCodes}
                onChange={(next) =>
                  patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
                }
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.company} tone="text-violet-600 dark:text-violet-300">
              <MultiSelect
                clearable
                fullWidth
                density="tight"
                showSelectedValues
                label={t('fleet.dealership.columns.side')}
                options={[
                  { value: 'dealership', label: t('fleet.dealership.side.dealership') },
                  { value: 'custody', label: t('fleet.dealership.side.custody') },
                ]}
                value={one(side)}
                onChange={(next) => patch({ side: pickOne(one(side), next) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.status} tone="text-emerald-600 dark:text-emerald-400">
              <MultiSelect
                clearable
                fullWidth
                density="tight"
                showSelectedValues
                label={t('fleet.dealership.filters.state')}
                options={[
                  { value: 'pending', label: t('fleet.dealership.pending') },
                  { value: 'recorded', label: t('fleet.dealership.recorded') },
                ]}
                value={one(state)}
                onChange={(next) => patch({ state: pickOne(one(state), next) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.charge} tone="text-amber-600 dark:text-amber-400">
              <MultiSelect
                clearable
                fullWidth
                density="tight"
                showSelectedValues
                label={t('fleet.dealership.columns.workType')}
                options={[
                  { value: 'maintenance', label: t('fleet.dealership.work.maintenance') },
                  { value: 'repair', label: t('fleet.dealership.work.repair') },
                ]}
                value={one(work)}
                onChange={(next) => patch({ work: pickOne(one(work), next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {/* «الاجماليات تكون بين الجدول والفلاتر» — behind «الإحصائيات», as on the notices screen. */}
        {statsOpen && summary.data !== undefined && (
          <section
            data-dealership-figures="true"
            className="animate-drop-in grid grid-cols-2 gap-3 lg:grid-cols-4"
          >
            {/* A sum of money takes the whole row on a phone, so «ج.م.» stays on the tile. */}
            <div className="col-span-2 sm:col-span-1">
              <FigureChip
                icon={PATH.card}
                iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
                label={t('fleet.dealership.totals.dealership')}
                value={money(summary.data.dealershipTotal)}
                unit=""
              />
            </div>
            {/* A sum of money takes the whole row on a phone, so «ج.م.» stays on the tile. */}
            <div className="col-span-2 sm:col-span-1">
              <FigureChip
                icon={FILTER_ICON.company}
                iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-300"
                label={t('fleet.dealership.totals.custody')}
                value={money(summary.data.custodyTotal)}
                unit=""
              />
            </div>
            <FigureChip
              icon={PATH.warn}
              iconClass={
                summary.data.pending > 0
                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                  : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }
              label={t('fleet.dealership.totals.pending')}
              value={summary.data.pending}
              valueClass={
                summary.data.pending > 0
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-emerald-600 dark:text-emerald-400'
              }
              unit=""
            />
            <FigureChip
              icon={PATH.trend}
              iconClass="bg-slate-500/10 text-slate-600 dark:text-slate-300"
              label={t('fleet.dealership.totals.count')}
              value={summary.data.count}
              unit=""
            />
          </section>
        )}

        <div className={BOARD_TABLE}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            sort={sorts}
            onSortChange={changeSort}
            // The yellow row: left the workshop, no invoice yet. A second signal only — the side
            // column is empty and the actions say «تسجيل الفاتورة».
            rowProps={(row) => ({ 'data-pending': row.pending ? 'true' : 'false' }) as never}
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

      <DealershipInvoiceDialog
        open={recording !== null}
        onClose={() => setRecording(null)}
        row={recording}
      />
      <DealershipImagePreviewDialog
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        row={previewing}
      />
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.dealership.deleteTitle')}
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
          {t('fleet.dealership.deleteBody')}
        </p>
      </Dialog>
    </PageContainer>
  );
};
