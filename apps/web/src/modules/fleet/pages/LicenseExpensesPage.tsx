// «مصروفات التراخيص» — every licensing-expenses memo the department wrote, in the boards' look:
// the count, «الإحصائيات», the dark filters, the table, and «+ مذكرة جديدة» into the editor.
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
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { errorMessage } from '../../../shared/lib/errors';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useDeleteLicenseExpense, useLicenseExpenses } from '../api/fleet-queries';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { VehicleCodeFilter } from '../components/VehicleCodeFilter';
import { DARK_FILTER_BAR, pickOne } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { FigureChip } from '../components/FleetFigures';
import { FleetPager } from '../components/FleetPager';
import { BoardIcon, PATH } from '../components/FuelCardBoard';
import {
  type LicenseExpenseItemFields,
  memoHtml,
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
/** Remembered across visits: the filters and the page size. `page` is derived, never kept. */
const REMEMBERED_FILTERS = ['vehicleCodes', 'kind', 'size'] as const;
const DEFAULT_PAGE_SIZE = 25;
const csv = (raw: string | null): string[] => (raw ?? '').split(',').filter((v) => v !== '');

export const LicenseExpensesPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state): Locale => state.locale.locale);
  const [statsOpen, setStatsOpen] = useState(false);
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
  const codesParam = sp.get('vehicleCodes');
  const vehicleCodes = useMemo(() => csv(codesParam), [codesParam]);
  const kind = sp.get('kind') ?? '';
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
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
  const itemsOf = (row: FleetLicenseExpenseDto): LicenseExpenseItemFields[] =>
    memosOf(row).flatMap((memo) => memo.items);
  const carsOf = (row: FleetLicenseExpenseDto): string[] =>
    memosOf(row).flatMap((memo) => memo.vehicles.map((v) => v.code ?? v.plate));
  const visaOf = (row: FleetLicenseExpenseDto): number =>
    sumOf(itemsOf(row).filter((item) => item.paidBy === 'visa'));
  const cashOf = (row: FleetLicenseExpenseDto): number =>
    sumOf(itemsOf(row).filter((item) => item.paidBy === 'cash'));
  const totals = rows.reduce(
    (acc, row) => ({
      visa: acc.visa + visaOf(row),
      cash: acc.cash + cashOf(row),
      cars: acc.cars + carsOf(row).length,
    }),
    { visa: 0, cash: 0, cars: 0 },
  );

  const columns: Column<FleetLicenseExpenseDto>[] = [
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
          <button
            type="button"
            data-license-expense-view={row.id}
            title={t('fleet.licenseExpenses.view')}
            aria-label={t('fleet.licenseExpenses.view')}
            onClick={() => setViewing(row)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <BoardIcon d={PATH.eye} className="h-4 w-4" />
          </button>
          {can('fleetLicenseExpense.edit') && (
            <Link
              to={`/fleet/license-expenses/${row.id}`}
              data-license-expense-edit={row.id}
              title={t('common.edit')}
              aria-label={t('common.edit')}
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
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
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
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
              className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-red-600 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <BoardIcon d={PATH.trash} className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
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
            {can('fleetLicenseExpense.create') && (
              <Link
                to="/fleet/license-expenses/new"
                data-license-expense-new="true"
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-3.5 py-2 text-xs font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 active:scale-95"
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t('fleet.licenseExpenses.newMemo')}
              </Link>
            )}
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
            onClear={() => patch({ vehicleCodes: null, kind: null })}
          >
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
                onChange={(next) => patch({ kind: pickOne(kind === '' ? [] : [kind], next) })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        <div className={cn(BOARD_TABLE, BOARD_TABLE_FILL)}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={isLoading}
            error={isError ? error : undefined}
            onRetry={() => void refetch()}
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
                  style={{ transform: 'scale(0.8)', width: '210mm', marginBottom: '-20%' }}
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
