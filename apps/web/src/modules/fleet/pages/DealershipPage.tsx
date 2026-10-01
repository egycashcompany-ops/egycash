// التوكيل — every workshop exit's bill. «العربيه اللى بتخرج من الصيانه بتظهر فى الشاشه دى بس الصف
// بيكون باللون الاصفر»: a row the workshop opened waits, yellow, until its invoice is recorded.
//
// The screen follows the violations screen's chrome — print and Excel as icons on the page's far
// side, the reset as an icon in the bar — and puts the totals BETWEEN the filters and the table,
// as asked. The totals are the server's, over the whole filtered set, never the page.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type FleetDealershipInvoiceDto, type Locale } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Pagination } from '../../../shared/ui/Pagination';
import { Button } from '../../../shared/ui/Button';
import { Badge } from '../../../shared/ui/Badge';
import { Dialog } from '../../../shared/ui/Dialog';
import { Input, Select } from '../../../shared/ui/form';
import { StatStrip, type StatStripItem } from '../../../shared/ui/StatStrip';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, PrinterIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate, formatMoney } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { cn } from '../../../shared/lib/cn';
import * as fleetApi from '../api/fleet-api';
import {
  useDealershipInvoices,
  useDealershipSummary,
  useDeleteDealershipInvoice,
} from '../api/fleet-queries';
import { ExportSheetButton } from '../components/ExportSheetButton';
import { FilteredCount } from '../components/FilteredCount';
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
      render: (row) => <span className="tabular-nums">{formatDate(row.outDate, locale)}</span>,
    },
    {
      key: 'vehicleCode',
      header: t('fleet.odometer.columns.vehicle'),
      sortable: true,
      render: (row) => row.vehicleCode ?? dash,
    },
    {
      key: 'workTypeLabel',
      header: t('fleet.dealership.columns.workType'),
      sortable: true,
      render: (row) => row.workTypeLabel,
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
      render: (row) => row.insuranceCompanyName ?? dash,
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
            <Button size="sm" data-dealership-record={row.id} onClick={() => setRecording(row)}>
              {t('fleet.dealership.record')}
            </Button>
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

  /** The figures between the filters and the table. */
  const totals: StatStripItem[] = [
    {
      key: 'dealershipTotal',
      label: t('fleet.dealership.totals.dealership'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.dealershipTotal) }),
    },
    {
      key: 'custodyTotal',
      label: t('fleet.dealership.totals.custody'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.custodyTotal) }),
    },
    {
      key: 'pending',
      label: t('fleet.dealership.totals.pending'),
      ...(summary.data === undefined ? {} : { value: String(summary.data.pending) }),
    },
    {
      key: 'count',
      label: t('fleet.dealership.totals.count'),
      ...(summary.data === undefined ? {} : { value: String(summary.data.count) }),
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
  const exportSheet = async (): Promise<void> => {
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

  const dateBound = (labelKey: string, value: string, param: string): JSX.Element => (
    <span className="relative w-36">
      <Input
        type="date"
        dir="ltr"
        aria-label={t(labelKey)}
        title={t(labelKey)}
        value={value}
        onChange={(e) => patch({ [param]: e.target.value || null })}
        className={
          value === '' ? 'peer [&:not(:focus)::-webkit-datetime-edit]:opacity-0' : undefined
        }
      />
      {value === '' && (
        <span
          aria-hidden="true"
          data-date-caption={param}
          className="pointer-events-none absolute inset-y-0 left-2 right-8 flex items-center justify-center truncate text-sm text-slate-400 peer-focus:hidden dark:text-slate-500"
        >
          {t(labelKey)}
        </span>
      )}
    </span>
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('fleet.nav.dealership')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.dealership') },
        ]}
      />
      {/* «الطباعه والاكسيل ... ايقونز زى شاشه المخالفات» — on the far side of the page, stacked. */}
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-4">
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
            trailing={<FilteredCount value={data?.meta.totalItems} />}
          >
            {dateBound('fleet.dealership.filters.from', from, 'from')}
            {dateBound('fleet.dealership.filters.to', to, 'to')}
            <VehicleCodeFilter
              className="shrink-0"
              value={vehicleCodes}
              onChange={(next) =>
                patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })
              }
            />
            <Select
              aria-label={t('fleet.dealership.columns.side')}
              title={t('fleet.dealership.columns.side')}
              value={side}
              onChange={(e) => patch({ side: e.target.value || null })}
              className="w-auto shrink-0"
            >
              <option value="">{t('fleet.dealership.filters.anySide')}</option>
              <option value="dealership">{t('fleet.dealership.side.dealership')}</option>
              <option value="custody">{t('fleet.dealership.side.custody')}</option>
            </Select>
            <Select
              aria-label={t('fleet.dealership.filters.state')}
              title={t('fleet.dealership.filters.state')}
              value={state}
              onChange={(e) => patch({ state: e.target.value || null })}
              className="w-auto shrink-0"
            >
              <option value="">{t('fleet.dealership.filters.anyState')}</option>
              <option value="pending">{t('fleet.dealership.pending')}</option>
              <option value="recorded">{t('fleet.dealership.recorded')}</option>
            </Select>
            <Select
              aria-label={t('fleet.dealership.columns.workType')}
              title={t('fleet.dealership.columns.workType')}
              value={work}
              onChange={(e) => patch({ work: e.target.value || null })}
              className="w-auto shrink-0"
            >
              <option value="">{t('fleet.dealership.filters.anyWork')}</option>
              <option value="maintenance">{t('fleet.dealership.work.maintenance')}</option>
              <option value="repair">{t('fleet.dealership.work.repair')}</option>
            </Select>
          </FilterBar>

          {/* «الاجماليات تكون بين الجدول والفلاتر» */}
          <StatStrip columns={4} labelFirst items={totals} />

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
            rowClassName={(row) => cn(row.pending && 'bg-amber-50/80 dark:bg-amber-950/30')}
          />
          {data !== undefined && data.meta.totalItems > 0 && (
            <Pagination
              meta={data.meta}
              onPageChange={(p) => patch({ page: String(p) }, false)}
              onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
            />
          )}
        </div>
        {!isError && (
          <div className="order-last flex shrink-0 flex-col gap-1">
            <button
              type="button"
              data-print="dealership"
              aria-label={t('common.print')}
              title={t('common.print')}
              onClick={() => void onPrint()}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <PrinterIcon className="h-6 w-6" />
            </button>
            <ExportSheetButton name="dealership" onExport={exportSheet} />
          </div>
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
