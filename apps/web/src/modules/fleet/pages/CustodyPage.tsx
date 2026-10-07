// العهدة — «شاشه العهده اللى فيها التجميعه بتاعت مصروفات العهده»: everything the custody fund paid,
// summed per source and per car, with every movement under it. A VIEW over the two screens that
// write the fund's side — the receipts and the dealership — never a copy.
import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FLEET_CUSTODY_SOURCES,
  type FleetCustodyMovementDto,
  type FleetCustodyVehicleRowDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { PageContainer, PageHeader } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { FleetPager } from '../components/FleetPager';
import { Badge } from '../../../shared/ui/Badge';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { StatStrip, type StatStripItem } from '../../../shared/ui/StatStrip';
import { toast } from '../../../shared/ui/toast/toast-store';
import { formatDate, formatMoney } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { cn } from '../../../shared/lib/cn';
import * as fleetApi from '../api/fleet-api';
import { useCustodyMovements, useCustodySummary } from '../api/fleet-queries';
import { DocumentActions } from '../components/DocumentActions';
import { FilteredCount } from '../components/FilteredCount';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DriverName } from '../components/EmployeeName';
import { fetchFilteredRows, filtersOnly, saveSheet } from '../lib/fleet-sheet';
import { printFleetReport, reportMoney } from '../lib/fleet-report-print';
import { useReportSignatories } from '../lib/use-report-signatories';

const REMEMBERED_FILTERS = ['from', 'to', 'vehicleCodes', 'source', 'driver', 'size'] as const;
const DEFAULT_PAGE_SIZE = 25;
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');
const GRAND_TOTAL = '__total__';

