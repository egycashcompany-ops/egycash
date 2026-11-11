// «صرف الخزينة» — secured delivery: assign the delivery crew, then release from the vault (B4). The
// legacy `/tash4ela_mohasana` and `/deliver_mohsana` screens, which read the SAME list and differ only
// in what they do to it.
//
// WHAT THE TWO LEGACY SCREENS WERE (discovery §7.1, §7.3, §7.4):
//   · `/tash4ela_mohasana` (:4380-4499) — assign a captain and vehicle to each due shipment. It
//     wrote exactly `leader2` + `car_num2` and NOTHING else: assignment never changed status.
//   · `/deliver_mohsana` (:1624-1750) — release the load. It set `car_status: 1` on the crew row
//     and `status: 3` on each shipment, with NO transaction and NO check that the shipment was
//     actually in the vault. A partial failure left mixed state (quirk Q18).
// One screen, because they are one workflow over one list: assign each shipment its crew, then
// release what a vehicle is carrying. Dispatch is ONE transaction per vehicle (Q18 NORMALIZE) and
// refuses a shipment that never reached the vault or has no delivery crew.
//
// ROUND 10 — EVERY محصنة IN THE VAULT, ON THE BOARDS' BOARD. The owner: «والمحصنة دى بتروح تلقائى ل
// صرف الخزنة عشان لو هصرفها», then on what the screen lists, «كله يبقى موجود فى تاريخ يتفلتر», and on
// how it looks, «صرف الخزنية … اعملها بقى بشكل الجديد للشاشات اللى احنا عملناها». So:
//
//   · THE LIST is the server's (`GET /operations/secured/dispatch-board`): every محصنة the vault
//     holds, whatever its delivery day — it used to be one day's, and a shipment whose day had
//     passed vanished from the screen while it still sat in the vault. Delivery day ascending, so
//     the LATE ones lead; the board keeps that order (it never re-sorts);
//   · THE DAY is a filter, not the screen: ONE optional delivery-day picker at the date column's
//     place in the bar. Empty is every shipment in the vault — the screen opens on that; a day
//     narrows it to that day's deliveries (`?date=`, left out of the request when empty — the server
//     refuses an empty `date=`);
//   · THE LOOK is the secured screen's (`components/ShipmentsBoard.tsx`, `kind="secured"`): the
//     figures over the rows shown with their «عملات أخرى», the one-row dark filter bar, the dark
//     table with «تاريخ الاستلام» beside «تاريخ التسليم», the stage badges («بالخزينة», green, as on
//     every board), the van and captain hover cards, «السجل», the receipt image, paging;
//   · LATE / DUE TODAY are marked under «تاريخ التسليم» — «متأخرة» in red, «تسليمها اليوم» in amber
//     — and counted in the toolbar, over the rows shown, as the figures are. A mark, not a row
//     colour: the row's colour is the stage's on every board («بالخزينة» green), and a second
//     meaning for a colour would make the boards disagree. Judged on the SERVER's day
//     (`dispatchDue`), the one it sorted by;
//   · under each «بالخزينة», since when («منذ …»): how long it has waited in the vault.
//
// THE ACTS — the two the screen always had, each where the boards put a row's act:
//
//   · «تعيين طاقم التسليم» on a row (`operationsShipment.edit`) — the captain and vehicle, from the
//     crew planned on THAT ROW's delivery day, never the filter's (`AssignDeliveryCrewDialog`): the
//     list mixes days now, and the server refuses another day's crew. It changes a crew already
//     there too. Before Round 10 the screen had one vehicle picker over the table for the whole
//     list — right for one day's list, wrong for a list of many days;
//   · «صرف من الخزينة» (`operationsVault.dispatch`) — on a row that has its crew, or for the rows
//     ticked in the table's first column (the toolbar's «صرف المحدد»). The crew is the row's own now
//     (each row says who it is assigned to), so there is nothing to pick before releasing; the
//     ticked rows are released one vehicle per call (`DispatchSecuredDialog`, which says each
//     vehicle's load before the click). A row with no crew yet cannot be ticked — it is assigned
//     first. Before, a `window.confirm` asked "release N?" without saying on which vehicle;
//   · «إلغاء استلام الخزينة» — the board's own act on a row in the vault, for the special grant
//     only (`canCancelReceipt`); every row here is in the vault.
//
// And what it does not: no «إضافة», no edit, no delete, no receipt-photo change — every row here is
// LOCKED (the vault has received it: «ميقدر حد من القادة او العمليات او الخزنه يعدل عليها»), and the
// screen offers none of them (`canEditRows={false}`), as the vault's receive screen does not.
//
// WHO READS IT. The screen and its list are the vault's grant (`operationsVault.view`). A treasurer
// holding only the vault's grants hears the vault custody topic — receipts, cancelled receipts,
// releases — but not the crew Operations assigns (a shipment topic), and a crew is what a row waits
// for before it can go out: the list re-reads itself every minute for such a reader, as the receive
// queue does.
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  MAX_PAGE_SIZE,
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  type OperationsSecuredDispatchRowDto,
  type OperationsSecuredStage,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { useAppSelector } from '../../../store';
