// Has a shipment reached its bank? — the ONE reading of the captain's «تم التسليم» that the boards,
// «الشحنات المسلَّمة» (Round 33 B) and the receipt photo's lock all share.
//
// The captain's «تم التسليم» is the leg that reaches the DESTINATION — the pickup leg of a daily
// shipment, the delivery leg of a secured one (`deliveryLegOf`; a secured pickup leg delivers to the
// vault). A leg that predates OP-7 has no `executionStatus` at all; it has plainly not been started
// (execution.service's `statusOf`). Execution only moves forward, so once the leg is delivered — or
// completed after it — its `deliveredAt` stays the answer, even if the desk later reopens the
// shipment. Whether that counts as reaching the bank is the contract's rule
// (`isOperationsShipmentDeliveredToBank`: a محصنة must have left the vault for it too).
import {
  isOperationsReceiptPhotoAddable,
  isOperationsShipmentDeliveredToBank,
  isOperationsShipmentLocked,
  type OperationsExecutionStatus,
} from '@ecms/contracts';
import { deliveryLegOf } from './secured-stage';
import { operationsShipmentAssignmentRepository } from './shipment-assignment.repository';
import { type OperationsShipmentDoc } from './shipment.model';

/** When the captain confirmed «تم التسليم» on this leg, or null while he has not. */
export const legDeliveredAt = (
  leg:
    | { executionStatus?: OperationsExecutionStatus | null; deliveredAt?: Date | null }
    | null
    | undefined,
): Date | null => {
  const execution = leg?.executionStatus ?? 'pending';
  return execution === 'delivered' || execution === 'completed' ? (leg?.deliveredAt ?? null) : null;
};

type ShipmentFacts = Pick<OperationsShipmentDoc, '_id' | 'shipmentType' | 'status'>;

/** The shipment's own `captainDeliveredAt` — its destination leg read once. */
export const captainDeliveredAtOf = async (shipment: ShipmentFacts): Promise<Date | null> =>
  legDeliveredAt(
    await operationsShipmentAssignmentRepository.findByShipmentAndLeg(
      String(shipment._id),
      deliveryLegOf(shipment.shipmentType),
    ),
  );

/** `isOperationsShipmentDeliveredToBank`, for one stored shipment. */
export const isDeliveredToBank = async (shipment: ShipmentFacts): Promise<boolean> =>
  isOperationsShipmentDeliveredToBank({
    shipmentType: shipment.shipmentType,
    status: shipment.status,
    captainDeliveredAt: await captainDeliveredAtOf(shipment),
  });

/**
 * May a FIRST receipt photo go onto this stored shipment (`isOperationsReceiptPhotoAddable`)? An
 * unlocked one without a photo answers without a read; a locked محصنة reads its delivery leg.
 */
export const receiptPhotoAddable = async (
  shipment: ShipmentFacts & Pick<OperationsShipmentDoc, 'receiptImage'>,
): Promise<boolean> => {
  const hasReceiptImage = shipment.receiptImage != null;
  if (hasReceiptImage) return false;
  if (!isOperationsShipmentLocked(shipment)) return true;
  return isOperationsReceiptPhotoAddable({
    shipmentType: shipment.shipmentType,
    status: shipment.status,
    captainDeliveredAt: await captainDeliveredAtOf(shipment),
    hasReceiptImage,
  });
};
