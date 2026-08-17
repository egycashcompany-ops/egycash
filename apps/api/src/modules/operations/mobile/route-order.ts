// THE captain's ordered day — one definition, used by the mobile read (OP-6) and by the sequential
// execution lock (OP-7).
//
// This file exists so those two can never disagree. If the read sorted one way and the lock
// another, a captain would be shown an unlocked stop the server then refuses to start — the exact
// class of bug that makes a sequential workflow untrustworthy.
//
// The order is PR 5's persisted `sequence`. Nothing here computes, invents or stores an ordering:
// this is a read and a sort, and `sequence` remains the only ordering mechanism in the module.
//
// Why the tie-break: `sequence` is unique per (day, captain, LEG), so a captain carrying both a
// collection and a secured delivery run can legitimately hold two stops numbered 1. `leg` breaks
// that tie deterministically ('delivery' before 'pickup' alphabetically) — the point is not which
// leg wins but that both surfaces agree on a total order, every time, for the same input.
import { type Types } from 'mongoose';
import { type ClientSession } from 'mongoose';
import { type OperationsShipmentLeg } from '@ecms/contracts';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';
import { type OperationsShipmentAssignmentDoc } from '../shipments/shipment-assignment.model';

const LEGS: OperationsShipmentLeg[] = ['pickup', 'delivery'];

export const compareStops = (
  a: OperationsShipmentAssignmentDoc,
  b: OperationsShipmentAssignmentDoc,
): number => a.sequence - b.sequence || a.leg.localeCompare(b.leg);

/** Every stop the captain holds that day, across both legs, in the one canonical order. */
export const orderedCaptainRoute = async (
  operationsDayId: Types.ObjectId | string,
  captainEmployeeId: string,
  session?: ClientSession,
): Promise<OperationsShipmentAssignmentDoc[]> => {
  const rows: OperationsShipmentAssignmentDoc[] = [];
  for (const leg of LEGS) {
    rows.push(
      ...(await operationsShipmentAssignmentRepository.findForCaptainDay(
        operationsDayId,
        captainEmployeeId,
        leg,
        session,
      )),
    );
  }
  return rows.sort(compareStops);
};
