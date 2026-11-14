// The vault's receive queue («شاشة استلام الخزينه») — its client-side decisions as pure functions:
// what colour a row is, what its status says, and whether the vault may still receive it.
//
// WHICH ROWS are on the queue is the SERVER's rule (`GET /operations/secured/vault-queue`): the
// secured shipments somebody has collected — the captain or the Operations desk — those received
// into the vault today, and with «الكل» the ones nobody has collected yet. This file only reads the
// rows it was given.
//
// The owner's words: «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر … وساعتها
// هيظهر للخزنة فى شاشة استلام الخزينه نفس المحصنة … وهتكون باللون الاصفر عشان تعرف ان المحصنة مع
// القائد ولما الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة وعند العمليات», and in Round 10: «لو قائد تم
// الاستلام من القائد و لو العمليات تم الاستلام من العمليات وهتبقى صفر بس وهتكون ظاهره ل شاشة استلام
// الخزينة بس مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح».
import {
  OPERATIONS_SECURED_PICKED_UP_STAGES,
  OPERATIONS_SECURED_STAGES,
  type OperationsSecuredStage,
  type OperationsVaultQueueShipmentDto,
} from '@ecms/contracts';
import { rowTint } from './day-board';

/**
 * Where a queue row stands, as the vault sees it:
 *
 *   · `pickedUp` — somebody confirmed collecting it from the bank: the captain in the app
 *                  («تم الاستلام من القائد») or the Operations desk («تم الاستلام من العمليات»). It
 *                  is on its way to the vault. YELLOW — one colour for both, because for the vault
 *                  they are the same: its work, receivable now. The badge on the row says which.
 *   · `received` — the vault pressed ✓ (the receive form): it is in the vault, or has already left
 *                  it again for delivery. GREEN, «بالخزينة». It STAYS on the screen for the rest of
 *                  the day rather than vanishing under the treasurer's hand.
 *   · `awaiting` — nobody has confirmed collecting it yet (only listed with «الكل»). WHITE, «لم يتم
 *                  التسليم» — the stage's own words on the secured screen. FOR VIEWING ONLY since
 *                  Round 10: the vault cannot receive it until the captain or the desk confirms
 *                  the pickup («مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح»).
 *
 * Read from the shipment's STATUS first, then its stage: anything past `draft` has been received —
 * receiving is the only way out of `draft` — so a row received this morning and dispatched since
 * is still today's receipt, green.
 */
export type VaultQueueState = 'pickedUp' | 'received' | 'awaiting';

export const vaultQueueState = (
  row: Pick<OperationsVaultQueueShipmentDto, 'status' | 'securedStage'>,
): VaultQueueState =>
  row.status !== 'draft'
    ? 'received'
    : row.securedStage !== null && OPERATIONS_SECURED_PICKED_UP_STAGES.includes(row.securedStage)
      ? 'pickedUp'
      : 'awaiting';

/**
 * The row's colour — the SAME two tints the Operations boards use (`rowTint`): yellow once it is
 * collected (the board's captain-delivered yellow — the captain's pickup or the desk's alike),
 * green once the vault has it (the board's desk-confirmed green), none before either. One pair of
 * colours across the screens, so a yellow row means "collected, not yet confirmed by the next
 * hand" wherever it is read.
 */
export const vaultQueueTint = (state: VaultQueueState): string | undefined =>
  rowTint(state === 'received' ? 'desk' : state === 'pickedUp' ? 'captain' : 'none');

/**
 * A queue row's colour, from the row — what the board's `tintOf` is handed on this screen. Not the
 * stage's colour (`boardRowTint`): a row the vault received this morning and sent out since is
 * BLUE on the Operations boards («خرجت للتسليم») but stays GREEN here — on the vault's screen it
 * is today's receipt, the vault's ✓ done.
 */
export const vaultRowTint = (
  row: Pick<OperationsVaultQueueShipmentDto, 'status' | 'securedStage'>,
): string | undefined => vaultQueueTint(vaultQueueState(row));

/**
 * The stages the queue's «الحالة» filter offers — exactly the ones its rows can be in, in the
 * stages' own order. By default the yellow rows (`withCaptain`, `withOperations`) and today's
 * receipts, which may since have gone out (`dispatched`) or even been delivered (`completed`); with
 * «الكل», the ones nobody has collected yet (`awaitingPickup`) as well. Offering a stage the list
 * can never hold would be an answer that only ever empties the table.
 */
export const vaultQueueStages = (all: boolean): readonly OperationsSecuredStage[] =>
  all
    ? OPERATIONS_SECURED_STAGES
    : OPERATIONS_SECURED_STAGES.filter((stage) => stage !== 'awaitingPickup');

/**
 * May the vault press ✓ on this row — open the receive form? Exactly where the server takes it: a
 * shipment still outside the vault (`draft` — a second receipt is refused) that somebody has
 * collected (`OPERATIONS_SECURED_RECEIVABLE_STAGES` — a white row is refused with
 * `OPERATIONS_SECURED_NOT_PICKED_UP`). A white row under «الكل» is there to be SEEN («وهتكون ظاهره ل
 * شاشة استلام الخزينة بس مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح»).
 */
export const mayReceive = (
  row: Pick<OperationsVaultQueueShipmentDto, 'status' | 'securedStage'>,
): boolean => vaultQueueState(row) === 'pickedUp';

/** How many rows of each colour — the queue's legend says them. */
export const vaultQueueCounts = (
  rows: readonly Pick<OperationsVaultQueueShipmentDto, 'status' | 'securedStage'>[],
): Record<VaultQueueState, number> => {
  const counts: Record<VaultQueueState, number> = { pickedUp: 0, received: 0, awaiting: 0 };
  for (const row of rows) counts[vaultQueueState(row)] += 1;
  return counts;
};

/** The URL value of the «الكل» toggle — `?all=1`; anything else is the default queue. */
export const readVaultQueueAll = (params: URLSearchParams): boolean => params.get('all') === '1';
