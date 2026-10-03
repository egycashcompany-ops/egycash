// خصم الإيصالات — the papers the driver brings back: fuel off the car's card or out of the custody
// fund, tyres and washing out of the fund. Entry is a modal («الادخال يكون فى مودال»); the totals sit
// between the filters and the table; print and Excel are icons on the page's side.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FLEET_RECEIPT_KINDS, type FleetReceiptDto, type Locale } from '@ecms/contracts';
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
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { StatStrip, type StatStripItem } from '../../../shared/ui/StatStrip';
import { toast } from '../../../shared/ui/toast/toast-store';
import { EditIcon, TrashIcon } from '../../../shared/ui/icons';
import { formatDate, formatMoney } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import * as fleetApi from '../api/fleet-api';
import { useDeleteReceipt, useReceiptSummary, useReceipts } from '../api/fleet-queries';
import { DocumentActions } from '../components/DocumentActions';
import { FilteredCount } from '../components/FilteredCount';
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
/** Litres, two decimals, Latin digits — beside the money, which prints the same way. */
const litresText = (value: number): string => value.toFixed(2);
const actionButton =
  'rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200';

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
  return <Badge tone="warning">{t('fleet.receipts.source.custody')}</Badge>;
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
        <span className="inline-flex items-center gap-1">
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

  const totals: StatStripItem[] = [
    {
      key: 'custody',
      label: t('fleet.receipts.totals.custody'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.custodyTotal) }),
    },
    {
      key: 'card',
      label: t('fleet.receipts.totals.card'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.cardTotal) }),
    },
    {
      key: 'fuel',
      label: t('fleet.receipts.totals.fuel'),
      ...(summary.data === undefined
        ? {}
        : {
            value: t('fleet.receipts.totals.fuelLitres', {
              amount: money(summary.data.fuelTotal),
              litres: litresText(summary.data.fuelLitres),
            }),
          }),
    },
    {
      key: 'tyresWash',
      label: t('fleet.receipts.totals.tyresWash'),
      ...(summary.data === undefined
        ? {}
        : { value: money(summary.data.tyresTotal + summary.data.washTotal) }),
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
  const exportSheet = async (): Promise<void> => {
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
  const onPrint = async (): Promise<void> => {
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
        title={t('fleet.nav.receipts')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.receipts') },
        ]}
        actions={
          <>
            {!isError && (
              <DocumentActions name="receipts" onPrint={onPrint} onExport={exportSheet} />
            )}
            {can('fleetReceipt.create') && (
              <Button data-receipt-new="true" onClick={() => setAdding(true)}>
                + {t('fleet.receipts.new')}
              </Button>
            )}
          </>
        }
      />
      <div className="space-y-4">
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
          trailing={<FilteredCount value={data?.meta.totalItems} />}
        >
          {dateBound('fleet.receipts.filters.from', from, 'from')}
          {dateBound('fleet.receipts.filters.to', to, 'to')}
          <VehicleCodeFilter
            className="shrink-0"
            value={vehicleCodes}
            onChange={(next) => patch({ vehicleCodes: next.length === 0 ? null : next.join(',') })}
          />
          {/* «اى حاله فيها اكتر من 3 اخيار اقدر اعمل مالتى سلكت» — three kinds, so several at once. */}
          <MultiSelect
            clearable
            className="shrink-0"
            showSelectedValues
            label={t('fleet.receipts.columns.kind')}
            options={FLEET_RECEIPT_KINDS.map((value) => ({
              value,
              label: t(`fleet.receipts.kind.${value}`),
            }))}
            value={kinds}
            onChange={(next) => patch({ kind: next.length === 0 ? null : next.join(',') })}
          />
          <Select
            aria-label={t('fleet.receipts.columns.source')}
            title={t('fleet.receipts.columns.source')}
            value={source}
            onChange={(e) => patch({ source: e.target.value || null })}
            className="w-auto shrink-0"
          >
            <option value="">{t('fleet.receipts.filters.anySource')}</option>
            <option value="card">{t('fleet.receipts.source.card')}</option>
            <option value="custody">{t('fleet.receipts.source.custody')}</option>
          </Select>
          <Input
            aria-label={t('fleet.receipts.columns.driver')}
            title={t('fleet.receipts.columns.driver')}
            placeholder={t('fleet.receipts.filters.driver')}
            value={driver}
            onChange={(e) => patch({ driver: e.target.value || null })}
            className="w-44 shrink-0"
            rule="arabic"
          />
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
        />
        {data !== undefined && data.meta.totalItems > 0 && (
          <Pagination
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
