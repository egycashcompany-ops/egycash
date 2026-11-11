// Where a محصنة stands, as a board row shows it — the «الحالة» cell's words and the row's colour —
// and what may be done to it from a board. Pure, so each rule is pinned in a spec.
//
// THE OWNER'S STAGES: «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر … ولما
// الخزنة تدوس صح ساعتها هتبقى اخضر عند الخزنة وعند العمليات وفى اللحظه دى المحصنة هتبقى موجوده فى
// صرف الخزينه». The stage is the SERVER's (`securedStage` on every board row, derived from the
// shipment's status and its pickup leg's captain execution — `OPERATIONS_SECURED_STAGES`); this file
// only says how a screen draws it:
//
//   awaitingPickup  «لم يتم التسليم»          white   — no captain has collected it from the bank
//   withCaptain     «تم الاستلام من القائد»   YELLOW  — the captain's ✓ in the mobile app
//   inVault         «بالخزينة»                GREEN   — the vault's ✓ (its receive form)
//   dispatched      «خرجت للتسليم»            BLUE    — it left the vault with its delivery crew
//   completed       «تم التسليم»              GREEN   — the desk confirmed the delivery
//
// The yellow and the green are the daily rows' own shades (`rowTint`): yellow is "the captain has
// it, the next hand has not confirmed yet" on both kinds of row, green "confirmed". A dispatched
// row is neither — the money is on the road — so it takes the badge's own blue (`info`), which
// neither the daily rows nor the other stages use.
//
// ONE EXCEPTION, KEPT FROM BEFORE THE STAGES: a dispatched محصنة whose DELIVERY captain has pressed
// «تم التسليم» in the mobile app (`captainDeliveredAt`) reads as a daily row the captain delivered —
// «تم التسليم» on a yellow row — until the desk's ✓ turns it green. That is the day board's own rule
// («لو تم التسليم من القائد من برا الحالة هتكون تم التسليم بس الصف لونه اصفر ولما ادوس انا على صح من
// عندى يبقى الصف اخضر»), and the one sign the desk has of WHICH محصنة is waiting for its ✓. Its stage
// is still `dispatched` (the server's), so the secured screen's «خرجت للتسليم» filter still finds it.
import {
  type OperationsDayBoardShipmentDto,
  type OperationsSecuredStage,
  type OperationsShipmentDto,
} from '@ecms/contracts';
import { boardDelivery, rowTint } from './day-board';

/** The row colour of each stage — undefined is no colour (a white row). */
export const SECURED_STAGE_TINT: Record<OperationsSecuredStage, string | undefined> = {
  awaitingPickup: undefined,
  withCaptain: rowTint('captain'),
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
  'inVault',
  'dispatched',
];

/**
 * Does a board offer the ✓ («تأكيد التسليم», and its undo) on this row? Exactly where the server
 * accepts it (`shipment-status.ts`): a daily shipment completes from `draft` and reopens from
 * `completed`; a SECURED one completes only from `dispatched` — it left the vault with its delivery
 * crew — and reopens only from `completed`, back to `dispatched`. Before it leaves the vault its
 * steps are other hands' — the captain's ✓ in the app, the vault's receive, the vault's dispatch —
 * so a ✓ there could only be refused (`OPERATIONS_INVALID_SHIPMENT_TRANSITION`). Offering none on
 * a dispatched one would leave it with no way to be completed at all: the desk's ✓ is the only act
 * that completes a محصنة, as legacy's main_ops receive was.
 */
export const offersDeliveryToggle = (
  row: Pick<OperationsShipmentDto, 'shipmentType' | 'status'>,
): boolean =>
  row.shipmentType === 'daily' || row.status === 'dispatched' || row.status === 'completed';
