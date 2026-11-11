// Receiving into the vault (B4) — the legacy `/receive_mohsana` screen, «شاشة استلام الخزينه».
//
// WHAT THE LEGACY SCREEN WAS (discovery §7.2, contad_app.js:968-1310): the treasurer's queue of
// secured shipments not yet in the vault, with an edit form that recorded packaging, seals and a
// receipt number. Three things about it are worth stating, because two are preserved and one is
// deliberately not:
//
//   · NO DATE FILTER (:977). The queue is everything outstanding, all-time. PRESERVED — a
//     shipment does not stop needing to be received because a day rolled over.
//   · The "receive" was implemented as a GENERIC EDIT gated only on `deleted_dock == 0`, so ANY
//     save from this screen re-stamped `status: 2` and the receive timestamp — even a note fix
//     (quirk Q29). NOT PRESERVED: receiving is its own act here, and it happens once.
//   · `treasurer_receive` was written as `""` on every path (:1211/:1266), so the two-man rule the
//     schema described never actually recorded two people (quirk Q2). NORMALIZED: both treasurers
//     are required, and the server refuses the same person twice.
//
// ROUND 8 — YELLOW AND GREEN. «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر …
// وساعتها هيظهر للخزنة فى شاشة استلام الخزينه نفس المحصنة … وهتكون باللون الاصفر عشان تعرف ان المحصنة
// مع القائد ولما الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة وعند العمليات». The queue is the
// server's (`GET /operations/secured/vault-queue`, board rows):
//
//   · by default, the secured shipments WITH THE CAPTAIN — he pressed ✓ on collecting them from the
//     bank — on a YELLOW row, and those the vault received TODAY on a GREEN one: a receipt stays on
//     the screen for the rest of the day instead of vanishing under the treasurer's hand;
//   · «الكل» lists every one no captain has collected yet as well, on a white row — a captain
//     without the app never presses ✓, and his shipment must still be receivable. (Round 10
//     changed that: the desk confirms such a pickup on the secured screen, and a white row here is
//     for viewing only — see below.)
//
// ROUND 9 — THE DAY BOARD'S LOOK. «شاشة الاستلام من الخزنة خليها زى شاشة التشغيل اليومى برضو»: the
// screen IS the operations board (`components/ShipmentsBoard.tsx`) — the figures over the rows
// shown and their «عملات أخرى», the one-row dark filter bar, the dark table with its hover cards,
// the stage badges, the receipt image and «السجل» — drawn with the secured screen's columns
// (`kind="secured"`: «تاريخ الاستلام» beside «تاريخ التسليم», no «النوع»). What only this screen
// has, it hands the board:
//
//   · the vault's ✓ («استلام في الخزينة») among the row's actions, at the desk ✓'s place — the
//     receive form (packaging, seals, two treasurers), unchanged. Only for a reader who may
//     receive, only on a row still outside the vault; after it the row turns green and STAYS;
//   · its colours (`vaultRowTint`): yellow with the captain, green once received — still green
//     after it has gone out, where the Operations boards turn it blue, because here it is today's
//     receipt;
//   · under each badge, WHEN it got there — the captain's ✓ on a yellow row, the vault's on a green
//     one (the Cairo clock, as every Operations stamp);
//   · in the toolbar, the legend's counts (over the rows shown, as the figures are) and «الكل»;
//   · a «الحالة» filter offering exactly the stages the list can hold (`vaultQueueStages`).
//
// And what it does not: no «إضافة», no edit or delete, no desk ✓, and the receipt image is looked
// at, never managed (`canEditRows={false}`) — the treasury receives here, the desk edits elsewhere.
//
// WHO READS IT. The screen is the vault's grant (`operationsVault.view`), and a treasurer may hold
// it without `operationsShipment.view`. The bank and currency names the board prints are read on
// either grant (the catalogs' list routes); what stays the shipment grant's — «السجل», the receipt
// image's bytes — the board does not offer such a reader, and the receive form's treasurer list is
// the crew grant's (`ReceiveIntoVaultDialog`). Such a reader hears no shipment signal (a captain's
// ✓ is announced on the shipment topics), so the queue re-reads itself every minute for them.
//
// ROUND 10 — THE VAULT'S ✓ ONLY AFTER A PICKUP, THE LOCK, THE CANCELLED RECEIPT. «لو قائد تم الاستلام
// من القائد و لو العمليات تم الاستلام من العمليات وهتبقى صفر بس وهتكون ظاهره ل شاشة استلام الخزينة بس مش
// هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح»:
//
//   · a row is YELLOW once somebody confirmed collecting it — the captain in the app («تم الاستلام من
//     القائد») or the Operations desk on the secured screen («تم الاستلام من العمليات»). The legend
//     has ONE yellow chip for both, «مع القائد أو العمليات»: for the vault they are the same work,
//     and the badge on each row (a van, or the Operations office) says which;
//   · the vault's ✓ is offered on a yellow row only (`mayReceive`). The white rows «الكل» adds are
//     there to be SEEN — the owner's «ظاهره … بس مش هيقدر يعمل صح» — with no ✓, and the line under
//     their badge says why («للعرض فقط …»);
//   · once received, the row is LOCKED (the board draws no edit or photo change anywhere), and the
//     one way back is «إلغاء استلام الخزينة» on a green row still IN the vault, for whoever holds
//     that special grant (`canCancelReceipt`, the board's act and dialog) — it turns yellow again.
//
// The queue rides the day board's cache subtree: a captain's ✓, the desk's pickup ✓ or its undo, a
// receive, a cancelled receipt or a shipment edit refreshes it like the boards.
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS,
  type OperationsVaultQueueShipmentDto,
} from '@ecms/contracts';
import { useT } from '../../../platform/localization/useT';
import { useCan } from '../../../platform/rbac/Can';
import { PageContainer } from '../../../platform/layout/PageContainer';
import { cn } from '../../../shared/lib/cn';
import { formatNumber } from '../../../shared/lib/format';
import { useRememberedFilters } from '../../../shared/lib/useRememberedFilters';
import { CheckIcon } from '../../../shared/ui/icons';
import { useAppSelector } from '../../../store';
import { NUM } from '../../fleet/components/FuelCardBoard';
import { actionTone } from '../../fleet/components/row-actions-look';
import { useOperationsVaultQueue } from '../api/operations-queries';
import { ReceiveIntoVaultDialog } from '../components/ReceiveIntoVaultDialog';
import { ADD_BUTTON, BRAND_BUTTON, ShipmentsBoard } from '../components/ShipmentsBoard';
import { isHistoryTooLarge } from '../lib/shipment-history';
import { cairoStampText, ltrIsolate } from '../lib/shipment-log';
import {
  mayReceive,
  readVaultQueueAll,
  vaultQueueCounts,
  vaultQueueStages,
  vaultQueueState,
  vaultRowTint,
  type VaultQueueState,
} from '../lib/vault-queue';

