// Where a secured (محصنة) shipment stands, and which of its legs a board row is about — Round 8.
//
// «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر … ولما الخزنة تدوس صح ساعتها
// هتبقى اخضر عند الخزنة وعند العمليات». The stage is DERIVED, never stored: it reads the shipment's own
// status and — since Round 10 — the shipment's ONE pickup record («ممكن القائد اللى يعمل صح انه استلم
// او العمليات»), so it can never disagree with either. Pure functions, so the rule has one spelling
// and a spec of its own, whatever screen colours the row.
import {
  OPERATIONS_PICKED_UP_EXECUTION_STATUSES,
  type OperationsExecutionStatus,
  type OperationsSecuredPickedUpBy,
  type OperationsSecuredStage,
  type OperationsShipmentLeg,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
} from '@ecms/contracts';
import { type OperationsShipmentPickup } from './shipment.model';

/**
 * Has the captain got the shipment in hand on this leg — his ✓ on collecting it in the mobile app?
 * A leg written before captain execution existed carries no `executionStatus` at all; it has
 * plainly not been started (the same reading as execution.service's `statusOf`).
 */
export const isPickedUp = (execution: OperationsExecutionStatus | null | undefined): boolean =>
  execution != null && OPERATIONS_PICKED_UP_EXECUTION_STATUSES.includes(execution);

/** Who confirmed collecting a secured shipment, and when — what its board row says. */
export interface SecuredPickup {
  by: OperationsSecuredPickedUpBy;
  /** Null only for a pre-Round-10 row read off a leg that was never stamped. */
  at: Date | null;
}

/**
 * THE PICKUP A SECURED SHIPMENT HAS — Round 10. The shipment's own record is the answer: the
 * captain's ✓ in the app and the desk's ✓ both write it, the desk's undo clears it to null (the
 * captain's included — «لو القائد عمل صح ممكن العمليات تشيلها»), and nothing else counts. The pickup
 * LEG is NOT read for a row that has a record, null included: an undone captain's ✓ stays undone
 * although his leg still says picked up — the leg is his execution record, not the shipment's.
 *
 * The one exception is a row whose record was NEVER WRITTEN (`undefined`: the field is absent,
 * which only a row from before Round 10 can be — the schema defaults every newer row to null).
 * Such a row reads as the captain's when its pickup leg is picked up, which is exactly what its
 * stage said before the record existed, so no row in flight changes colour on deploy.
 *
 * Why this and not a backfill migration: it is right for every row at every moment — a captain's ✓
 * recorded by the previous build while this one boots (two processes overlap on a deploy) is read
 * correctly with nothing to re-run — and it writes nothing at boot.
 */
export const securedPickupOf = (
  record: OperationsShipmentPickup | null | undefined,
  pickupLeg:
    | { executionStatus?: OperationsExecutionStatus | null; pickedUpAt?: Date | null }
    | null
    | undefined,
): SecuredPickup | null => {
  if (record === undefined) {
    return pickupLeg != null && isPickedUp(pickupLeg.executionStatus)
      ? { by: 'captain', at: pickupLeg.pickedUpAt ?? null }
      : null;
  }
  return record === null ? null : { by: record.by, at: record.at };
};

/**
 * The stage of a SECURED shipment. While it is still `draft` the vault has not received it, and
 * who confirmed the pickup tells the three draft stages apart: nobody yet (white), the captain
 * (yellow — «تم الاستلام من القائد») or the Operations desk (yellow too — «تم الاستلام من العمليات»).
 * From `inVault` on, the shipment's own status IS the stage — the vault's ✓, the dispatch and the
 * desk's completion ✓ each move it.
 */
export const securedStageOf = (
  status: OperationsShipmentStatus,
  pickup: SecuredPickup | null,
): OperationsSecuredStage => {
  if (status !== 'draft') return status;
  if (pickup === null) return 'awaitingPickup';
  return pickup.by === 'captain' ? 'withCaptain' : 'withOperations';
};

/**
 * The leg whose crew a board row prints — the leg the shipment is about RIGHT NOW.
 *
 *   · daily   → the pickup leg, always (its only leg — legacy car_num1/leader1).
 *   · secured → the PICKUP leg while it is still `draft` (the captain going to the bank, or carrying
 *               it to the vault), the DELIVERY leg from `inVault` on (legacy car_num2/leader2, the
 *               leg the captain report attributes it to). A shipment in the vault whose delivery is
 *               not crewed yet therefore shows no crew: nobody is taking it anywhere yet.
 */
export const crewLegOf = (
  shipmentType: OperationsShipmentType,
  status: OperationsShipmentStatus,
): OperationsShipmentLeg =>
  shipmentType === 'daily' || status === 'draft' ? 'pickup' : 'delivery';

/**
 * The leg whose captain «تم التسليم» (delivered to the destination) a row carries: the pickup leg
 * of a daily shipment, the DELIVERY leg of a secured one — whichever leg `crewLegOf` shows. A
 * secured pickup leg "delivers" into the vault, never to the destination branch.
 */
export const deliveryLegOf = (shipmentType: OperationsShipmentType): OperationsShipmentLeg =>
  shipmentType === 'daily' ? 'pickup' : 'delivery';
