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
//     changed that: the desk confirms such a pickup on the secured screen, and a white row here was
//     for viewing only; Round 13 lifted that again — see below.)
//
// ROUND 9 — THE DAY BOARD'S LOOK. «شاشة الاستلام من الخزنة خليها زى شاشة التشغيل اليومى برضو»: the
// screen IS the operations board (`components/ShipmentsBoard.tsx`) — the figures over the rows
// shown and their «عملات أخرى», the one-row dark filter bar, the dark table with its hover cards,
// the stage badges, the receipt image and «السجل» — drawn with the secured screen's columns
// («تاريخ الاستلام» beside «تاريخ التسليم», no «النوع»; since Round 13 the vault's own `kind`, which
// adds its two status columns). What only this screen has, it hands the board:
//
//   · the vault's ✓ («استلام في الخزينة») among the row's actions, at the desk ✓'s place — the
//     receive form (packaging, seals, two treasurers), unchanged. Only for a reader who may
//     receive, only on a row still outside the vault; after it the row turns green and STAYS;
//   · its colours (`vaultRowTint`): yellow with the captain, green once received — still green
//     after it has gone out, where the Operations boards turn it blue, because here it is today's
//     receipt;
//   · in the toolbar, the legend's counts (over the rows shown, as the figures are) and «الكل».
// (Round 9 also had a line under the status badge saying when, and a «الحالة» filter of the stages
// the list could hold; Round 13's two columns took both over — see below.)
//
// And what it does not: no edit or delete, no desk ✓, and the receipt image is looked at, never
// managed (`canEditRows={false}`) — the treasury receives here, the desk edits elsewhere. (Round 12
// added «إضافة محصنة» — below.)
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
//   · the vault's ✓ was offered on a yellow row only, the white rows «الكل» added being there to be
//     SEEN («ظاهره … بس مش هيقدر يعمل صح») — lifted in Round 13, below;
//   · once received, the row is LOCKED (the board draws no edit or photo change anywhere), and the
//     one way back is «إلغاء استلام الخزينة» on a green row still IN the vault, for whoever holds
//     that special grant (`canCancelReceipt`, the board's act and dialog) — it turns yellow again.
//
// The queue rides the day board's cache subtree: a captain's ✓, the desk's pickup ✓ or its undo, a
// receive, a cancelled receipt or a shipment edit refreshes it like the boards.
//
// ROUND 12 — «إضافة محصنة» HERE TOO. «وعاوز فى استلام الخزينة انه يقدر يعمل اضافة ل محصنة زى شاشة
// الشحنات المحصنة بالظبط»: the secured screen's button, in the same place in the toolbar (after the
// legend and «الكل»), opening the same form for a SECURED shipment (`createType="secured"` — its
// delivery date the day after collection unless changed), offered on the same grant
// (`operationsShipment.create`, which the board checks). The form's catalogs — banks, branches,
// areas, currencies — are read on the vault's grant too, so a treasurer who may book can fill it.
// A محصنة booked here starts where every new one starts: nobody has collected it yet, so it is a
// white row — on the default list once its collection day has come (Round 13), and receivable as it
// is. Only ADDING moves here: the rows themselves stay the desk's to edit (`canEditRows={false}`).
//
// ROUND 13 — TWO STATUS COLUMNS, AND THE VAULT RECEIVES WITHOUT A PICKUP. «انا عايز الجدول بتاع استلام
// الخزينه يكون مكان الحاله عمودين. العمود الاولاني يبقى خاص يبين ان اللي حصل استلام من القائد او من
// العمليات، والعمود التاني بتاع الحاله برضو يبين استلام من الخزينه. واستلام الخزينه ممكن تستلم يكون
// القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه تستلم عادي»:
//
//   · the board is the VAULT's (`kind="vault"`): in «الحالة»'s place, «حالة الاستلام» — «تم الاستلام
//     من القائد» / «تم الاستلام من العمليات» with the time, or «لم يتم الاستلام» — and «حالة الخزينة»
//     — «لم تُستلم بعد», «بالخزينة» with the time, or for a receipt of today that has left since,
//     «خرجت للتسليم» / «تم التسليم». Each column has its own filter in the bar, where the stage box
//     stands on the secured screen (still one row: nine boxes, as the day board's);
//   · the vault's ✓ is on EVERY row not yet received, white or yellow (`mayReceive`) — Round 10's
//     «مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح» is lifted. A receipt of a white row
//     writes no pickup: its row turns green and its pickup column keeps «لم يتم الاستلام», for
//     good — the two columns say who did what;
//   · the queue lists by default what the vault can receive NOW (the server's): every محصنة
//     collected today or earlier, white or yellow, every yellow one, and today's receipts; «الكل»
//     adds the white ones booked for a later collection day. So the legend counts all three
//     colours from the start — «لم يتم الاستلام», «مع القائد أو العمليات», «بالخزينة اليوم».
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
import {
  VAULT_LEGEND,
  mayReceive,
  readVaultQueueAll,
  vaultQueueCounts,
  vaultRowTint,
  type VaultQueueState,
} from '../lib/vault-queue';

