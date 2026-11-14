// «محصنات الخزينة» (Round 12 — was «صرف الخزينة»): every محصنة in the vault right now, to LOOK at.
// The legacy `/tash4ela_mohasana` and `/deliver_mohsana` screens read this list to crew and release
// it; the owner moved both acts off it: «وعاوز اغير اسم صرف الخزينة ل محصنات الخزينة وتكون وظيفتها
// انها بتعرض اللى موجود دلوقتى فى الخزنة». Crewing is now «توزيع المحصنات» (the day's vans, a محصنة
// dragged onto one — `SecuredDistributionPage.tsx`) and the release «تسليم المحصنات» (each van's load
// handed over — `VaultHandoverPage.tsx`): «المحصنة اللى يومها هتخرج هتظهر تلقائى فى شاشة توزيع
// المحصنات … ولما يحفظ نفس الشاشة هنعمل زيها للخزنة هيكون فوق كل عربيه تسليم وطباعه». So this screen
// is VIEW ONLY — no crew, no release, no ticks, and no cancelled receipt either (that stays on the
// secured screen, where every open محصنة — those in the vault among them — is listed). The route
// stays `/operations/vault/dispatch` (a bookmark keeps working), and so do both endpoints.
//
// WHAT IT SHOWS — Round 10's list, unchanged («كله يبقى موجود فى تاريخ يتفلتر»):
//
//   · THE LIST is the server's (`GET /operations/secured/dispatch-board`): every محصنة the vault
//     holds, whatever its delivery day. Delivery day ascending, so the LATE ones lead; the board
//     keeps that order (it never re-sorts);
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
// And what it does not: no «إضافة», no edit, no delete, no receipt-photo change — every row here is
// LOCKED (the vault has received it), and the screen offers none of them (`canEditRows={false}`).
// The one thing a reader may still open on a row is «السجل», its story — a view, like the screen.
//
// WHO READS IT. The screen and its list are the vault's grant (`operationsVault.view`). A treasurer
// holding only the vault's grants hears the vault custody topic — receipts, cancelled receipts,
// releases — but not the crew Operations assigns on «توزيع المحصنات» (a shipment topic), which the
// rows' van and captain show: the list re-reads itself every minute for such a reader, as the
// receive queue does.
//
// ROUND 16 — «لوحة تحكم». The owner: «دلوقتي محصنات الخزينة أنا عايز يكون فيها لوحة تحكم اللي هي
// داشبورد جنب الإحصائيات». A button right beside «إخفاء الإحصائيات», in its look — as «لوحة تحكم»
// sits beside «الإحصائيات» on Fleet's custody board and «تقرير الخزينة» on «سجل الخزينة» — opens the
// dashboard over the whole screen (`components/SecuredDispatchDashboard.tsx`). It reads THIS board's
// rows as the board shows them (every filter, every page — what the toolbar is handed), so it is
// offered once those rows are in and never beside a refusal, where there are none to read. What it
// changes it changes HERE: «إعادة ضبط الفلاتر» clears the board's filters and its delivery day (the
// window stays up, dimmed over its last rows, while the board reads the vault's whole list again),
// and «تسليمها اليوم» / «تسليمها غدًا» set the board's «تاريخ التسليم» to that day and close it.
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
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
import { useOperationsSecuredDispatchBoard } from '../api/operations-queries';
import { SecuredDispatchDashboard } from '../components/SecuredDispatchDashboard';
import { BRAND_BUTTON, ShipmentsBoard } from '../components/ShipmentsBoard';
import { DAY_BOARD_FILTER_PARAMS, offeredFilters, readDayBoardFilters } from '../lib/day-board';
import {
  dispatchDue,
  dispatchDueCounts,
  readDispatchDate,
  type DispatchDue,
} from '../lib/secured-dispatch';
import { isHistoryTooLarge } from '../lib/shipment-history';
import { cairoStamp, ltrIsolate } from '../lib/shipment-log';

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

  // «لوحة تحكم» — closed on the way in; nothing it reads is asked for until it opens.
  const [dashOpen, setDashOpen] = useState(false);
  // A list the server refused (too many rows) or could not give leaves it nothing to read: it
  // closes, rather than show zeros, and does not come back by itself when a later answer lands. A
  // list on its way — a reset that dropped the delivery day — keeps it up over its last rows.
  if (dashOpen && !loaded && !board.isLoading) setDashOpen(false);
  // The filters as the board READS them (a param with no box narrows nothing), for its line.
  const filters = offeredFilters(readDayBoardFilters(sp), 'secured', DISPATCH_STAGES);
  // The board's own reset, in ONE write: its filters and the delivery day together.
  const clearFilters = (): void => {
    const next = new URLSearchParams(sp);
    for (const name of [...DAY_BOARD_FILTER_PARAMS, 'date']) next.delete(name);
    setSp(next, { replace: true });
  };

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
   * it has waited is what the screen is read for, not the minute it came in.
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

  // «لوحة تحكم» first, right beside «إخفاء الإحصائيات»; then how many of the rows shown are late,
  // and how many go out today — once there are rows to count; never beside a refusal. Nothing here
  // DOES anything to a row: the screen is to look at, and so is the dashboard.
  const toolbar = (shown: readonly OperationsSecuredDispatchRowDto[]): ReactNode => (
    <>
      <button
        type="button"
        data-dispatch-dashboard-open="true"
        aria-haspopup="dialog"
        aria-expanded={dashOpen}
        // It reads the rows shown: until they are in — or when the list was refused — there are
        // none to read, and a dashboard of zeros would say the vault is empty.
        disabled={!loaded}
        onClick={() => setDashOpen(true)}
        className={cn(BRAND_BUTTON, 'disabled:cursor-not-allowed disabled:opacity-50')}
      >
        <BoardIcon d={PATH.trend} className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
        {t('operations.secured.dashboard.open')}
      </button>
      {dueLegend(shown)}
      {/* The board's rows SHOWN, live: a filter cleared from the dashboard redraws it at once. */}
      <SecuredDispatchDashboard
        open={dashOpen}
        pending={!loaded}
        onClose={() => setDashOpen(false)}
        rows={shown}
        today={today ?? ''}
        filters={filters}
        date={date}
        onClearFilters={clearFilters}
        onShowDay={(day) => {
          setDate(day);
          setDashOpen(false);
        }}
      />
    </>
  );

  // How many of the rows shown are late, and how many go out today.
  const dueLegend = (shown: readonly OperationsSecuredDispatchRowDto[]): ReactNode => {
    const counts = today === null ? null : dispatchDueCounts(shown, today);
    return loaded && counts !== null
      ? (['overdue', 'today'] as const).map((due) => (
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
        ))
      : null;
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
        // «وظيفتها انها بتعرض اللى موجود دلوقتى فى الخزنة» — to look at: nothing is booked, delivered,
        // edited, crewed or released from here (`rowAction` and `selection` are not handed in, and
        // neither is the board's cancelled receipt).
        canCreate={false}
        canToggleReceived={false}
        canEditRows={false}
        kind="secured"
        stages={DISPATCH_STAGES}
        statusNote={statusNote}
        deliveryNote={deliveryNote}
        toolbarExtras={toolbar}
        empty={t(
          date === null
            ? 'operations.secured.dispatch.emptyAll'
            : 'operations.secured.dispatch.empty',
        )}
        refusal={refusal}
        paged
      />
    </PageContainer>
  );
};