/**
 * Remembered across visits: the filters the secured board reads (`boardFilterParams('secured')` —
 * day-board-filters.spec holds the two together), and NOT «الكل». The screen opens on the vault's
 * work — the shipments with the captain and today's receipts — and «الكل» is a look further for
 * the moment; it stays in the URL, so a reload keeps it.
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

/** The legend's swatch for each colour — the row tints themselves, as a small square. */
const SWATCH: Record<VaultQueueState, string> = {
  pickedUp: 'bg-amber-200 ring-amber-400/60 dark:bg-yellow-400/40 dark:ring-yellow-300/40',
  received: 'bg-emerald-200 ring-emerald-400/60 dark:bg-emerald-500/40 dark:ring-emerald-300/40',
  awaiting: 'bg-white ring-slate-300 dark:bg-slate-900 dark:ring-slate-600',
};

/**
 * ONE yellow chip for the captain's pickup and the desk's alike — «مع القائد أو العمليات»: the legend
 * says what each colour means to the vault, and both yellows mean the same thing here (its work,
 * receivable now). Two chips would split one colour into two counts the treasurer reads together.
 */
const LEGEND_KEY: Record<VaultQueueState, string> = {
  pickedUp: 'operations.vault.queue.pickedUp',
  received: 'operations.vault.queue.receivedToday',
  awaiting: 'operations.vault.queue.awaiting',
};