import { BoardIcon, NUM, PATH } from '../../fleet/components/FuelCardBoard';
import { actionTone } from '../../fleet/components/row-actions-look';
import { useOperationsBanks, useOperationsSecuredDispatchBoard } from '../api/operations-queries';
import {
  AssignDeliveryCrewDialog,
  type AssignDeliveryTarget,
} from '../components/AssignDeliveryCrewDialog';
import { DispatchSecuredDialog } from '../components/DispatchSecuredDialog';
import { ADD_BUTTON, BRAND_BUTTON, ShipmentsBoard } from '../components/ShipmentsBoard';
import { SHIPMENT_PATH } from '../components/shipment-icons';
import {
  dispatchDue,
  dispatchDueCounts,
  offersDeliveryAssign,
  offersDispatch,
  readDispatchDate,
  tickedForDispatch,
  type DispatchDue,
} from '../lib/secured-dispatch';
import { isHistoryTooLarge } from '../lib/shipment-history';
import { cairoStamp, ltrIsolate, shipmentCaption } from '../lib/shipment-log';

/**
 * Remembered across visits: the filters the secured board reads (`boardFilterParams('secured')` —
 * day-board-filters.spec holds the two together), and NOT the delivery day. The screen IS the
 * vault's whole contents; a day looked at once is not where the next visit starts.
 */
const REMEMBERED_FILTERS = [
  'vehicle',
  'bank',
  'origin',
  'destination',
  'area',
  'captain',
  'stage',
  'notes',
] as const;

/**
 * The stages «الحالة» offers — the one a row here can be in: every row is IN the vault (the server
 * lists status `inVault` only). Offering one it can never hold would only ever empty the table.
 */
const DISPATCH_STAGES: readonly OperationsSecuredStage[] = ['inVault'];

