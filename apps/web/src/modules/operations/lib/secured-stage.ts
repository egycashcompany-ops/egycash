// Where a محصنة stands, as a board row shows it — the «الحالة» cell's words and the row's colour —
// and what may be done to it from a board. Pure, so each rule is pinned in a spec.
//
// THE OWNER'S STAGES: «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر … ولما
// الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة وعند العمليات وفى اللحظه دى المحصنة هتبقى موجوده فى
// صرف الخزينه», and in Round 10: «ممكن القائد اللى يعمل صح انه استلم او العمليات ف لو قائد تم الاستلام
// من القائد و لو العمليات تم الاستلام من العمليات وهتبقى صفر». The stage is the SERVER's
// (`securedStage` on every board row, derived from the shipment's status and its ONE pickup record —
// `OPERATIONS_SECURED_STAGES`, `pickedUpBy`); this file only says how a screen draws it:
//
//   awaitingPickup  «لم يتم التسليم»            white   — nobody has confirmed collecting it
//   withCaptain     «تم الاستلام من القائد»     YELLOW  — the captain's ✓ in the mobile app
//   withOperations  «تم الاستلام من العمليات»   YELLOW  — the desk's ✓ on the secured screen
//   inVault         «بالخزينة»                  GREEN   — the vault's ✓ (its receive form)
//   dispatched      «خرجت للتسليم»              BLUE    — it left the vault with its delivery crew
//   completed       «تم التسليم»                GREEN   — the desk confirmed the delivery
//
// The yellow and the green are the daily rows' own shades (`rowTint`): yellow is "collected, the
// next hand has not confirmed yet" on both kinds of row — whoever collected it, the captain or the
// desk, because the vault does the same with either — and green "confirmed". A dispatched row is
// neither — the money is on the road — so it takes the badge's own blue (`info`), which neither the
// daily rows nor the other stages use.
//
// ONE EXCEPTION, KEPT FROM BEFORE THE STAGES: a dispatched محصنة whose DELIVERY captain has pressed
// «تم التسليم» in the mobile app (`captainDeliveredAt`) reads as a daily row the captain delivered —
// «تم التسليم» on a yellow row — until the desk's ✓ turns it green. That is the day board's own rule
// («لو تم التسليم من القائد من برا الحالة هتكون تم التسليم بس الصف لونه اصفر ولما ادوس انا على صح من
// عندى يبقى الصف اخضر»), and the one sign the desk has of WHICH محصنة is waiting for its ✓. Its stage
// is still `dispatched` (the server's), so the secured screen's «خرجت للتسليم» filter still finds it.
//
// WHAT A BOARD OFFERS ON A ROW (Round 10) — each the server's own rule, so a screen never offers an
// act the server would refuse:
//
//   · the desk's pickup ✓ and its undo (`pickupToggleOf`) — on a secured DRAFT row only: ✓ while
//     nobody has confirmed the pickup, undo once somebody has, the captain included («لو القائد عمل
//     صح ممكن العمليات تشيلها بس لو العمليات عملت صح القائد مينفعش يشيلها» — the captain's app has no
//     undo, the desk has both);
//   · the LOCK (`isLockedRow`) — «الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد من القادة او
//     العمليات او الخزنه يعدل عليها»: from the vault's ✓ on, no edit, no delete, no receipt photo;
//   · the cancelled receipt (`offersReceiptCancel`) — «بس صلاحية خاصة تقدر تلغى استلام الخزينة»: only
//     while the محصنة is IN the vault, not once it has left it.
import {
  OPERATIONS_RECEIPT_CANCEL_REASON_MAX,
  OPERATIONS_RECEIPT_CANCEL_REASON_MIN,
  isOperationsShipmentLocked,
  type OperationsDayBoardShipmentDto,
  type OperationsSecuredStage,
  type OperationsShipmentDto,
} from '@ecms/contracts';
import { boardDelivery, rowTint } from './day-board';

/** The row colour of each stage — undefined is no colour (a white row). */
export const SECURED_STAGE_TINT: Record<OperationsSecuredStage, string | undefined> = {
  awaitingPickup: undefined,
  withCaptain: rowTint('captain'),
  // The same yellow whoever confirmed the pickup: «وهتبقى صفر بس» — the vault receives either.
  withOperations: rowTint('captain'),
  inVault: rowTint('desk'),
  dispatched: '!bg-sky-50 dark:!bg-sky-400/10',
  completed: rowTint('desk'),
};

/** What a board row reads its colour and its «الحالة» from — the stage when it has one. */
type BoardStatusRow = Pick<OperationsShipmentDto, 'shipmentType' | 'status'> &
  Partial<Pick<OperationsDayBoardShipmentDto, 'captainDeliveredAt' | 'securedStage'>>;

/**
 * The stage a board row's «الحالة» shows, or null when it shows who delivered it instead
 * (`DeliveryStatusBadge`): a daily row, a row the server sent no stage for (an older server), and
 * a dispatched محصنة its delivery captain has delivered from the app — «تم التسليم» on a yellow row,
 * as a daily row the captain delivered reads (see the exception at the top of this file).
 */
export const shownStage = (row: BoardStatusRow): OperationsSecuredStage | null =>
  row.securedStage == null || (row.securedStage === 'dispatched' && row.captainDeliveredAt != null)
    ? null
    : row.securedStage;

