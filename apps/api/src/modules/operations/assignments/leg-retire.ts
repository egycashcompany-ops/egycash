// Taking a delivery leg off its van — RETIRING it — in ONE place.
//
// Two acts take a secured shipment's delivery leg off its van:
//   · «توزيع المحصنات»'s «حفظ», when the desk takes the shipment off a van (secured/distribution.service.ts);
//   · an edit that moves the shipment's delivery date off the day its van rides, or clears it
//     (shipments/shipment.service.ts `update`). A leg is a captain and a van OF ONE OPERATING DAY:
//     left behind on the old day, it would stay on that captain's route in the app, and the
//     sequential lock could make it his "current" stop and hold back every stop after it.
// Both must leave the SAME trace — the row soft-deleted (who and which van kept, so «السجل» prints
// it as `crewRemoved`), the same audit row, the same `operations.shipmentAssignment.removed` event —
// and refuse a leg the captain has already started with the same coded 409. Two copies of that is
// how they would come to disagree, so both callers go through this file.
//
// It lives apart from both services on purpose: distribution.service imports shipment.service, so a
// helper in either one would close an import cycle.
import { ErrorCodes, OperationsEvents } from '@ecms/contracts';
import { Types, type ClientSession } from 'mongoose';
import { AppError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';

/**
 * Has the captain started this leg in the app? Then it is his: nobody else takes it off his van.
 * A leg written before execution existed has no `executionStatus` and has plainly not been started.
 */
export const isLegStarted = (leg: OperationsShipmentAssignmentDoc): boolean =>
  (leg.executionStatus ?? 'pending') !== 'pending';

/**
 * 409 `OPERATIONS_DISTRIBUTION_LEG_STARTED` — the leg's captain has started it, so it can be neither
 * moved nor taken off. The detail NAMES THE SHIPMENT (`field` 'shipmentId', `message` its id), the
 * shape the code is documented with, so the distribution screen can mark its card. `what` says what
 * was refused, for the log line.
 */
export const legStartedRefusal = (shipmentId: string, what: string): AppError =>
  new AppError(
    ErrorCodes.OPERATIONS_DISTRIBUTION_LEG_STARTED,
    409,
    `the captain has started shipment ${shipmentId}'s delivery in the app — ${what}`,
    { details: [{ field: 'shipmentId', code: 'SHIPMENT', message: shipmentId }] },
  );

/**
 * The write, inside the caller's transaction: the leg is RETIRED, not erased — the row keeps its
 * captain, van and day, and «السجل» reads it back. Guarded by the version the caller checked, so a
 * captain who starts the leg in between (his start bumps the version) fails the whole transaction
 * instead of losing his stop under him.
 */
export const retireLeg = async (
  leg: OperationsShipmentAssignmentDoc,
  meta: { by: string; at: Date; session: ClientSession },
): Promise<void> => {
  await operationsShipmentAssignmentRepository.updateById(
    String(leg._id),
    { isDeleted: true, deletedAt: meta.at, deletedBy: new Types.ObjectId(meta.by) },
    { by: meta.by, version: leg.__v, session: meta.session },
  );
};

/**
 * After the commit: the audit row «السجل» turns into `crewRemoved` (the captain and van it was on,
 * old → null) and the event the realtime topics and any listener read. `leg` is the row as it was
 * before it was retired.
 */
export const recordLegRetired = async (leg: OperationsShipmentAssignmentDoc): Promise<void> => {
  await auditService.record({
    entityRef: {
      moduleId: 'operations',
      entityType: 'shipmentAssignment',
      entityId: String(leg._id),
    },
    action: 'delete',
    changes: [
      { field: 'captainEmployeeId', old: String(leg.captainEmployeeId), new: null },
      { field: 'vehicleId', old: String(leg.vehicleId), new: null },
      { field: 'crewAssignmentId', old: String(leg.crewAssignmentId), new: null },
    ],
  });
  await emit(OperationsEvents.SecuredLegRemoved, {
    assignmentId: String(leg._id),
    shipmentId: String(leg.shipmentId),
    leg: leg.leg,
    captainEmployeeId: String(leg.captainEmployeeId),
    vehicleId: String(leg.vehicleId),
  });
};
