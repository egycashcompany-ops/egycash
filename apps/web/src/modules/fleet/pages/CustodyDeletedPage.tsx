// «العمليات المحذوفة» — every operation deleted from «سجل العهدة», under the fund's head (the «سجل
// العهدة» tab stays lit: `custodyTabOf` maps every address under `/fleet/custody/log` to it). One
// line per deleted operation, newest delete first:
//
//   «حذفها»          who deleted it, and when — Cairo date and time
//   «العملية»        its chip, «محذوفة» under it (+ «كانت معلّقة» / «كانت ملغاة» when it was)
//   «التفاصيل»       its words as the log said them, and its letter's day
//   «المبلغ»         struck through — it counts for nothing now
//   «إجمالي العهدة»  just before and just after the delete (one figure when nothing moved)
//   «سجّلها»         who recorded it, and when
//   «سبب الحذف»      why — or «لم يُذكر سبب»
//
// The filters: the delete's day «من / إلى» (Cairo days — the server reads them so) and «العملية».
// The eye opens the operation's drawer in its deleted mode (`?open=<id>`): read only, nothing to
// print, confirm, cancel or delete. A phone: one card per operation.
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FLEET_CUSTODY_OPERATION_KINDS, type FleetCustodyOperationDto } from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { ErrorState } from '../../../shared/ui/states/ErrorState';
import { Spinner } from '../../../shared/ui/Spinner';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { cn } from '../../../shared/lib/cn';
import { useCustodyDeleted } from '../api/custody-delete-queries';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../components/board-scroll';
import { FleetPager } from '../components/FleetPager';
import { DARK_FILTER_BAR } from '../components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../components/FilterWithIcon';
import { CustodyFundHeader } from '../components/CustodyFundHeader';
import { CUSTODY_OPS, useOverlayHistory } from '../components/CustodyFundActions';
import { CustodyOperationDrawer } from '../components/CustodyOperationDrawer';
import { ACTION_GROUP } from '../components/row-actions-look';
import { BoardIcon, NUM } from '../components/FuelCardBoard';
import { CAIRO, NOTE, TITLE } from '../components/custody-dashboard-parts';
import {
  CUSTODY_FILTER_LOOK,
  CUSTODY_TAB_TABLE,
  EMBEDDED_TABLE,
  MOVES_CHIP,
  SECTION_CARD,
  SECTION_FOOT,
  SECTION_STRIP,
} from '../components/custody-board-looks';
import { TIGHT } from '../components/custody-memo-parts';
import {
  DeletedCard,
  DeletedDetail,
  DeletedOpCell,
  DeletedReason,
  DeletedViewButton,
  FundBeforeAfter,
  StruckAmount,
  WhoWhen,
} from '../components/custody-deleted-parts';
import { BIN_ICON } from '../components/custody-delete-parts';
import { deletedKindsOf } from '../lib/custody-delete';
import { useCustodyCount } from '../lib/custody-words';

const DELETED = 'fleet.custody.deleted';
/** Remembered across visits: the filters and the page size. Never `page`, never a drawer. */
const REMEMBERED_FILTERS = ['from', 'to', 'op', 'size'] as const;
const DEFAULT_PAGE_SIZE = 25;
/** Newest delete first — the only order the page offers. */
const SORT = 'deletedAt:desc';
const BACK_ICON: readonly string[] = ['M9 18l6-6-6-6'];