/**
 * Remembered across visits: the filters the vault's board reads (`boardFilterParams('vault')` —
 * day-board-filters.spec holds the two together: its two status columns' boxes in the stage's
 * place), and NOT «الكل». The screen opens on the vault's work — what it can receive now and
 * today's receipts — and «الكل» is a look further for the moment; it stays in the URL, so a reload
 * keeps it.
 */
const REMEMBERED_FILTERS = [
  'vehicle',
  'bank',
  'origin',
  'destination',
  'area',
  'captain',
  'pickup',
  'vault',
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
 * says what each colour means to the vault, and both yellows mean the same thing here (in hand, on
 * its way in). Two chips would split one colour into two counts the treasurer reads together. The
 * white chip says the pickup column's own words, «لم يتم الاستلام»: nobody handed it over, and the
 * vault has not received it either (a receipt nobody handed over is green, and counted there).
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

  // More candidates than one screen may show (the محصنات the list would read plus today's receipts)
  // is REFUSED by the server, never cut short. Said in the table's place in the secured screen's words — the generic
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

  // The vault's ✓ — the day board's ✓, in its place and its look, opening the receive form. On EVERY
  // row not yet received (`mayReceive`), white or yellow — «والخزنه تستلم عادي» (Round 13): a green
  // row has been received, and the server would refuse it twice. The board keeps the ✓'s square,
  // empty, where «السجل» follows it — or fills it with «إلغاء استلام الخزينة» on a row in the vault,
  // for whoever holds that grant.
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
          VAULT_LEGEND.map((state) => (
            <LegendChip key={state} state={state} count={formatNumber(counts[state], locale)}>
              {t(LEGEND_KEY[state])}
            </LegendChip>
          ))}
        {/* «الكل»: the white محصنات booked for a later collection day, too — receivable like every
            row (Round 13; its hint says what it adds). A toggle, pressed while on — the board's
            button, filled like its «إضافة» while it is. No count of its own: what it would add is
            not read until it is on, and once on, the figures' count says how many are shown.
            Always offered, while the list loads, fails or is refused: it is the screen's choice of
            view, not part of the answer. */}
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
        // Round 12 — «يقدر يعمل اضافة ل محصنة زى شاشة الشحنات المحصنة بالظبط»: the secured screen's
        // «إضافة محصنة», for whoever may book (the board checks `operationsShipment.create`). The rows
        // are still delivered and edited on the desk's screens.
        canCreate
        createType="secured"
        canToggleReceived={false}
        canEditRows={false}
        // The vault's board: the secured board's columns, «الحالة» split in two (Round 13).
        kind="vault"
        tintOf={vaultRowTint}
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
