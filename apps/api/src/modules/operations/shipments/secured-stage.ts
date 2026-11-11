// Where a secured (محصنة) shipment stands, and which of its legs a board row is about — Round 8.
//
// «لما القائد هيستلم من البنك ويعمل علامة صح هيبقى الصف باللون الاصفر … ولما الخزنة تدوس صح ساعتها
// هتبقى اخضر عند الخزنة وعند العمليات». The stage is DERIVED, never stored: it reads the shipment's own
// status and its pickup leg's captain execution, so it can never disagree with either of them. Pure
// functions, so the rule has one spelling and a spec of its own, whatever screen colours the row.
import {
  OPERATIONS_PICKED_UP_EXECUTION_STATUSES,
  type OperationsExecutionStatus,
  type OperationsSecuredStage,
  type OperationsShipmentLeg,
  type OperationsShipmentStatus,
  type OperationsShipmentType,
} from '@ecms/contracts';

/**
 * Has the captain got the shipment in hand on this leg — his ✓ on collecting it in the mobile app?
 * A leg written before captain execution existed carries no `executionStatus` at all; it has
 * plainly not been started (the same reading as execution.service's `statusOf`).
 */
export const isPickedUp = (execution: OperationsExecutionStatus | null | undefined): boolean =>
  execution != null && OPERATIONS_PICKED_UP_EXECUTION_STATUSES.includes(execution);

/**
 * The stage of a SECURED shipment. While it is still `draft` the vault has not received it, and
 * the pickup leg's execution tells the two draft stages apart: not collected yet (white) or with
 * the captain on his way to the vault (yellow). From `inVault` on, the shipment's own status IS
 * the stage — the vault's ✓, the dispatch and the desk's ✓ each move it.
 */
export const securedStageOf = (
  status: OperationsShipmentStatus,
  pickupExecution: OperationsExecutionStatus | null | undefined,
): OperationsSecuredStage => {
  if (status === 'draft') return isPickedUp(pickupExecution) ? 'withCaptain' : 'awaitingPickup';
  return status;
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