export const CustodyPage = (): JSX.Element => {
  const t = useT();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const signatories = useReportSignatories();

  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const vehicleCodes = csv(sp.get('vehicleCodes'));
  const sources = csv(sp.get('source'));
  const driver = sp.get('driver') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
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
  const hasActiveFilters =
    from !== '' || to !== '' || vehicleCodes.length > 0 || sources.length > 0 || driver !== '';

  const filters = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      vehicleCodes: vehicleCodes.length > 0 ? vehicleCodes : undefined,
      source: sources.length > 0 ? sources : undefined,
      driver: driver || undefined,
    }),
    [paramsKey],
  );
  const params = useMemo(() => ({ ...filters, page, pageSize }), [filters, page, pageSize]);
  const summary = useCustodySummary(filters);
  const { data, isLoading, isError, error, refetch } = useCustodyMovements(params);
  const rows = data?.items ?? [];

  const money = (value: number): string => formatMoney(value, 'EGP', locale);
  const sourceLabel = (row: FleetCustodyMovementDto): string =>
    t(`fleet.custody.source.${row.source}`);
  const detailOf = (row: FleetCustodyMovementDto): string =>
    row.fuelType !== null ? t(`fleet.receipts.fuelType.${row.fuelType}`) : (row.detail ?? '');
  const dash = <span className="text-slate-400">—</span>;

  // «ملخص لكل سيارة» — the server's lines, with the grand total as the last row.
  const perVehicle: FleetCustodyVehicleRowDto[] = useMemo(() => {
    if (summary.data === undefined) return [];
    return [
      ...summary.data.vehicles,
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
  }, [summary.data, t]);
  const moneyCol = (
    key: keyof Pick<FleetCustodyVehicleRowDto, 'dealership' | 'fuel' | 'tyres' | 'wash' | 'total'>,
    header: string,
  ): Column<FleetCustodyVehicleRowDto> => ({
    key,
    header,
    align: 'end',
    render: (row) =>
      row[key] === 0 && row.vehicleId !== GRAND_TOTAL ? (
        dash
      ) : (
        <span className={cn('tabular-nums', key === 'total' && 'font-semibold')}>
          {money(row[key])}
        </span>
      ),
  });
  const vehicleColumns: Column<FleetCustodyVehicleRowDto>[] = [
    {
      key: 'vehicleCode',
      header: t('fleet.odometer.columns.vehicle'),
      render: (row) => row.vehicleCode ?? dash,
    },
    moneyCol('dealership', t('fleet.custody.source.dealership')),
    moneyCol('fuel', t('fleet.custody.source.fuel')),
    moneyCol('tyres', t('fleet.custody.source.tyres')),
    moneyCol('wash', t('fleet.custody.source.wash')),
    moneyCol('total', t('fleet.custody.columns.total')),
  ];

  const columns: Column<FleetCustodyMovementDto>[] = [
    {
      key: 'date',
      header: t('fleet.receipts.columns.date'),
      render: (row) => <span className="tabular-nums">{formatDate(row.date, locale)}</span>,
    },
    {
      key: 'vehicleCode',
      header: t('fleet.odometer.columns.vehicle'),
      render: (row) => row.vehicleCode ?? dash,
    },
    {
      key: 'source',
      header: t('fleet.receipts.columns.kind'),
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <Badge tone={row.source === 'dealership' ? 'info' : 'neutral'}>{sourceLabel(row)}</Badge>
          {detailOf(row) !== '' && <span className="text-sm">{detailOf(row)}</span>}
        </span>
      ),
    },
    {
      key: 'driver',
      header: t('fleet.receipts.columns.driver'),
      render: (row) => <DriverName employeeId={row.driverEmployeeId} name={row.driverName} />,
    },
    {
      key: 'ref',
      header: t('fleet.custody.columns.from'),
      render: (row) => t(`fleet.custody.from.${row.ref}`),
    },
    {
      key: 'amount',
      header: t('fleet.receipts.columns.amount'),
      align: 'end',
      render: (row) => <span className="tabular-nums">{money(row.amount)}</span>,
    },
  ];

  const totals: StatStripItem[] = [
    {
      key: 'total',
      label: t('fleet.custody.totals.total'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.total) }),
    },
    {
      key: 'dealership',
      label: t('fleet.custody.totals.dealership'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.dealership) }),
    },
    {
      key: 'fuel',
      label: t('fleet.custody.totals.fuel'),
      ...(summary.data === undefined ? {} : { value: money(summary.data.fuel) }),
    },
    {
      key: 'tyresWash',
      label: t('fleet.custody.totals.tyresWash'),
      ...(summary.data === undefined
        ? {}
        : { value: money(summary.data.tyres + summary.data.wash) }),
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
  const exportSheet = async (): Promise<void> => {
    const all = await allRows();
    saveSheet({
      name: t('fleet.nav.custody'),
      serialHeader: t('fleet.violations.report.serial'),
      header,
      rows: all.map((row) => line(row, '')),
      moneyColumns: [5],
    });
  };
  const onPrint = async (): Promise<void> => {
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
                {
                  label: t('fleet.custody.totals.tyresWash'),
                  value: reportMoney(summary.data.tyres + summary.data.wash),
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
    <PageContainer fullHeight>
      <PageHeader
        title={t('fleet.nav.custody')}
        breadcrumbs={[
          { label: t('fleet.module.title'), to: '/fleet' },
          { label: t('fleet.nav.custody') },
        ]}
        actions={
          !isError && <DocumentActions name="custody" onPrint={onPrint} onExport={exportSheet} />
        }
      />
      <div className={BOARD_FRAME}>
        <FilterBar
          hasActiveFilters={hasActiveFilters}
          onClear={() =>
            patch({ from: null, to: null, vehicleCodes: null, source: null, driver: null })
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
          {/* «اى حاله فيها اكتر من 3 اخيار اقدر اعمل مالتى سلكت» — four sources, so several at once. */}
          <MultiSelect
            clearable
            className="shrink-0"
            showSelectedValues
            label={t('fleet.custody.columns.source')}
            options={FLEET_CUSTODY_SOURCES.map((value) => ({
              value,
              label: t(`fleet.custody.source.${value}`),
            }))}
            value={sources}
            onChange={(next) => patch({ source: next.length === 0 ? null : next.join(',') })}
          />
          {/* A width on the WRAPPER: `Input` carries its own `w-full`, and a width passed as a
              class only joins it (`cn` does not merge) — the box took the whole row and pushed
              itself, and the count after it, onto lines of their own. */}
          <div className="w-44 shrink-0">
            <Input
              aria-label={t('fleet.receipts.columns.driver')}
              title={t('fleet.receipts.columns.driver')}
              placeholder={t('fleet.receipts.filters.driver')}
              value={driver}
              onChange={(e) => patch({ driver: e.target.value || null })}
              rule="arabic"
            />
          </div>
        </FilterBar>

        <StatStrip columns={4} labelFirst items={totals} />

        {/* Two tables share the height: the per-car totals take what they need up to three tenths,
            and the movements take the rest — each scrolls its own rows. */}
        <section
          data-custody-per-vehicle="true"
          className="flex shrink-0 flex-col gap-2 lg:max-h-[30%]"
        >
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            {t('fleet.custody.perVehicle')}
          </h2>
          <div className="lg:flex lg:min-h-0 lg:flex-col [&>div]:min-h-0">
            <DataTable
              columns={vehicleColumns}
              rows={perVehicle}
              rowKey={(row) => row.vehicleId ?? `code:${row.vehicleCode ?? ''}`}
              loading={summary.isLoading}
              error={summary.isError ? summary.error : undefined}
              onRetry={() => void summary.refetch()}
              empty={t('fleet.custody.empty')}
              rowClassName={(row) =>
                row.vehicleId === GRAND_TOTAL
                  ? 'bg-slate-50 font-semibold dark:bg-slate-900'
                  : undefined
              }
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
          <div className={BOARD_TABLE_FILL}>
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => `${row.ref}:${row.id}`}
              loading={isLoading}
              error={isError ? error : undefined}
              onRetry={() => void refetch()}
              empty={t('fleet.custody.empty')}
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
        </section>
      </div>
    </PageContainer>
  );
};