export const CustodyDeletedPage = (): JSX.Element => {
  const t = useT();
  const { count } = useCustodyCount();
  const [sp, setSp] = useSearchParams();
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';
  const opParam = sp.get('op') ?? '';
  const kinds = deletedKindsOf(opParam);
  const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
  const pageSize = Number(sp.get('size') ?? String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE;
  const openId = sp.get('open') ?? '';

  const patch = (updates: Record<string, string | null>, resetPage = true): void => {
    const next = new URLSearchParams(sp);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null || val === '') next.delete(key);
      else next.set(key, val);
    }
    if (resetPage && !('page' in updates)) next.delete('page');
    setSp(next);
  };
  // Opening pushes one entry (Back closes the drawer); closing pops it.
  const overlay = useOverlayHistory();
  const openOperation = (id: string): void => {
    const next = new URLSearchParams(sp);
    next.set('open', id);
    setSp(next, overlay.openOptions(sp.get('open') !== null));
  };
  const closeOperation = (): void =>
    overlay.close(() => {
      const next = new URLSearchParams(sp);
      next.delete('open');
      setSp(next, { replace: true });
    });
  const hasActiveFilters = from !== '' || to !== '' || kinds.length > 0;
  const params = useMemo(
    () => ({
      from: from || undefined,
      to: to || undefined,
      kind: kinds.length > 0 ? kinds : undefined,
      page,
      pageSize,
      sort: SORT,
    }),
    [from, to, opParam, page, pageSize],
  );
  const { data, isLoading, isError, error, refetch } = useCustodyDeleted(params);
  const rows = data?.items ?? [];
  const total = data?.meta.totalItems;
  // Nothing deleted: no «0 عمليات» — the empty face says it.
  const countText = total === undefined || total === 0 ? '' : count('operation', total);

  const columns: Column<FleetCustodyOperationDto>[] = [
    {
      key: 'deleted',
      header: t(`${DELETED}.col.deleted`),
      align: 'center',
      render: (op) => <WhoWhen name={op.deletion?.byName ?? null} at={op.deletion?.at ?? null} />,
    },
    {
      key: 'op',
      header: t(`${DELETED}.col.op`),
      align: 'center',
      render: (op) => <DeletedOpCell op={op} />,
    },
    {
      key: 'detail',
      header: t(`${DELETED}.col.detail`),
      align: 'center',
      className: 'min-w-[13rem]',
      render: (op) => <DeletedDetail op={op} />,
    },
    {
      key: 'amount',
      header: t(`${DELETED}.col.amountShort`),
      align: 'center',
      render: (op) => <StruckAmount op={op} unit={false} />,
    },
    {
      key: 'fund',
      header: t(`${DELETED}.col.fundShort`),
      align: 'center',
      className: 'bg-slate-50 dark:bg-[#131f35]/50',
      headerClassName: 'bg-slate-200/80 dark:bg-[#131f35]',
      render: (op) => <FundBeforeAfter op={op} />,
    },
    {
      key: 'recorded',
      header: t(`${DELETED}.col.recorded`),
      align: 'center',
      render: (op) => <WhoWhen name={op.createdByName} at={op.createdAt} />,
    },
    {
      key: 'reason',
      header: t(`${DELETED}.col.reason`),
      align: 'center',
      className: 'min-w-[10.5rem]',
      render: (op) => <DeletedReason op={op} />,
    },
    {
      key: 'actions',
      header: t('fleet.vehicles.columns.actions'),
      align: 'center',
      render: (op) => (
        <span className={ACTION_GROUP} data-row-actions="custody-deleted">
          <DeletedViewButton id={op.id} onOpen={openOperation} />
        </span>
      ),
    },
  ];

  // «من» / «إلى» as the log draws them: the coloured calendar opens the picker, and the word sits
  // in the box while it is empty, gone the moment the box is focused.
  const dateBound = (labelKey: string, value: string, param: 'from' | 'to'): JSX.Element => (
    <FilterWithIcon
      icon={FILTER_ICON.calendar}
      tone="text-cyan-600 dark:text-cyan-400"
      className="w-44 shrink-0"
      datePicker={{ label: t(labelKey) }}
    >
      <Input
        type="date"
        dir="ltr"
        density={TIGHT}
        aria-label={t(labelKey)}
        title={t(labelKey)}
        value={value}
        onChange={(e) =>
          patch(
            param === 'from' ? { from: e.target.value || null } : { to: e.target.value || null },
          )
        }
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

  const emptyFace = hasActiveFilters ? (
    <p
      data-deleted-empty-filtered="true"
      className={cn(
        'py-10 text-center text-sm font-semibold text-slate-500 dark:text-slate-400',
        CAIRO,
      )}
    >
      {t(`${DELETED}.emptyFiltered`)}
    </p>
  ) : (
    <div
      className="flex flex-col items-center gap-2 px-6 py-12 text-center"
      data-deleted-empty="true"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500">
        <BoardIcon d={BIN_ICON.slice(0, 3)} className="h-6 w-6" />
      </span>
      <p className={cn('text-[15px] font-bold text-slate-700 dark:text-slate-200', CAIRO)}>
        {t(`${DELETED}.empty`)}
      </p>
      <p className={cn('max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400', CAIRO)}>
        {t(`${DELETED}.emptyHint`)}
      </p>
    </div>
  );

  return (
    <PageContainer fullHeight>
      <CustodyFundHeader />
      <div className={BOARD_FRAME} data-custody-deleted="true">
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-deleted-toolbar="true"
        >
          <span className="flex flex-wrap items-center gap-3">
            <Link
              to="/fleet/custody/log"
              data-deleted-back="true"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-700/80"
            >
              <BoardIcon d={BACK_ICON} className="h-3.5 w-3.5" />
              {t(`${DELETED}.back`)}
            </Link>
            <span
              role="status"
              data-filtered-count
              className="shrink-0 whitespace-nowrap text-sm font-bold text-slate-600 dark:text-slate-300"
            >
              {countText}
            </span>
          </span>
        </div>

        <div
          data-deleted-filter-bar="true"
          className={cn(DARK_FILTER_BAR, CUSTODY_FILTER_LOOK, '[&_[role=listbox]]:animate-menu-in')}
        >
          <FilterBar
            hasActiveFilters={hasActiveFilters}
            onClear={() => patch({ from: null, to: null, op: null })}
          >
            {dateBound(`${DELETED}.filters.from`, from, 'from')}
            {dateBound(`${DELETED}.filters.to`, to, 'to')}
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t(`${DELETED}.col.op`)}
                options={FLEET_CUSTODY_OPERATION_KINDS.map((value) => ({
                  value,
                  label: t(CUSTODY_OPS[value].label),
                }))}
                value={kinds}
                onChange={(next) => patch({ op: next.length === 0 ? null : next.join(',') })}
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        <section
          data-deleted-table="true"
          className={cn(
            SECTION_CARD,
            'flex shrink-0 flex-col lg:min-h-[18rem] lg:flex-1 lg:shrink',
          )}
        >
          <div className={cn(SECTION_STRIP, 'flex-wrap gap-y-1')}>
            <span className="flex items-center gap-2">
              <h2 className={TITLE}>{t(`${DELETED}.title`)}</h2>
              {countText !== '' && (
                <span data-deleted-count="true" className={cn(MOVES_CHIP, NUM)}>
                  {countText}
                </span>
              )}
            </span>
            <span className={cn(NOTE, 'whitespace-normal')}>{t(`${DELETED}.note`)}</span>
          </div>
          {/* A phone has no table: its failure and its loading are said here, in the table's own
              order — never an empty card that reads as «nothing deleted». */}
          {isError && !isLoading ? (
            <div className="sm:hidden" data-deleted-error-phone="true">
              <ErrorState error={error} onRetry={() => void refetch()} />
            </div>
          ) : isLoading ? (
            <p className="flex justify-center py-6 sm:hidden" data-deleted-loading-phone="true">
              <Spinner className="h-5 w-5" />
            </p>
          ) : rows.length === 0 ? (
            <div className="sm:hidden" data-deleted-empty-phone="true">
              {emptyFace}
            </div>
          ) : (
            <ul
              className="flex flex-col gap-2 bg-slate-50/60 p-2.5 sm:hidden dark:bg-transparent"
              data-deleted-cards="true"
            >
              {rows.map((op) => (
                <DeletedCard key={op.id} op={op} onOpen={openOperation} />
              ))}
            </ul>
          )}
          <div
            className={cn(
              CUSTODY_TAB_TABLE,
              EMBEDDED_TABLE,
              BOARD_TABLE_FILL,
              'hidden sm:block',
              '[&_td_a]:!h-6 [&_td_a]:!w-6 [&_tbody_td]:!py-1.5 [&_thead_th]:!py-2',
            )}
          >
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(op) => op.id}
              loading={isLoading}
              error={isError ? error : undefined}
              onRetry={() => void refetch()}
              empty={emptyFace}
              rowProps={(op) => ({ 'data-deleted-row': op.id }) as never}
              minColumnWidth={4}
              stickyHead
            />
          </div>
          {data !== undefined && data.meta.totalItems > 0 && (
            <div className={SECTION_FOOT}>
              <FleetPager
                meta={data.meta}
                onPageChange={(p) => patch({ page: String(p) }, false)}
                onPageSizeChange={(size) => patch({ size: String(size), page: null }, false)}
              />
            </div>
          )}
        </section>
      </div>
      {openId !== '' && (
        <CustodyOperationDrawer
          key={openId}
          id={openId}
          toLetter={false}
          onClose={closeOperation}
          deleted
        />
      )}
    </PageContainer>
  );
};