/**
 * A legend chip in the toolbar's own shape — the height, corners and type of «الإحصائيات» beside
 * it, the figures' white (dark: navy) face — so the legend reads as part of the board.
 */
const LEGEND_CHIP =
  'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-bold text-slate-600 sm:px-3 sm:py-2 sm:text-xs dark:border-slate-800 dark:bg-[#111827] dark:text-slate-300';

/** One colour of the legend: its swatch, its words, how many of the rows shown wear it. */
const LegendChip = ({
  state,
  count,
  children,
}: {
  state: VaultQueueState;
  count: string;
  children: ReactNode;
}): JSX.Element => (
  <span data-vault-legend={state} className={LEGEND_CHIP}>
    <span
      aria-hidden
      className={cn('h-3 w-3 shrink-0 rounded-sm ring-1 ring-inset', SWATCH[state])}
    />
    {children}
    <span className={cn('font-black text-slate-900 dark:text-white', NUM)}>{count}</span>
  </span>
);

export const VaultReceivePage = (): JSX.Element => {
  const t = useT();
  const can = useCan();
  const locale = useAppSelector((s) => s.locale.locale);
  const search = useSearchParams();
  const [sp, setSp] = search;

  // «الكل» lives in the URL (`?all=1`), so a treasurer who works the whole list keeps it on a
  // reload. `replace`: widening the list is a view of the same screen, not a place to go Back to.
  const all = readVaultQueueAll(sp);
  const setAll = (next: boolean): void => {
    const params = new URLSearchParams(sp);
    if (next) params.set('all', '1');
    else params.delete('all');
    setSp(params, { replace: true });
  };

  // A reader without the shipment grant hears no captain's ✓: the queue re-reads itself for them.
  const queue = useOperationsVaultQueue(all, true, !can('operationsShipment.view'));

  useRememberedFilters([sp, setSp], REMEMBERED_FILTERS);

  const [receiving, setReceiving] = useState<OperationsVaultQueueShipmentDto | null>(null);
  const canReceive = can('operationsVault.receive');

  // More candidates than one screen may show (open محصنات plus today's receipts) is REFUSED by the
  // server, never cut short. Said in the table's place in the secured screen's words — the generic
  // wording of that refusal asks to narrow a date range, and this screen has none. A refused
  // refetch keeps its last answer beside the error: neither its rows, its figures nor its legend
  // are shown.
  const tooLarge = isHistoryTooLarge(queue.error);
  const refusal = tooLarge
    ? t('operations.secured.backlog.tooLarge', {
        max: formatNumber(OPERATIONS_SHIPMENT_HISTORY_MAX_ROWS, locale),
      })
    : null;
  const loaded = !tooLarge && queue.data !== undefined;

  const legend: VaultQueueState[] = all
    ? ['pickedUp', 'received', 'awaiting']
    : ['pickedUp', 'received'];

  /**
   * Where the row stands and WHEN it got there, under its badge — and the specs' handle on it: the
   * vault's ✓ on a green row, the pickup ✓ on a yellow one (who confirmed it: the captain or the
   * desk), and on a white one why it has no ✓ — it is listed to be seen, not received.
   */
  const statusNote = (row: OperationsVaultQueueShipmentDto): ReactNode => {
    const state = vaultQueueState(row);
    const stamp =
      state === 'received' ? row.vaultReceivedAt : state === 'pickedUp' ? row.pickedUpAt : null;
    const stampKey =
      state === 'received'
        ? 'operations.vault.queue.receivedAt'
        : row.pickedUpBy === 'operations'
          ? 'operations.vault.queue.operationsPickedUpAt'
          : 'operations.vault.queue.pickedUpAt';
    return (
      <span
        data-vault-row={state}
        className={cn(
          'block text-[11px] text-slate-500 dark:text-slate-400',
          // The view-only line may wrap — it is a sentence; a stamp keeps its one line.
          state === 'awaiting'
            ? 'max-w-[11rem] whitespace-normal leading-tight'
            : 'whitespace-nowrap',
        )}
      >
        {state === 'awaiting'
          ? t('operations.vault.queue.viewOnly')
          : stamp !== null &&
            t(
              stampKey,
              // In the board's own figures — Latin digits, the Cairo day and time — as «السجل»
              // writes a stamp, and kept in its own order inside the Arabic sentence.
              { at: ltrIsolate(cairoStampText(stamp)) },
            )}
      </span>
    );
  };

  // The vault's ✓ — the day board's ✓, in its place and its look, opening the receive form. Only on
  // a YELLOW row (`mayReceive`): a green row has been received, and the server would refuse it
  // twice; a white one nobody has collected yet, and the server refuses it until the captain or
  // the desk confirms the pickup (`OPERATIONS_SECURED_NOT_PICKED_UP`). The board keeps the ✓'s
  // square, empty, where «السجل» follows it — or fills it with «إلغاء استلام الخزينة» on a row in
  // the vault, for whoever holds that grant.
  const receiveAction = (row: OperationsVaultQueueShipmentDto): ReactNode =>
    mayReceive(row) ? (
      <button
        type="button"
        data-vault-receive={row.id}
        aria-haspopup="dialog"
        className={actionTone('status')}
        aria-label={t('operations.vault.queue.receive')}
        title={t('operations.vault.queue.receive')}
        onClick={() => setReceiving(row)}
      >
        <CheckIcon className="h-4 w-4" />
      </button>
    ) : null;

  const toolbar = (shown: readonly OperationsVaultQueueShipmentDto[]): ReactNode => {
    const counts = vaultQueueCounts(shown);
    return (
      <>
        {/* What each colour means, and how many of the rows shown wear it — once there are rows
            to count; never beside a refusal. */}
        {loaded &&
          legend.map((state) => (
            <LegendChip key={state} state={state} count={formatNumber(counts[state], locale)}>
              {t(LEGEND_KEY[state])}
            </LegendChip>
          ))}
        {/* «الكل»: the shipments nobody has collected yet, too — to be seen, not received (Round
            10: «ظاهره … بس مش هيقدر يعمل صح»; its hint says so). A toggle, pressed while on —
            the board's button, filled like its «إضافة» while it is. Always offered, while the list
            loads, fails or is refused: it is the screen's choice of view, not part of the answer.
            (It cannot lift a refusal — the server's cap counts every open محصنة either way.) */}
        <button
          type="button"
          data-vault-all-toggle
          aria-pressed={all}
          title={t('operations.vault.queue.allHint')}
          onClick={() => setAll(!all)}
          className={all ? ADD_BUTTON : BRAND_BUTTON}
        >
          <span
            aria-hidden
            className={cn('h-2 w-2 rounded-full', all ? 'bg-white' : 'bg-brand-500/60')}
          />
          {t('operations.vault.queue.all')}
        </button>
      </>
    );
  };

  return (
    <PageContainer fullHeight>
      <ShipmentsBoard
        search={search}
        shipments={tooLarge ? [] : (queue.data?.shipments ?? [])}
        crews={tooLarge ? [] : (queue.data?.crews ?? [])}
        loaded={loaded}
        loading={queue.isLoading}
        error={tooLarge ? null : queue.error}
        onRetry={() => void queue.refetch()}
        // The treasury receives here; shipments are booked, delivered and edited on the desk's
        // screens.
        canCreate={false}
        canToggleReceived={false}
        canEditRows={false}
        kind="secured"
        stages={vaultQueueStages(all)}
        tintOf={vaultRowTint}
        statusNote={statusNote}
        rowAction={canReceive ? receiveAction : undefined}
        // «بس صلاحية خاصة تقدر تلغى استلام الخزينة» — on a green row still in the vault, for whoever
        // holds that grant (the board checks it).
        canCancelReceipt
        toolbarExtras={toolbar}
        empty={t('operations.secured.receive.empty')}
        refusal={refusal}
        paged
      />
      <ReceiveIntoVaultDialog shipment={receiving} onClose={() => setReceiving(null)} />
    </PageContainer>
  );
};
