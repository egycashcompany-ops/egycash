// The vault's receive queue («شاشة استلام الخزينه») — its client-side decisions as pure functions:
// what colour a row is, what its two status columns say, and whether the vault may receive it.
//
// WHICH ROWS are on the queue is the SERVER's rule (`GET /operations/secured/vault-queue`). Since
// Round 13 it is what the vault can receive NOW: every secured draft collected today or earlier
// (Cairo) — white or yellow — every yellow one whatever its day, and those received into the vault
// today; «الكل» adds the white ones booked for a later collection day. This file only reads the
// rows it was given.
//
// The owner's words: «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر … وساعتها
// هيظهر للخزنة فى شاشة استلام الخزينه نفس المحصنة … وهتكون باللون الاصفر عشان تعرف ان المحصنة مع
// القائد ولما الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة وعند العمليات», and in Round 13 — lifting
// Round 10's «مش هيقدر يعمل صح الا لما القائد او العمليات تبقى عامله صح»: «انا عايز الجدول بتاع
// استلام الخزينه يكون مكان الحاله عمودين … واستلام الخزينه ممكن تستلم يكون القائد معلمش التسليم، او
// ان العمليات معملتش التسليم والخزنه تستلم عادي».
import {
  OPERATIONS_SECURED_PICKED_UP_STAGES,
  type OperationsVaultQueueShipmentDto,
} from '@ecms/contracts';
import { cairoStamp } from './shipment-log';
import { rowTint, vaultHoldOf, vaultPickupOf } from './day-board';

/**
 * Where a queue row stands, as its COLOUR says it (one colour a row — the legend counts them):
 *
 *   · `pickedUp` — somebody confirmed collecting it from the bank: the captain in the app («تم
 *                  الاستلام من القائد») or the Operations desk («تم الاستلام من العمليات»), and the
 *                  vault has not received it yet. YELLOW — one colour for both, because for the
 *                  vault they are the same: in hand, on its way in. The pickup column says which.
 *   · `received` — the vault pressed ✓ (the receive form): it is in the vault, or has already left
 *                  it again for delivery. GREEN. It STAYS on the screen for the rest of the day
 *                  rather than vanishing under the treasurer's hand — whoever collected it, nobody
 *                  included (a receipt nobody handed over is green with «لم يتم الاستلام» beside it).
 *   · `awaiting` — nobody has confirmed collecting it and the vault has not received it. WHITE. Since
 *                  Round 13 it is receivable like a yellow row («والخزنه تستلم عادي»).
 *
 * Read from the shipment's STATUS first, then its stage: anything past `draft` has been received —
 * receiving is the only way out of `draft` — so a row received this morning and dispatched since
 * is still today's receipt, green. A draft is yellow in the two picked-up stages
 * (`OPERATIONS_SECURED_PICKED_UP_STAGES` — not the receivable ones, which are every draft now).
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
 * May the vault press ✓ on this row — open the receive form? Exactly where the server takes it
 * since Round 13: a shipment still outside the vault (`draft` — a second receipt is refused),
 * WHITE OR YELLOW (`OPERATIONS_SECURED_RECEIVABLE_STAGES` is every draft stage): «واستلام الخزينه
 * ممكن تستلم يكون القائد معلمش التسليم، او ان العمليات معملتش التسليم والخزنه تستلم عادي». A receipt
 * of a white row records no pickup — its «حالة الاستلام» stays «لم يتم الاستلام».
 */
export const mayReceive = (row: Pick<OperationsVaultQueueShipmentDto, 'status'>): boolean =>
  row.status === 'draft';

/** How many rows of each colour — the queue's legend says them. */
export const vaultQueueCounts = (
  rows: readonly Pick<OperationsVaultQueueShipmentDto, 'status' | 'securedStage'>[],
): Record<VaultQueueState, number> => {
  const counts: Record<VaultQueueState, number> = { pickedUp: 0, received: 0, awaiting: 0 };
  for (const row of rows) counts[vaultQueueState(row)] += 1;
  return counts;
};

/**
 * The legend's chips, in the order a محصنة goes through them — white, yellow, green — every one of
 * them on the default list since Round 13 (a white row collected today is the vault's work too).
 */
export const VAULT_LEGEND: readonly VaultQueueState[] = ['awaiting', 'pickedUp', 'received'];

/**
 * A stamp under a status badge, in the board's figures (the Cairo clock, Latin digits): the time
 * alone when it is TODAY — every receipt on this screen is, and most pickups — and the day before
 * it otherwise, so a pickup confirmed yesterday and still not in the vault says so. Two short
 * columns now share «الحالة»'s width, which a full day on every row would not fit.
 */
export const queueStampText = (iso: string, today: string): string => {
  const { day, time } = cairoStamp(iso);
  return day === today && time !== '' ? time : time === '' ? day : `${day} ${time}`;
};

/**
 * «حالة الاستلام» — the first of the two columns: who confirmed collecting it from the bank, and
 * when — or nobody (`at` null). Read from the shipment's ONE pickup record (`pickedUpBy`), never
 * from its stage: past `draft` the stage is where the vault has it, and only the record still says
 * who collected it («لم يتم الاستلام» for good on a receipt nobody handed over).
 */
export const vaultPickupCell = (
  row: Pick<OperationsVaultQueueShipmentDto, 'pickedUpBy' | 'pickedUpAt'>,
): { by: ReturnType<typeof vaultPickupOf>; at: string | null } => {
  const by = vaultPickupOf(row);
  return { by, at: by === 'none' ? null : row.pickedUpAt };
};

/**
 * «حالة الخزينة» — the second column: received yet or not, where it is since, and WHEN the vault
 * received it (`vaultReceivedAt`, set on every row past `draft`; null on a draft).
 */
export const vaultHoldCell = (
  row: Pick<OperationsVaultQueueShipmentDto, 'status'> &
    Partial<Pick<OperationsVaultQueueShipmentDto, 'vaultReceivedAt'>>,
): { hold: ReturnType<typeof vaultHoldOf>; at: string | null } => {
  const hold = vaultHoldOf(row);
  return { hold, at: hold === 'waiting' ? null : (row.vaultReceivedAt ?? null) };
};

/** The URL value of the «الكل» toggle — `?all=1`; anything else is the default queue. */
export const readVaultQueueAll = (params: URLSearchParams): boolean => params.get('all') === '1';
