// Where a stop lands in a captain's list for one day — in ONE place.
//
// This existed twice: as a private helper in `assignment.service.ts` for the pickup leg, and
// inline in `secured.service.ts` for the delivery leg. Two copies of "where does a stop land" is
// how they came to disagree — the pickup leg re-seated a stop when it changed captain and the
// delivery leg did not, which is precisely the defect this module was extracted to fix.
//
// `ux_day_captain_leg_sequence` makes (day, captain, leg, sequence) unique, so a stop that keeps a
// position belonging to a DIFFERENT captain's list either collides outright or lands at an
// arbitrary point in the new captain's order. Neither is a plan anybody wrote.
import { type ClientSession, type Types } from 'mongoose';
import { type OperationsShipmentLeg } from '@ecms/contracts';
import { operationsShipmentAssignmentRepository } from '../shipments/shipment-assignment.repository';

/** Next free position at the end of this captain-day-leg's list. */
export const nextSequence = async (
  operationsDayId: Types.ObjectId,
  captainEmployeeId: string,
  leg: OperationsShipmentLeg,
  session?: ClientSession,
): Promise<number> => {
  const existing = await operationsShipmentAssignmentRepository.findForCaptainDay(
    operationsDayId,
    captainEmployeeId,
    leg,
    session,
  );
  return existing.reduce((max, row) => Math.max(max, row.sequence), 0) + 1;
};
