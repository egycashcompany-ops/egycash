// Round 24 — a crew row GIVEN A VAN, and the legs riding it taking that van, in ONE place.
//
// «عاوز لو عربيه من غير كود عادى تظهر ان اوزع عليها محصنات»: a row without a van may carry محصنات
// (delivery legs with `vehicleId` null). When «لوحة التشغيلة» later gives that SAME row a van
// (crew.service.ts `plan`, «X takes V»), every live leg on the row must name the van too — a leg
// copies its row's van (legacy `car_num1/2`), and the captain's app, the boards and the reports read
// it there. The write runs inside the board's own transaction; the trace (one audit row per leg,
// which the shipment's «السجل» prints as `crewChanged`, and the assignment event the boards and the
// captain's app refresh on) follows its commit, as every Operations write does.
//
// It lives with the legs, not in the crew service: a leg's own fields (its captain, its shipment)
// are the assignments' to read and announce, and the crew module reads none of them.
import { OperationsEvents } from '@ecms/contracts';
import { type ClientSession, type Types } from 'mongoose';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { vehicleIdOf } from '../crew/crew-assignment.model';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';

/** One leg that took its row's van — before and after, for the trace after the commit. */
export interface LegVanChange {
  before: OperationsShipmentAssignmentDoc;
  after: OperationsShipmentAssignmentDoc;
}

/**
 * Inside the caller's transaction: every LIVE leg on the crew row — delivered, started or not —
 * takes `vehicleId`. Each write is version-guarded against the leg as this transaction read it, so
 * a captain acting on one in between fails the whole save rather than racing it.
 */
export const moveRowLegsToVan = async (
  crewAssignmentId: string,
  vehicleId: Types.ObjectId | null,
  meta: { by: string; session: ClientSession },
): Promise<LegVanChange[]> => {
  const changes: LegVanChange[] = [];
  for (const leg of await operationsShipmentAssignmentRepository.findLiveByCrew(
    crewAssignmentId,
    meta.session,
  )) {
    const after = await operationsShipmentAssignmentRepository.updateById(
      String(leg._id),
      { vehicleId },
      { by: meta.by, version: leg.__v, session: meta.session },
    );
    changes.push({ before: leg, after });
  }
  return changes;
};

/** After the commit: one audit row on each leg («السجل» → `crewChanged`), and its event. */
export const recordLegVanChanges = async (changes: readonly LegVanChange[]): Promise<void> => {
  for (const { before, after } of changes) {
    await auditService.record({
      entityRef: {
        moduleId: 'operations',
        entityType: 'shipmentAssignment',
        entityId: String(after._id),
      },
      action: 'update',
      changes: diffChanges({ vehicleId: vehicleIdOf(before) }, { vehicleId: vehicleIdOf(after) }),
    });
    await emit(OperationsEvents.SecuredLegAssigned, {
      assignmentId: String(after._id),
      shipmentId: String(after.shipmentId),
      leg: after.leg,
      captainEmployeeId: String(after.captainEmployeeId),
      vehicleId: vehicleIdOf(after),
    });
  }
};
