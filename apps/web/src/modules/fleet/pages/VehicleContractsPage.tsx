// «عقود توريد السيارات» — every vehicle supply contract, as the owner's approved sample draws the
// board (`zz-contracts-list-page`): the licence expenses board's look piece for piece — no page
// title; the toolbar with the count, «الإحصائيات», the Excel / PDF pill and «عقد جديد»; the dark
// filter bar (the period, the supplier, the make, «إنذار التوريد»); the figures over the whole
// filtered set; and the table in the alarms board's type.
//
// THE DELIVERY ALARM — «لو فاضل عربيه واحده ومعاد التوريد جه يدينى انذار»: a contract with cars
// still owed is yellow from 30 days before its «آخر موعد للتوريد» and red from 7 (and once it has
// passed). The server decides it (`alarm` on the DTO, the `alarm=` filter and the `alarmRank` order
// all from one day), so the row's colour, the filter and the contract's strip always agree. A row
// holds its alarm's colour across, as on the alarms board.
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  FLEET_SUPPLY_ALARM_LEVELS,
  type FleetSupplyAlarmLevel,
  type FleetVehicleContractDto,
  type Locale,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useAppSelector } from '../../../store';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { Dialog } from '../../../shared/ui/Dialog';
import { Button } from '../../../shared/ui/Button';
import { Input } from '../../../shared/ui/form';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { localized } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useVehicleTypes } from '../api/fleet-queries';
import {
  useDeleteVehicleContract,
  useVehicleContractSummary,
  useVehicleContractSuppliers,
  useVehicleContracts,
} from '../api/vehicle-contract-queries';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FigureChip, moneyChip } from '../components/FleetFigures';
import { FleetPager } from '../components/FleetPager';
import { BoardIcon, NUM, PATH } from '../components/FuelCardBoard';
import { ALARM_ROW_HOLD, alarmRowAttrs, alarmRowTint } from '../components/AlarmBadge';
import { useVehicleContractColumns } from '../components/vehicle-contract-columns';
import { CLOCK_ICON, CONTRACT_ICON, RECEIVE_ICON } from '../components/vehicle-contract-parts';
import { VehicleContractDeliveryDialog } from '../components/VehicleContractDeliveryDialog';
import { VehicleContractsExport } from '../components/VehicleContractsExport';
import { clickSort, readSorts, sortQuery, writeSorts } from '../lib/table-sort';
import { pct } from '../lib/vehicle-contract-figures';
import { latin, useVehicleContractWords } from '../lib/vehicle-contract-words';
import { DARK_TABLE } from './VehiclesListPage';
import { ALARMS_TYPE } from './MaintenanceAlarmsPage';

/** Remembered across visits: the filters, the page size and the order. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['from', 'to', 'suppliers', 'makes', 'alarm', 'size', 'sort'] as const;
const DEFAULT_PAGE_SIZE = 25;
/** The newest contract first. */
const DEFAULT_SORT = 'date:desc';
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');
const TIGHT = 'tight' as const;
const LEVELS: readonly FleetSupplyAlarmLevel[] = FLEET_SUPPLY_ALARM_LEVELS;

/** The board's toolbar buttons — the licence expenses board's own. */
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';

/** The licence board's table, holding the alarm rows' red and amber as the alarms board does. */
const CONTRACT_TABLE = cn(
  DARK_TABLE,
  BOARD_TABLE_FILL,
  '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
  "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
  ALARMS_TYPE,
  ALARM_ROW_HOLD,
  // A column more than the licence board: the cells keep the board's wide-screen side room on a
  // laptop too, so the eight columns fit beside the open menu.
  'max-[1749px]:[&_tbody_td]:!px-1.5 max-[1749px]:[&_thead_th]:!px-1.5',
);