/** The mark under «تاريخ التسليم» — a small pill in the row, red when late, amber when due today. */
const DUE_MARK =
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-black ring-1 ring-inset';
const DUE_TONE: Record<DispatchDue, string> = {
  overdue:
    'bg-rose-100 text-rose-700 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-400/40',
  today:
    'bg-amber-100 text-amber-800 ring-amber-300 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/40',
};
const DUE_KEY: Record<DispatchDue, string> = {
  overdue: 'operations.secured.dispatch.overdue',
  today: 'operations.secured.dispatch.dueToday',
};
/** The toolbar's count of each mark: its swatch, its words, how many of the rows shown wear it. */
const DUE_SWATCH: Record<DispatchDue, string> = {
  overdue: 'bg-rose-400 dark:bg-rose-400',
  today: 'bg-amber-400 dark:bg-amber-300',
};
/** In the toolbar's own shape — «الإحصائيات»'s height, corners and type, the figures' face. */
const LEGEND_CHIP =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-600 sm:px-3 sm:py-2 sm:text-xs dark:border-slate-800 dark:bg-[#111827] dark:text-slate-300';

export const SecuredDispatchPage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((s) => s.locale.locale);
  const search = useSearchParams();
  const [sp, setSp] = search;

  // The delivery day, when one is asked for — none is every day the vault holds.
  const date = readDispatchDate(sp.get('date'));
  const setDate = (value: string): void => {
    const next = new URLSearchParams(sp);
    // Emptied, the screen goes back to every shipment in the vault.
    if (value === '') next.delete('date');
    else next.set('date', value);
    setSp(next);
  };

  // A reader without the shipment grant hears no crew assigned: the list re-reads itself for them.
  const board = useOperationsSecuredDispatchBoard(date, true, !can('operationsShipment.view'));

  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  // The board's own bank request (by code) — read from its cache — to name a row in a dialog's
  // title and a tick box's label, as «السجل» names it.
  const banks = useOperationsBanks({
    page: 1,
    pageSize: MAX_PAGE_SIZE,
    sortBy: 'code',
    sortDir: 'asc',
  });
  const bankNameOf = (id: string): string =>
    banks.data?.items.find((bank) => bank.id === id)?.opsName ?? '';
  const captionOf = (row: OperationsSecuredDispatchRowDto): string =>
    shipmentCaption(row, bankNameOf, t);

  const canAssign = can('operationsShipment.edit');
  const canDispatch = can('operationsVault.dispatch');

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [assigning, setAssigning] = useState<AssignDeliveryTarget | null>(null);
  const [releasing, setReleasing] = useState<OperationsSecuredDispatchRowDto[] | null>(null);

  // More shipments in the vault than one screen may show is REFUSED by the server, never cut
  // short — said in the table's place, with what narrows it (a delivery day). A refused refetch
  // keeps its last answer beside the error: neither its rows, its figures nor its counts are shown.
  const tooLarge = isHistoryTooLarge(board.error);
  const refusal = tooLarge
    ? t('operations.secured.dispatch.tooLarge', {
        max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, locale),
      })
    : null;
  const loaded = !tooLarge && board.data !== undefined;
  // The server's day — the one it judged «late» by and sorted on (`dispatchDue`).
  const today = board.data?.today.slice(0, 10) ?? null;

  /** «متأخرة» / «تسليمها اليوم» under the row's delivery day. */
  const deliveryNote = (row: OperationsSecuredDispatchRowDto): ReactNode => {
    const due = today === null ? null : dispatchDue(row, today);
    return due === null ? null : (
      <span data-dispatch-due={due} className={cn(DUE_MARK, DUE_TONE[due])}>
        {t(DUE_KEY[due])}
      </span>
    );
  };

  /**
   * Since when it has been in the vault, under «بالخزينة» — «منذ 2026-11-08», the Cairo day: how long
   * it has waited is what a release asks, not the minute it came in. Not the receive queue's
   * «استُلمت في الخزينة …» either: the badge above already says where it is, and the width saved is
   * what keeps the row's acts on a laptop's screen beside the ticks' column.
   */
  const statusNote = (row: OperationsSecuredDispatchRowDto): ReactNode =>
    row.vaultReceivedAt === null ? null : (
      <span
        data-dispatch-received={row.id}
        className="block whitespace-nowrap text-[11px] text-slate-500 dark:text-slate-400"
      >
        {t('operations.secured.dispatch.inVaultSince', {
          at: ltrIsolate(cairoStamp(row.vaultReceivedAt).day),
        })}
      </span>
    );

  /**
   * The row's acts, at the ✓'s place: the crew (indigo, a move of who carries it) and the release
   * (violet, a check-out). Each keeps its square, empty, on a row it is not offered on — a row with
   * no delivery day cannot be crewed, one with no crew cannot go out — so «السجل» stands in one
   * column down the table.
   */
  const rowAction = (row: OperationsSecuredDispatchRowDto): ReactNode => {
    const crewLabel = t(
      row.crew === null
        ? 'operations.secured.dispatch.assignAction'
        : 'operations.secured.dispatch.reassignAction',
    );
    return (
      <>
        {canAssign &&
          (offersDeliveryAssign(row) ? (
            <button
              type="button"
              data-assign-delivery-open={row.id}
              aria-haspopup="dialog"
              className={actionTone('transfer')}
              aria-label={crewLabel}
              title={crewLabel}
              onClick={() => setAssigning({ row, caption: captionOf(row) })}
            >
              <BoardIcon d={SHIPMENT_PATH.crew} className="h-4 w-4" />
            </button>
          ) : (
            <span aria-hidden className={cn(actionTone('transfer'), 'invisible')} />
          ))}
        {canDispatch &&
          (offersDispatch(row) ? (
            <button
              type="button"
              data-dispatch-open={row.id}
              aria-haspopup="dialog"
              className={actionTone('status')}
              aria-label={t('operations.secured.dispatch.action')}
              title={t('operations.secured.dispatch.action')}
              onClick={() => setReleasing([row])}
            >
              <BoardIcon d={PATH.truck} className="h-4 w-4" />
            </button>
          ) : (
            <span aria-hidden className={cn(actionTone('status'), 'invisible')} />
          ))}
      </>
    );
  };

  const toolbar = (shown: readonly OperationsSecuredDispatchRowDto[]): ReactNode => {
    const counts = today === null ? null : dispatchDueCounts(shown, today);
    // Only ticks among the rows SHOWN that may still go out are ever released.
    const ticked = canDispatch ? tickedForDispatch(shown, selected) : [];
    return (
      <>
        {/* How many of the rows shown are late, and how many go out today — once there are rows
            to count; never beside a refusal. */}
        {loaded &&
          counts !== null &&
          (['overdue', 'today'] as const).map((due) => (
            <span key={due} data-dispatch-legend={due} className={LEGEND_CHIP}>
              <span
                aria-hidden
                className={cn('h-2.5 w-2.5 shrink-0 rounded-full', DUE_SWATCH[due])}
              />
              {t(DUE_KEY[due])}
              <span className={cn('font-black text-slate-900 dark:text-white', NUM)}>
                {formatNumber(counts[due], locale)}
              </span>
            </span>
          ))}
        {/* «صرف المحدد» — the ticked rows, released one vehicle per call. Filled like «إضافة»
            while there is something to release; off (and saying how many: none) otherwise. */}
        {canDispatch && (
          <button
            type="button"
            data-dispatch-selected={ticked.length}
            aria-haspopup="dialog"
            disabled={ticked.length === 0}
            onClick={() => setReleasing(ticked)}
            className={cn(
              ticked.length > 0 ? ADD_BUTTON : BRAND_BUTTON,
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <BoardIcon d={PATH.truck} className="h-3.5 w-3.5" />
            {t('operations.secured.dispatch.releaseSelected', {
              count: formatNumber(ticked.length, locale),
            })}
          </button>
        )}
      </>
    );
  };

  return (
    <PageContainer fullHeight>
      <ShipmentsBoard
        search={search}
        shipments={tooLarge ? [] : (board.data?.shipments ?? [])}
        crews={tooLarge ? [] : (board.data?.crews ?? [])}
        loaded={loaded}
        loading={board.isLoading}
        error={tooLarge ? null : board.error}
        onRetry={() => void board.refetch()}
        // «كله يبقى موجود فى تاريخ يتفلتر»: ONE optional day, empty for every day in the vault.
        datePickers={[
          {
            param: 'date',
            label: t('operations.shipment.deliveryDate'),
            // Empty is every day: the box says its name until a day is chosen.
            optional: true,
            value: date ?? '',
            onChange: setDate,
          },
        ]}
        periodActive={sp.get('date') !== null}
        periodParams={['date']}
        // Released from here, never booked, delivered or edited: every row is locked.
        canCreate={false}
        canToggleReceived={false}
        canEditRows={false}
        kind="secured"
        stages={DISPATCH_STAGES}
        statusNote={statusNote}
        deliveryNote={deliveryNote}
        rowAction={canAssign || canDispatch ? rowAction : undefined}
        // «بس صلاحية خاصة تقدر تلغى استلام الخزينة» — every row here is in the vault; the board
        // offers it to whoever holds that grant.
        canCancelReceipt
        // The ticks' column, for whoever may release — nobody else has a use for it.
        {...(canDispatch
          ? {
              selection: {
                selected,
                onToggle: (row: OperationsSecuredDispatchRowDto, on: boolean) =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(row.id);
                    else next.delete(row.id);
                    return next;
                  }),
                // A row with no delivery crew yet cannot go out: it is assigned first.
                selectable: offersDispatch,
                label: (row: OperationsSecuredDispatchRowDto) =>
                  t('operations.secured.dispatch.selectRow', { caption: captionOf(row) }),
              },
            }
          : {})}
        toolbarExtras={toolbar}
        empty={t(
          date === null
            ? 'operations.secured.dispatch.emptyAll'
            : 'operations.secured.dispatch.empty',
        )}
        refusal={refusal}
        paged
      />
      {canAssign && (
        <AssignDeliveryCrewDialog target={assigning} onClose={() => setAssigning(null)} />
      )}
      {canDispatch && (
        <DispatchSecuredDialog
          rows={releasing}
          onClose={() => setReleasing(null)}
          onDispatched={(ids) =>
            setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))))
          }
        />
      )}
    </PageContainer>
  );
};
