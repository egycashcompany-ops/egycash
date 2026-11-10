// Daily operations (B2) — the replacement for the legacy `/main_ops` screen, in the Fleet boards'
// look («عدل الـ ui بتاع … الشاشة زى الحركة»): a toolbar, the dark icon filter bar, the figures
// behind «الإحصائيات», then the dark table.
//
// WHAT THE LEGACY SCREEN WAS (discovery §5.1, contad_app.js:253-300): the desk's working set for
// TODAY — daily shipments collected today, plus secured shipments due for delivery today that had
// already left the vault. Its table (main_ops.ejs:829-897): م | السيارة | اسم البنك | من فرع |
// الى فرع | العملة | قيمة الشحنة | قائد الطاقم | التاريخ | النوع | المنطقة | ملاحظات | actions.
//
// The membership rule is the SERVER's (`GET /operations/shipments/day-board`), and so are the
// names: each row arrives with its branches (by name, with their banks) and the crew of the leg
// its type reports on. This page renders the answer and owns presentation only — the filters, the
// descending numbers, the cross-bank marks, the totals — as pure functions in `lib/day-board.ts`,
// because the legacy versions of them read rendered HTML (main_ops.ejs:995).
//
// ONE ADDITION over legacy: a date picker. The default is still today, so the legacy answer is
// the default answer; being able to look at yesterday is additive, not a changed rule.
import { Fragment, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  type OperationsCurrencyDto,
  type OperationsDayBoardShipmentDto,
  type OperationsShipmentDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { DataTable, type Column } from '../../../shared/ui/DataTable';
import { FilterBar } from '../../../shared/ui/FilterBar';
import { Input } from '../../../shared/ui/form';
import { MultiSelect } from '../../../shared/ui/MultiSelect';
import { toast } from '../../../shared/ui/toast/toast-store';
import { cn } from '../../../shared/lib/cn';
import { formatAmount, formatNumber } from '../../../shared/lib/format';
import { useAppSelector } from '../../../store';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { BOARD_FRAME, BOARD_TABLE_FILL } from '../../fleet/components/board-scroll';
import { DARK_FILTER_BAR, pickOne } from '../../fleet/components/dark-filter-bar';
import { FILTER_ICON, FilterWithIcon } from '../../fleet/components/FilterWithIcon';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { ACTION_GROUP, PRESSED, actionTone } from '../../fleet/components/row-actions-look';
import { SquarePenIcon, Trash2Icon } from '../../fleet/components/row-action-icons';
import { DARK_TABLE } from '../../fleet/pages/VehiclesListPage';
import { CheckIcon } from '../../../shared/ui/icons';
import {
  useDeleteOperationsShipment,
  useOperationsBanks,
  useOperationsCurrencies,
  useOperationsDayBoard,
  useSetShipmentReceived,
} from '../api/operations-queries';
import {
  EMPTY_DAY_BOARD_FILTERS,
  branchCell,
  branchCellText,
  filterDayBoard,
  hasActiveFilter,
  boardDelivery,
  boardFigures,
  isReceived,
  rowTint,
  orderedBoardTotals,
  type DayBoardFilters,
} from '../lib/day-board';
import { DeliveryStatusBadge, ShipmentTypeBadge } from '../components/ShipmentBadges';
import { BoardFigurePill, FIGURE_TONE, OtherCurrenciesDialog } from '../components/BoardFigures';
import {
  ShipmentReceiptImageCell,
  ShipmentReceiptImagePreviewDialog,
} from '../components/ShipmentReceiptImageCell';
import { CaptainHoverName, CrewVehicleHoverCode } from '../components/BoardCrewCards';
import { ShipmentFormDialog } from '../components/ShipmentFormDialog';
import { SHIPMENT_PATH } from '../components/shipment-icons';

/**
 * Remembered across visits: the filters, and NOT `date`. The day is what the board IS — it opens
 * on today, server-side — so restoring last Tuesday would answer a question nobody asked. The
 * filters narrow whichever day is open, which is exactly what is worth keeping.
 */
const REMEMBERED_FILTERS = [
  'bank',
  'origin',
  'destination',
  'captain',
  'area',
  'notes',
  'type',
  'received',
] as const;

/** `?date=` empty means today, resolved by the server. */
export const resolveBoardDate = (raw: string | null): string | null =>
  raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;

/** Every filter is `density="tight"`, as on the Fleet boards. */
const TIGHT = 'tight' as const;

/** The Fleet boards' toolbar buttons (ReceiptsPage). */
const BRAND_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-brand-500/50 bg-brand-500/15 px-2 py-1.5 text-[11px] font-bold text-brand-700 transition hover:bg-brand-500/25 active:scale-95 sm:gap-1.5 sm:px-3 sm:py-2 sm:text-xs dark:text-brand-200';
const ADD_BUTTON =
  'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-700 to-brand-500 px-2 py-1.5 text-[11px] font-black text-white shadow-md shadow-brand-700/30 transition hover:from-brand-600 hover:to-brand-400 sm:gap-1.5 sm:px-3.5 sm:py-2 sm:text-xs active:scale-95';

/** The Fleet boards' table — no column lines, every value in Cairo's bold. */
const SHIPMENTS_TABLE = cn(
  DARK_TABLE,
  BOARD_TABLE_FILL,
  '[&_td+td]:!border-s-0 [&_th+th]:!border-s-0',
  "[&_td]:[font-family:'Cairo',ui-sans-serif,sans-serif] [&_td_*]:!font-bold",
  // Fourteen columns beside the menu on a laptop: the two icon boxes (the receipt's and the row's
  // actions) sit their icons closer than the Fleet boards' twelve-column tables need to.
  '[&_[data-row-actions]]:!gap-1 [&_[data-row-actions]]:!px-1 [&_[data-image-actions]]:!gap-1 [&_[data-image-actions]]:!px-1',
);

/** A figure in the table: monospace, tabular, never broken over two lines. */
const FIGURE = cn('whitespace-nowrap', NUM);
/** An empty cell, as the boards draw one. */
const DASH = <span className="text-slate-400">—</span>;
/**
 * A name that may wrap onto a second line rather than widen its column — the table's cells are
 * `nowrap`, and fourteen columns of unbroken names do not fit a laptop beside the menu.
 */
const WRAP = 'block min-w-[5rem] max-w-[9rem] whitespace-normal leading-tight';

export const DailyOperationsPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((state) => state.locale.locale);
  const [sp, setSp] = useSearchParams();

  const date = resolveBoardDate(sp.get('date'));
  const board = useOperationsDayBoard(date);
  const banks = useOperationsBanks({ page: 1, pageSize: MAX_PAGE_SIZE, sortBy: 'code', sortDir: 'asc' });
  const currencies = useOperationsCurrencies({ page: 1, pageSize: MAX_PAGE_SIZE });

  const setReceived = useSetShipmentReceived();
  const remove = useDeleteOperationsShipment();

  // The filters live in the URL so the board is shareable and survives a reload — and so the
  // remembered-filters hook has something to remember. Filtering still happens in the browser over
  // the day the server returned; only where the state LIVES has changed. Written with `replace`,
  // because narrowing the board is a view of it rather than a place to go Back to.
  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);
  const filters: DayBoardFilters = {
    bank: sp.get('bank') ?? '',
    origin: sp.get('origin') ?? '',
    destination: sp.get('destination') ?? '',
    captain: sp.get('captain') ?? '',
    area: sp.get('area') ?? '',
    notes: sp.get('notes') ?? '',
    type: (sp.get('type') ?? '') as DayBoardFilters['type'],
    received: (sp.get('received') ?? '') as DayBoardFilters['received'],
  };
  const setFilters = (next: DayBoardFilters): void => {
    const params = new URLSearchParams(sp);
    for (const [name, value] of Object.entries(next)) {
      if (value === '') params.delete(name);
      else params.set(name, value);
    }
    setSp(params, { replace: true });
  };
  const setFilter = (patch: Partial<DayBoardFilters>): void => setFilters({ ...filters, ...patch });

  const [editing, setEditing] = useState<OperationsDayBoardShipmentDto | null>(null);
  const [creating, setCreating] = useState(false);
  const [statsOpen, setStatsOpen] = useState(true);
  const [othersOpen, setOthersOpen] = useState(false);
  const [previewingReceipt, setPreviewingReceipt] = useState<OperationsShipmentDto | null>(null);

  const bankNameOf = (id: string): string =>
    banks.data?.items.find((bank) => bank.id === id)?.opsName ?? '';
  const currencyOf = (id: string): OperationsCurrencyDto | undefined =>
    currencies.data?.items.find((currency) => currency.id === id);

  const shipments = board.data?.shipments ?? [];
  // The crew rows the day's legs ride, for the van card — by the leg's crew row, not the van: one
  // van can run two crews in a day.
  const crewOf = new Map((board.data?.crews ?? []).map((crew) => [crew.crewAssignmentId, crew]));
  // Branch names come WITH the rows now — no page-capped catalog lookup to run out. «من فرع» and
  // «الى فرع» search the text their cell prints, bank line included, as legacy's did.
  const rows = filterDayBoard(
    shipments,
    filters,
    bankNameOf,
    (row, side) => branchCellText(row, side, bankNameOf),
    (row) => row.crew?.captainName ?? '',
  );

  // The figures: over the rows SHOWN — the filtered ones — per currency, in the legacy strip's
  // order (`orderedBoardTotals`).
  const figures = boardFigures(rows, currencyOf);
  const currencyByCode = (code: string): OperationsCurrencyDto | undefined =>
    currencies.data?.items.find((currency) => currency.code === code);

  const canEdit = can('operationsShipment.edit');
  const canDelete = can('operationsShipment.delete');
  const canComplete = can('operationsShipment.complete');

  const toggleReceived = async (shipment: OperationsDayBoardShipmentDto): Promise<void> => {
    try {
      await setReceived.mutateAsync({
        id: shipment.id,
        received: !isReceived(shipment),
        body: { version: shipment.version },
      });
    } catch {
      toast.error(t('operations.shipment.receiveFailed'));
    }
  };

  const removeShipment = async (shipment: OperationsDayBoardShipmentDto): Promise<void> => {
    // Destructive and not obviously reversible from this screen — always confirmed.
    if (!window.confirm(t('operations.shipment.confirmDelete'))) return;
    try {
      await remove.mutateAsync(shipment.id);
      toast.success(t('operations.shipment.deleted'));
    } catch {
      toast.error(t('operations.shipment.deleteFailed'));
    }
  };

  const columns: Column<OperationsDayBoardShipmentDto>[] = [
    {
      key: 'vehicle',
      header: t('operations.board.vehicle'),
      // «لما اقف على العربيه تجيب مين اللى متعين عليها»: the code opens the van's crew card.
      render: (row) =>
        row.crew === null ? (
          DASH
        ) : (
          <CrewVehicleHoverCode
            className={FIGURE}
            code={row.crew.vehicleCode ?? '…'}
            vehicleCrew={crewOf.get(row.crew.crewAssignmentId)}
          />
        ),
    },
    {
      key: 'bank',
      header: t('operations.board.bank'),
      render: (row) => bankNameOf(row.mainBankId),
    },
    {
      key: 'origin',
      header: t('operations.shipment.origin'),
      render: (row) => {
        const cell = branchCell(row, 'origin', bankNameOf);
        return (
          <div className="leading-tight">
            {/* The money came from ANOTHER bank than the one billed: said above the branch, as the
                legacy board said the to-bank (main_ops.ejs:867-872). */}
            {cell.bank !== null && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300">{cell.bank}</div>
            )}
            <div className={WRAP}>{cell.branch ?? '…'}</div>
          </div>
        );
      },
    },
    {
      key: 'destination',
      header: t('operations.shipment.destination'),
      render: (row) => {
        const cell = branchCell(row, 'destination', bankNameOf);
        return (
          <div className="leading-tight">
            {/* The cross-bank movement legacy printed in dark red, because it is the case an
                operator must not miss (main_ops.ejs:867). */}
            {cell.bank !== null && (
              <div className="text-[11px] text-red-700 dark:text-red-400">{cell.bank}</div>
            )}
            <div className={WRAP}>{cell.branch ?? '…'}</div>
          </div>
        );
      },
    },
    // «خلى المنطقة بعد الفرع الى»: the area is the destination branch's, so it sits beside it.
    {
      key: 'area',
      header: t('operations.shipment.area'),
      render: (row) => row.areaName ?? DASH,
    },
    {
      key: 'amount',
      header: t('operations.shipment.form.amount'),
      // «الشحنة نفسها فى الصف … كل العملات ظاهرها بالاجمالى ل كل عملة»: one line per currency, its
      // name beside its total — مصري, then دولار, then the rest by name, as the figures read.
      // «الارقام … تبقى اكنها عمود مش شوية داخلين وشوية خارجين»: the names take one fixed width in
      // every row, so the amounts sit in one column down the whole table — each in a box of the same
      // width, right-aligned, so units sit under units and a million reads longer than a thousand.
      render: (row) => (
        <div className="grid grid-cols-[4.75rem_6.25rem] items-baseline gap-x-2 gap-y-0.5">
          {orderedBoardTotals([row], currencyOf).map((total) => (
            <Fragment key={total.currencyId}>
              <span className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {currencyOf(total.currencyId)?.name ?? '…'}
              </span>
              <span className={cn(FIGURE, 'text-right')} dir="ltr">
                {formatAmount(total.amount, locale)}
              </span>
            </Fragment>
          ))}
        </div>
      ),
    },
    {
      key: 'captain',
      header: t('operations.board.captain'),
      // «لما اقف على القائد يجيب بياناته زى ما عاملين فى الحركه»: the Fleet driver card's facts.
      render: (row) =>
        row.crew?.captainName == null ? (
          DASH
        ) : (
          <CaptainHoverName className={WRAP} crew={row.crew} />
        ),
    },
    {
      key: 'date',
      header: t('operations.board.date'),
      // A secured row is about two days: collected (green) and delivered — legacy :882-897.
      render: (row) => (
        <div className={cn('leading-tight', FIGURE)}>
          {row.shipmentType === 'secured' ? (
            <>
              <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                {row.collectionDate.slice(0, 10)}
              </div>
              <div>{row.deliveryDate?.slice(0, 10) ?? '—'}</div>
            </>
          ) : (
            row.collectionDate.slice(0, 10)
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: t('operations.shipment.type'),
      render: (row) => <ShipmentTypeBadge shipmentType={row.shipmentType} />,
    },
    {
      key: 'status',
      header: t('operations.common.status'),
      // «النوع هيفضل زى ماهو بس هنفصل عنه الحالة»: its own column, in the desk's two words —
      // «لم يتم التسليم» / «تم التسليم» — whoever delivered; the row's colour says who.
      render: (row) => <DeliveryStatusBadge delivery={boardDelivery(row)} />,
    },
    {
      key: 'notes',
      header: t('operations.shipment.notes'),
      render: (row) =>
        row.notes === null ? (
          DASH
        ) : (
          <span className="block max-w-[5.5rem] truncate" title={row.notes}>
            {row.notes}
          </span>
        ),
    },
    {
      key: 'receiptImage',
      header: t('operations.board.receiptImage'),
      align: 'center',
      // «عاوز عمود كمان لصورة الايصال زى شاشة السيارات اقدر ارفع صوره»: the vehicles' image cell —
      // the dashed cloud to upload, then view / replace / delete.
      render: (row) => <ShipmentReceiptImageCell row={row} onPreview={setPreviewingReceipt} />,
    },
    {
      key: 'actions',
      header: t('operations.board.actions'),
      render: (row) => (
        <span className={ACTION_GROUP} data-row-actions="shipment">
          {canEdit && (
            <button
              type="button"
              className={actionTone('edit')}
              aria-label={t('common.edit')}
              title={t('common.edit')}
              onClick={() => setEditing(row)}
            >
              <SquarePenIcon className="h-4 w-4" />
            </button>
          )}
          {/* «إستلام» — a toggle, as legacy's was (main_ops.ejs:919-928): pressed once received.
              Its NAME stays «تأكيد التسليم» either way and `aria-pressed` carries the state: a
              name that flipped to «التراجع عن التسليم» would be announced "undo delivery,
              pressed", as if the undo were what is switched on. The tooltip may still say what
              a click does next. */}
          {canComplete && (
            <button
              type="button"
              className={cn(actionTone('status'), isReceived(row) && PRESSED)}
              aria-pressed={isReceived(row)}
              aria-label={t('operations.shipment.receive')}
              title={t(
                isReceived(row) ? 'operations.shipment.unreceive' : 'operations.shipment.receive',
              )}
              disabled={setReceived.isPending}
              onClick={() => void toggleReceived(row)}
            >
              <CheckIcon className="h-4 w-4" />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className={actionTone('delete')}
              aria-label={t('common.remove')}
              title={t('common.remove')}
              onClick={() => void removeShipment(row)}
            >
              <Trash2Icon className="h-4 w-4" />
            </button>
          )}
        </span>
      ),
    },
  ];

  const boardDay = (board.data?.date ?? '').slice(0, 10);
  const typeValue = filters.type === '' ? [] : [filters.type];
  const receivedValue = filters.received === '' ? [] : [filters.received];

  return (
    <PageContainer fullHeight>
      <div className={BOARD_FRAME}>
        {/* The Fleet boards open on their toolbar. «عاوز الاحصائيات تكون مكان تشغيل يوم … شيل العنوان
            دا … وخلى الاحصائيات تفتح يمين»: no title; at the start (the right) the figures behind
            «الإحصائيات» — how many shipments the filters left, the pound, the dollar, and «عملات
            أخرى» — or, with them closed, the count alone. The buttons stay at the end. */}
        <div
          className="flex flex-wrap items-center justify-between gap-2"
          data-shipments-toolbar="true"
        >
          {/* The money pills sort currencies by code, so they wait for the catalog: before it,
              every currency would read as «عملات أخرى» beside a pound and a dollar of 0. */}
          {statsOpen && board.data !== undefined && currencies.data !== undefined ? (
            <div
              role="status"
              aria-label={t('operations.board.stats')}
              data-shipment-figures="true"
              className="flex min-w-0 animate-fade-in flex-wrap items-center gap-1.5"
            >
              <BoardFigurePill
                icon={SHIPMENT_PATH.shipment}
                tone={FIGURE_TONE.count}
                label={t('operations.board.figures.count')}
                value={
                  rows.length === shipments.length
                    ? formatNumber(rows.length, locale)
                    : `${formatNumber(rows.length, locale)} / ${formatNumber(shipments.length, locale)}`
                }
                unit={t('operations.board.figures.countUnit')}
              />
              <BoardFigurePill
                icon={SHIPMENT_PATH.money}
                tone={FIGURE_TONE.pound}
                label={currencyByCode('EGP')?.name ?? 'EGP'}
                value={formatAmount(figures.egp, locale)}
                unit="EGP"
                data-figure="EGP"
              />
              <BoardFigurePill
                icon={SHIPMENT_PATH.money}
                tone={FIGURE_TONE.dollar}
                label={currencyByCode('USD')?.name ?? 'USD'}
                value={formatAmount(figures.usd, locale)}
                unit="USD"
                data-figure="USD"
              />
              {/* «مكان يورو تبقى اسمها عملات اخرى ويجيب مجموع كل العملات ما عدا المصرى والدولار»:
                  a sum of DIFFERENT currencies, which is why a click lists each one apart. */}
              <BoardFigurePill
                icon={SHIPMENT_PATH.money}
                tone={FIGURE_TONE.others}
                label={t('operations.board.figures.otherCurrencies')}
                value={formatAmount(figures.othersSum, locale)}
                title={t('operations.board.figures.otherCurrenciesHint')}
                onClick={() => setOthersOpen(true)}
                data-figure="others"
              />
            </div>
          ) : (
            <span role="status" className="text-sm font-bold text-slate-600 dark:text-slate-300">
              {board.data === undefined
                ? ''
                : t('operations.dailyOps.count', {
                    count: formatNumber(rows.length, locale),
                    total: formatNumber(shipments.length, locale),
                  })}
            </span>
          )}
          <span className="ms-auto flex shrink-0 items-center gap-1 sm:gap-2">
            <button
              type="button"
              data-shipment-stats-toggle="true"
              aria-expanded={statsOpen}
              onClick={() => setStatsOpen((open) => !open)}
              className={BRAND_BUTTON}
            >
              {statsOpen ? t('operations.board.statsHide') : t('operations.board.stats')}
              {/* Opens to the side (the figures take the title's place), so the chevron points
                  that way rather than down. */}
              <svg
                viewBox="0 0 24 24"
                aria-hidden
                className={cn(
                  'h-3 w-3 transition-transform sm:h-3.5 sm:w-3.5 rtl:-scale-x-100',
                  statsOpen && 'rotate-180',
                )}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {can('operationsShipment.create') && (
              <button
                type="button"
                data-shipment-new="true"
                onClick={() => setCreating(true)}
                className={ADD_BUTTON}
              >
                <BoardIcon d={PATH.plus} className="h-3.5 w-3.5" width={2.5} />
                {t('operations.shipment.add')}
              </button>
            )}
          </span>
        </div>

        {/* The Fleet boards' dark bar: every filter's name written in its box, an icon at its start,
            one row on a computer. Widths go on the WRAPPER — `Input` carries its own `w-full`, and
            `cn` does not merge a width passed to it. */}
        <div className={cn(DARK_FILTER_BAR, '[&_[role=listbox]]:animate-menu-in')}>
          <FilterBar
            hasActiveFilters={hasActiveFilter(filters) || date !== null}
            onClear={() => {
              // ONE write. The day goes back to the default alongside the filters: `date` is not a
              // filter — it is what the board IS — but a "clear" that left yesterday on screen
              // would be a reset the user can see failing. Two separate writes would not do it,
              // because the second would be built from the params the first had already replaced.
              const next = new URLSearchParams(sp);
              for (const name of Object.keys(EMPTY_DAY_BOARD_FILTERS)) next.delete(name);
              next.delete('date');
              setSp(next, { replace: true });
            }}
          >
            <FilterWithIcon
              icon={FILTER_ICON.calendar}
              tone="text-cyan-600 dark:text-cyan-400"
              className="w-36 shrink-0"
              datePicker={{ label: t('operations.dailyOps.date') }}
            >
              <Input
                type="date"
                dir="ltr"
                density={TIGHT}
                aria-label={t('operations.dailyOps.date')}
                title={t('operations.dailyOps.date')}
                value={date ?? boardDay}
                onChange={(e) => {
                  const next = new URLSearchParams(sp);
                  if (e.target.value === '') next.delete('date');
                  else next.set('date', e.target.value);
                  setSp(next);
                }}
                className="dark:[color-scheme:dark]"
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={SHIPMENT_PATH.bank}
              tone="text-violet-600 dark:text-violet-300"
              className="w-32 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.board.bank')}
                placeholder={t('operations.board.bank')}
                value={filters.bank}
                onChange={(e) => setFilter({ bank: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.branch}
              tone="text-violet-600 dark:text-violet-300"
              className="w-32 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.shipment.origin')}
                placeholder={t('operations.shipment.origin')}
                value={filters.origin}
                onChange={(e) => setFilter({ origin: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.branch}
              tone="text-violet-600 dark:text-violet-300"
              className="w-32 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.shipment.destination')}
                placeholder={t('operations.shipment.destination')}
                value={filters.destination}
                onChange={(e) => setFilter({ destination: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={FILTER_ICON.person}
              tone="text-emerald-600 dark:text-emerald-400"
              className="w-36 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.board.captain')}
                placeholder={t('operations.board.captain')}
                value={filters.captain}
                onChange={(e) => setFilter({ captain: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={SHIPMENT_PATH.route}
              tone="text-slate-600 dark:text-slate-300"
              className="w-28 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.shipment.area')}
                placeholder={t('operations.shipment.area')}
                value={filters.area}
                onChange={(e) => setFilter({ area: e.target.value })}
              />
            </FilterWithIcon>
            <FilterWithIcon
              icon={SHIPMENT_PATH.note}
              tone="text-slate-600 dark:text-slate-300"
              className="w-32 shrink-0"
            >
              <Input
                density={TIGHT}
                aria-label={t('operations.shipment.notes')}
                placeholder={t('operations.shipment.notes')}
                value={filters.notes}
                onChange={(e) => setFilter({ notes: e.target.value })}
              />
            </FilterWithIcon>
            {/* Two answers each — ONE at a time: ticking one replaces the other, and clearing it is
                «all», as the Fleet boards' two-answer filters read. */}
            <FilterWithIcon icon={FILTER_ICON.make} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('operations.shipment.type')}
                options={[
                  { value: 'daily', label: t('operations.shipment.type.daily') },
                  { value: 'secured', label: t('operations.shipment.type.secured') },
                ]}
                value={typeValue}
                onChange={(next) =>
                  setFilter({ type: (pickOne(typeValue, next) ?? '') as DayBoardFilters['type'] })
                }
              />
            </FilterWithIcon>
            <FilterWithIcon icon={FILTER_ICON.status} tone="text-slate-600 dark:text-slate-300">
              <MultiSelect
                clearable
                fullWidth
                density={TIGHT}
                showSelectedValues
                label={t('operations.dailyOps.received')}
                options={[
                  { value: 'yes', label: t('operations.dailyOps.receivedYes') },
                  { value: 'no', label: t('operations.dailyOps.receivedNo') },
                ]}
                value={receivedValue}
                onChange={(next) =>
                  setFilter({
                    received: (pickOne(receivedValue, next) ?? '') as DayBoardFilters['received'],
                  })
                }
              />
            </FilterWithIcon>
          </FilterBar>
        </div>

        <div className={SHIPMENTS_TABLE}>
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={board.isLoading}
            error={board.error}
            onRetry={() => void board.refetch()}
            empty={t('operations.dailyOps.empty')}
            // «لو تم التسليم من القائد … الصف لونه اصفر ولما ادوس انا على صح … يبقى الصف اخضر»: green
            // once the desk confirmed (legacy's `#a9e6b8`, main_ops.ejs:851), yellow while only the
            // crew captain has.
            rowClassName={(row) => rowTint(boardDelivery(row))}
            stickyHead
            // Thirteen columns of short things — a van code, a bank, a date, three icons. The
            // default floor (7.5rem a column) would make the table 98rem wide and push the notes
            // and the actions off a laptop screen; the cells' own content is narrower than that.
            minColumnWidth={5.5}
          />
        </div>
      </div>

      <ShipmentReceiptImagePreviewDialog
        open={previewingReceipt !== null}
        onClose={() => setPreviewingReceipt(null)}
        row={previewingReceipt}
      />

      <OtherCurrenciesDialog
        open={othersOpen}
        onClose={() => setOthersOpen(false)}
        totals={figures.others}
        currencyOf={currencyOf}
        locale={locale}
      />

      <ShipmentFormDialog
        // The day board adds daily shipments only — «اشيل النوع ويكون يومى بس».
        createType="daily"
        open={creating || editing !== null}
        shipment={editing}
        defaultDate={date ?? boardDay}
        banks={banks.data?.items ?? []}
        currencies={currencies.data?.items ?? []}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
    </PageContainer>
  );
};