/**
 * A board row's colour, on every board: a SECURED row by its stage (`SECURED_STAGE_TINT`), a daily
 * row by who delivered it (`rowTint(boardDelivery(row))` — yellow for the crew captain, green for
 * the desk). Whatever `shownStage` gives no stage to keeps the daily rule — so a dispatched محصنة
 * its delivery captain has delivered is yellow, as its cell says «تم التسليم».
 */
export const boardRowTint = (row: BoardStatusRow): string | undefined => {
  const stage = shownStage(row);
  return stage !== null ? SECURED_STAGE_TINT[stage] : rowTint(boardDelivery(row));
};

/**
 * The stages the SECURED SCREEN can show, in their order — what its «الحالة» filter offers. Not
 * `completed`: the screen lists every secured shipment NOT yet completed (the legacy /mohsana
 * backlog), so a completed one is never on it, and a filter answer that can only ever empty the
 * table is not worth offering.
 */
export const SECURED_SCREEN_STAGES: readonly OperationsSecuredStage[] = [
  'awaitingPickup',
  'withCaptain',
  'withOperations',
  'inVault',
  'dispatched',
];

/**
 * Does a board offer the ✓ («تأكيد التسليم», and its undo) on this row? Exactly where the server
 * accepts it (`shipment-status.ts`): a daily shipment completes from `draft` and reopens from
 * `completed`; a SECURED one completes only from `dispatched` — it left the vault with its delivery
 * crew — and reopens only from `completed`, back to `dispatched`. Before it leaves the vault its
 * steps are other acts — the pickup ✓ (the captain's in the app, or the desk's own on the secured
 * screen, `pickupToggleOf`), the vault's receive, the vault's dispatch — so a delivery ✓ there could
 * only be refused (`OPERATIONS_INVALID_SHIPMENT_TRANSITION`). Offering none on
 * a dispatched one would leave it with no way to be completed at all: the desk's ✓ is the only act
 * that completes a محصنة, as legacy's main_ops receive was.
 */
export const offersDeliveryToggle = (
  row: Pick<OperationsShipmentDto, 'shipmentType' | 'status'>,
): boolean =>
  row.shipmentType === 'daily' || row.status === 'dispatched' || row.status === 'completed';

/**
 * Is this row LOCKED — the vault has received it, so nobody edits it any more? Exactly the server's
 * rule (`isOperationsShipmentLocked`, the contract's one function, read by the API's lock as well):
 * a SECURED shipment whose status is past `draft` — in the vault, on the road or delivered. A daily
 * shipment is never locked. On a locked row a board offers no edit, no delete and no receipt-photo
 * upload, replace or delete (the photo can still be looked at); the server refuses each of them with
 * `OPERATIONS_SECURED_LOCKED` all the same, for a screen that was read before the vault's ✓.
 */
export const isLockedRow = (row: Pick<OperationsShipmentDto, 'shipmentType' | 'status'>): boolean =>
  isOperationsShipmentLocked(row);

/**
 * The desk's pickup ✓ on a row of the secured screen, as a toggle — which way a click goes, or null
 * where it is not offered:
 *
 *   'confirm'  a secured DRAFT row nobody has collected yet (white): the desk confirms collecting it
 *              — «تم الاستلام من العمليات», the row turns yellow (`POST /operations/secured/:id/pickup`);
 *   'undo'     a secured DRAFT row somebody has collected (yellow) — the desk's own ✓ OR the
 *              captain's from the app: the desk takes it back and the row turns white again
 *              (`DELETE …/pickup`). Never the other way round: the captain's app has no undo;
 *   null       a daily row, and a secured one the vault has received — the ✓ can be taken back only
 *              UNTIL the vault receives (`isLockedRow`), and the server answers `OPERATIONS_SECURED_LOCKED`.
 *
 * Read from `pickedUpBy`, the shipment's one pickup record — the field the stage is derived from.
 */
export const pickupToggleOf = (
  row: Pick<OperationsDayBoardShipmentDto, 'shipmentType' | 'status' | 'pickedUpBy'>,
): 'confirm' | 'undo' | null => {
  if (row.shipmentType !== 'secured' || row.status !== 'draft') return null;
  return row.pickedUpBy == null ? 'confirm' : 'undo';
};

/**
 * May the vault's receipt of this row be cancelled (`POST /operations/secured/:id/cancel-receipt`,
 * under `operationsVault.cancelReceipt`)? Only while the محصنة is IN the vault: one dispatched or
 * delivered has left it, and the server answers `OPERATIONS_SECURED_NOT_IN_VAULT`.
 */
export const offersReceiptCancel = (
  row: Pick<OperationsShipmentDto, 'shipmentType' | 'status'>,
): boolean => row.shipmentType === 'secured' && row.status === 'inVault';

/**
 * What is wrong with a cancelled receipt's reason, or null when the server will take it — its own
 * bounds (`CancelVaultReceiptSchema`: trimmed, `OPERATIONS_RECEIPT_CANCEL_REASON_MIN` to `…_MAX`
 * characters). The reason is REQUIRED: undoing the treasury's signature is said in words, and the
 * words stay in «السجل» for every reader.
 */
export const receiptCancelReasonProblem = (reason: string): 'short' | 'long' | null => {
  const length = reason.trim().length;
  if (length < OPERATIONS_RECEIPT_CANCEL_REASON_MIN) return 'short';
  if (length > OPERATIONS_RECEIPT_CANCEL_REASON_MAX) return 'long';
  return null;
};
