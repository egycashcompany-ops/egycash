// Reading a crew slot, in one place.
//
// A slot holds up to `CREW_SLOT_CAPACITY` people, so "who is the captain of this row?" is no
// longer a field read — it is a membership test, and a membership test written inline is a
// membership test that gets written differently in four places. These three functions are the
// only sanctioned way to look inside a slot; everything from the mobile day to the dispatch
// screen's captain check goes through them.
//
// The `?? []` in `slotIds` is not defensive noise. Rows written before `migrateCrewSlotsToArrays`
// ran have no list field at all, and a `lean()` read hands those back as `undefined` whatever the
// document type promises. Boot order makes that window small, not empty.
import { type Types } from 'mongoose';
import { type OperationsCrewAssignmentDoc } from './crew-assignment.model';

/** One slot as ids, in the order Operations entered them. */
export const slotIds = (ids: Types.ObjectId[] | undefined): string[] => (ids ?? []).map(String);

/**
 * Is this employee one of the row's captains?
 *
 * BOTH captains are captains. There is no first captain and no deputy — the business asked for two
 * captains on a vehicle, not for a captain and a stand-in — so this answers identically for either
 * of them, and every gate that used to compare against the single `captainEmployeeId` now asks
 * this instead.
 */
export const isCaptainOf = (
  crew: Pick<OperationsCrewAssignmentDoc, 'captainEmployeeIds'>,
  employeeId: string,
): boolean => slotIds(crew.captainEmployeeIds).includes(employeeId);

/** Everyone on the vehicle, all three slots flattened — the Q11 traversal. */
export const crewMembers = (
  crew: Pick<
    OperationsCrewAssignmentDoc,
    'captainEmployeeIds' | 'specialist1EmployeeIds' | 'specialist2EmployeeIds'
  >,
): string[] => [
  ...slotIds(crew.captainEmployeeIds),
  ...slotIds(crew.specialist1EmployeeIds),
  ...slotIds(crew.specialist2EmployeeIds),
];