export const VehicleContractsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const words = useVehicleContractWords();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [statsOpen, setStatsOpen] = useState(false);
  const [receiving, setReceiving] = useState<FleetVehicleContractDto | null>(null);
  const [deleting, setDeleting] = useState<FleetVehicleContractDto | null>(null);
  const remove = useDeleteVehicleContract();

  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const suppliersParam = sp.get('suppliers');
  const suppliers = useMemo(() => csv(suppliersParam), [suppliersParam]);
  const makesParam = sp.get('makes');
  const makes = useMemo(() => csv(makesParam), [makesParam]);
  const alarmParam = sp.get('alarm');
  const levels = useMemo(
    () =>
      csv(alarmParam).filter((v): v is FleetSupplyAlarmLevel =>
        LEVELS.includes(v as FleetSupplyAlarmLevel),
      ),
    [alarmParam],
  );
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
  const changeSort = (by: string): void => {
    patch({ sort: writeSorts(clickSort(sortParam, DEFAULT_SORT, by)) }, false);
  };
  const list = (values: readonly string[]): string | null =>
    values.length === 0 ? null : values.join(',');
  const hasActiveFilters =
    from !== '' || to !== '' || suppliers.length > 0 || makes.length > 0 || levels.length > 0;

  // The filters alone — the table's, the figures' and the files' question is one question.
  const filters = useMemo(
    () => ({
      ...(from === '' ? {} : { from }),
      ...(to === '' ? {} : { to }),
      ...(suppliers.length === 0 ? {} : { suppliers }),
      ...(makes.length === 0 ? {} : { typeIds: makes }),
      ...(levels.length === 0 ? {} : { alarm: levels }),
    }),
    [from, to, suppliers, makes, levels],
  );
  const params = useMemo(
    () => ({ page, pageSize, ...filters, ...sortQuery(sorts) }),
    [page, pageSize, filters, sorts],
  );
  const { data, isLoading, isError, error, refetch } = useVehicleContracts(params);
  const summary = useVehicleContractSummary(filters);
  const supplierOptions = useVehicleContractSuppliers();
  const types = useVehicleTypes();
  const rows = data?.items ?? [];

  const confirmDelete = async (): Promise<void> => {
    if (deleting === null) return;
    try {
      await remove.mutateAsync(deleting.id);
      toast.success(t('fleet.vehicleContracts.deletedToast'));
      setDeleting(null);
    } catch (failure) {
      toast.error(errorMessage(failure, locale));
    }
  };
  const columns = useVehicleContractColumns({ onReceive: setReceiving, onDelete: setDeleting });

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
      <div className={BOARD_FRAME} data-contracts-list="true">
        <div className="flex items-center justify-between gap-2">
          <span
            role="status"
            data-filtered-count
            title={t('fleet.filters.matchedRows')}
            className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-600 dark:text-slate-300"
          >
            {data === undefined ? '' : words.count('contract', data.meta.totalItems)}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">
            <button
              type="button"
              data-contracts-stats-toggle="true"
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
            {!isError && <VehicleContractsExport params={params} totals={figures} />}
            {can('fleetVehicleContract.create') && (
              <Link
                to="/fleet/vehicle-contracts/new"
                data-contract-new="true"
                title={t('fleet.vehicleContracts.new')}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t('fleet.vehicleContracts.new')}
              </Link>
            )}
          </span>
        </div>

        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={hasActiveFilters}
            onClear={() =>
              patch({ from: null, to: null, suppliers: null, makes: null, alarm: null })
            }
          >
            {dateBound('fleet.receipts.filters.from', from, 'from')}
            {dateBound('fleet.receipts.filters.to', to, 'to')}
            <FilterWithIcon icon={FILTER_ICON.company} tone="text-violet-600 dark:text-violet-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.vehicleContracts.filters.supplier')}
                options={(supplierOptions.data ?? []).map((name) => ({ value: name, label: name }))}
                value={suppliers}
                onChange={(next) => patch({ suppliers: list(next) })}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                chips
                label={t('fleet.vehicles.filters.short.make')}
                options={(types.data?.items ?? []).map((type) => ({
                  value: type.id,
                  label: localized(type.name, locale),
                }))}
                value={makes}
                onChange={(next) => patch({ makes: list(next) })}
              />
            </FilterWithIcon>
            {/* «إنذار التوريد» — the two levels, in triage order, as «إنذار الصيانة» on the odometer log. */}
            <FilterWithIcon icon={PATH.warn} tone="text-amber-700 dark:text-amber-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('fleet.vehicleContracts.filters.alarm')}
                options={LEVELS.map((level) => ({
                  value: level,
                  label: t(`fleet.dashboard.level.${level}`),
                }))}
                value={levels}
                onChange={(next) => patch({ alarm: list(next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        {statsOpen && figures !== undefined && (
          <section
            data-contracts-figures="true"
            className="grid shrink-0 animate-drop-in grid-cols-2 gap-3 lg:grid-cols-6"
          >
            <FigureChip
              icon={CONTRACT_ICON}
              iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              label={t('fleet.vehicleContracts.stats.contracts')}
              value={latin(figures.count)}
              unit={words.unit('contract', figures.count)}
            />
            <div className="col-span-2">
              <FigureChip
                icon={PATH.box}
                iconClass="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
                label={t('fleet.vehicleContracts.stats.value')}
                {...moneyChip(figures.value, locale)}
              />
            </div>
            <FigureChip
              icon={PATH.truck}
              iconClass="bg-slate-500/10 text-slate-600 dark:text-slate-300"
              label={t('fleet.vehicleContracts.stats.contracted')}
              value={latin(figures.contracted)}
              unit={words.unit('car', figures.contracted)}
            />
            <FigureChip
              icon={RECEIVE_ICON}
              iconClass="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              label={t('fleet.vehicleContracts.stats.received')}
              value={latin(figures.received)}
              unit={words.unit('car', figures.received)}
              note={
                <>
                  <span dir="ltr" className={NUM}>
                    {pct(figures.received, figures.contracted)}%
                  </span>{' '}
                  {t('fleet.vehicleContracts.stats.ofContracted')}
                </>
              }
            />
            <FigureChip
              icon={CLOCK_ICON}
              iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              label={t('fleet.vehicleContracts.stats.remaining')}
              value={latin(figures.contracted - figures.received)}
              unit={words.unit('car', figures.contracted - figures.received)}
              note={t('fleet.vehicleContracts.stats.notYet')}
            />
          </section>
        )}

        <div className={CONTRACT_TABLE}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
            // One row IS one contract, so its alarm belongs to the whole row — as on the alarms board.
            rowClassName={(row) => alarmRowTint(row.alarm?.level)}
            rowProps={(row) => alarmRowAttrs(row.alarm?.level ?? 'none')}
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

      {receiving !== null && (
        <VehicleContractDeliveryDialog
          open
          onClose={() => setReceiving(null)}
          contract={rows.find((row) => row.id === receiving.id) ?? receiving}
          editing={null}
          onRefused={() => void refetch()}
        />
      )}
      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('fleet.vehicleContracts.delete.title')}
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
          {deleting === null
            ? ''
            : t('fleet.vehicleContracts.delete.body', { name: words.contractName(deleting).text })}
        </p>
      </Dialog>
    </PageContainer>
  );
};
