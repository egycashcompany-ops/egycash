// «مصروفات التراخيص» — every licensing-expenses memo the department wrote, in the boards' look:
// the count, «الإحصائيات», the dark filters, the table, and «+ مذكرة جديدة» into the editor.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { useLicenseExpenses } from '../api/fleet-queries';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FigureChip } from '../components/FleetFigures';
import { FleetPager } from '../components/FleetPager';
import { BoardIcon, PATH } from '../components/FuelCardBoard';
import {
  type LicenseExpenseItemLine,
  type LicenseExpenseMemoRow,
  memoTitle,
  memosOf,
  money,
  printMemos,
  sumOf,
} from '../lib/license-expense-memo';

const BOARD_TABLE = cn(
  '[&>div]:!rounded-2xl [&>div]:!border-slate-200 dark:[&>div]:!border-slate-800 [&>div]:!bg-white dark:[&>div]:!bg-[#111827]',
  '[&_thead_tr]:!bg-slate-100 dark:[&_thead_tr]:!bg-[#0c121e] [&_thead_th]:!text-slate-500 dark:[&_thead_th]:!text-slate-400',
  '[&_tbody_tr]:!border-slate-200 dark:[&_tbody_tr]:!border-slate-800 [&_tbody_td]:!text-slate-800 dark:[&_tbody_td]:!text-slate-200',
  '[&_th]:!text-[13px] [&_th]:!font-bold [&_td]:!py-2.5 [&_td]:whitespace-nowrap [&_td]:!text-sm [&_td]:!font-semibold',
);
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-3 py-2 text-xs font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 dark:text-brand-200';
const day = (iso: string): string => iso.slice(0, 10).replace(/-/gu, '/');

export const LicenseExpensesPage = (): JSX.Element => {
  const t = useT();
  const [statsOpen, setStatsOpen] = useState(false);
  const [vehicleCodes, setVehicleCodes] = useState<string[]>([]);
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const params = useMemo(
    () => ({
      page,
      pageSize,
      ...(vehicleCodes.length === 0 ? {} : { vehicleCodes }),
      ...(kind === '' ? {} : { kind }),
    }),
    [page, pageSize, vehicleCodes, kind],
  );
  const { data, isLoading, isError, error, refetch } = useLicenseExpenses(params);
  const rows = data?.items ?? [];
  // A record is a renewal, an extension, or both: its figures are both halves together.
  const itemsOf = (row: LicenseExpenseMemoRow): LicenseExpenseItemLine[] =>
    memosOf(row).flatMap((memo) => memo.items);
  const carsOf = (row: LicenseExpenseMemoRow): string[] =>
    memosOf(row).flatMap((memo) => memo.vehicles.map((v) => v.code ?? v.plate));
  const visaOf = (row: LicenseExpenseMemoRow): number =>
    sumOf(itemsOf(row).filter((item) => item.paidBy === 'visa'));
  const cashOf = (row: LicenseExpenseMemoRow): number =>
    sumOf(itemsOf(row).filter((item) => item.paidBy === 'cash'));
  const totals = rows.reduce(
    (acc, row) => ({
      visa: acc.visa + visaOf(row),
      cash: acc.cash + cashOf(row),
      cars: acc.cars + carsOf(row).length,
    }),
    { visa: 0, cash: 0, cars: 0 },
  );

  const columns: Column<LicenseExpenseMemoRow>[] = [
    {
      key: 'date',
      header: t('fleet.licenseExpenses.date'),
      render: (row) => <span className="font-bold tabular-nums">{day(row.date)}</span>,
    },
    {
      key: 'kind',
      header: t('fleet.licenseExpenses.kind'),
      render: (row) => (
        <span className="inline-flex items-center gap-1">
          {memosOf(row).map((memo) => (
            <span
              key={memo.kind}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold',
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
      header: t('fleet.licenseExpenses.columns.cars'),
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <span className="rounded-md border border-slate-300 px-1.5 text-xs dark:border-slate-600">
            {carsOf(row).length}
          </span>
          <span className="max-w-[16rem] truncate text-slate-500 dark:text-slate-400">
            {carsOf(row).join('، ')}
          </span>
        </span>
      ),
    },
    {
      key: 'visa',
      header: t('fleet.licenseExpenses.totals.visa'),
      align: 'end',
      render: (row) => <span className="font-mono">{money(visaOf(row))}</span>,
    },
    {
      key: 'cash',
      header: t('fleet.licenseExpenses.totals.cash'),
      align: 'end',
      render: (row) => <span className="font-mono">{money(cashOf(row))}</span>,
    },
    {
      key: 'total',
      header: t('fleet.licenseExpenses.totals.all'),
      align: 'end',
      render: (row) => (
        <span className="font-mono font-black text-slate-900 dark:text-white">
          {money(sumOf(itemsOf(row)))}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'end',
      render: (row) => (
        <span className="inline-flex items-center gap-1">
          <Link
            to={`/fleet/license-expenses/${row.id}`}
            title={memosOf(row).map(memoTitle).join(' — ')}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <BoardIcon d={PATH.edit} className="h-4 w-4" />
          </Link>
          <button
            type="button"
            title={t('fleet.licenseExpenses.print')}
            onClick={() => {
              try {
                printMemos(memosOf(row));
              } catch {
                toast.error(t('fleet.vehicles.print.failed'));
              }
            }}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <BoardIcon d={PATH.pdf} className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t('common.delete')}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <BoardIcon d={PATH.trash} className="h-4 w-4" />
          </button>
        </span>
      ),
    },
  ];

  return (
    <PageContainer>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-slate-600 dark:text-slate-300">
            {data === undefined
              ? ''
              : t('fleet.licenseExpenses.count', { count: String(data.meta.totalItems) })}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((open) => !open)}
              className={BRAND_BUTTON}
            >
              {statsOpen
                ? t('fleet.vehicles.board.breakdownHide')
                : t('fleet.vehicles.board.breakdown')}
            </button>
            <Link
              to="/fleet/license-expenses/new"
              data-license-expense-new="true"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-3.5 py-2 text-xs font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 active:scale-95"
            >
              <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
              {t('fleet.licenseExpenses.newMemo')}
            </Link>
          </span>
        </div>

        {statsOpen && (
          <section className="grid animate-drop-in grid-cols-2 gap-3 lg:grid-cols-4">
            <FigureChip
              icon={PATH.card}
              iconClass="bg-blue-500/10 text-blue-600 dark:text-blue-400"
              label={t('fleet.licenseExpenses.stats.memos')}
              value={data?.meta.totalItems ?? 0}
              unit={t('fleet.licenseExpenses.stats.memoUnit')}
            />
            <FigureChip
              icon={PATH.truck}
              iconClass="bg-slate-500/10 text-slate-600 dark:text-slate-300"
              label={t('fleet.licenseExpenses.stats.cars')}
              value={totals.cars}
              unit={t('fleet.vehicles.board.totalUnit')}
            />
            <FigureChip
              icon={PATH.card}
              iconClass="bg-violet-500/10 text-violet-600 dark:text-violet-300"
              label={t('fleet.licenseExpenses.totals.visa')}
              value={money(totals.visa)}
              unit=""
            />
            <FigureChip
              icon={PATH.trend}
              iconClass="bg-amber-500/10 text-amber-600 dark:text-amber-400"
              label={t('fleet.licenseExpenses.totals.cash')}
              value={money(totals.cash)}
              unit=""
            />
          </section>
        )}

        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={vehicleCodes.length > 0 || kind !== ''}
            onClear={() => {
              setVehicleCodes([]);
              setKind('');
            }}
          >
            <FilterWithIcon icon={FILTER_ICON.car} tone="text-emerald-600 dark:text-emerald-400">
              <VehicleCodeFilter
                fullWidth
                density="tight"
                value={vehicleCodes}
                onChange={(next) => {
                  setVehicleCodes(next);
                  setPage(1);
                }}
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.licence} tone="text-violet-600 dark:text-violet-300">
              <MultiSelect
                clearable
                fullWidth
                density="tight"
                showSelectedValues
                label={t('fleet.licenseExpenses.kind')}
                options={[
                  { value: 'renewal', label: t('fleet.licenseExpenses.kinds.renewal') },
                  { value: 'extension', label: t('fleet.licenseExpenses.kinds.extension') },
                ]}
                value={kind === '' ? [] : [kind]}
                onChange={(next) => {
                  setKind(pickOne(kind === '' ? [] : [kind], next) ?? '');
                  setPage(1);
                }}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        <div className={BOARD_TABLE}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
          />
        </div>
        {data !== undefined && data.meta.totalItems > 0 && (
          <FleetPager
            meta={data.meta}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        )}
      </div>
    </PageContainer>
  );
};
