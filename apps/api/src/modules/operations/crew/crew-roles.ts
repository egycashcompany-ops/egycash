// Round 23 — who may take which slot, for both crew saves (the day's board and the standing crew).
//
// THE OWNER: «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى» — forbidden to put a
// captain in a specialist's slot or a specialist in the captain's, EXCEPT a captain-specialist, who
// may go anywhere. It replaces the Round-20 default the owner never asked for («a red specialist in
// a captain slot is marked, not refused») and the approved decision that requirement flags gate
// nothing — for the two ROLE flags only: «قائد» and «أخصائي». The other eight still gate nothing.
//
// ONE DEFINITION. What a person's flags make him (`crewRoleOf`) and which slot that role fits
// (`fitsCrewSlot`) live in the contracts, so the board that colours him, routes his drop and offers
// him in a slot's list cannot disagree with the save that refuses him. Somebody with NO
// requirements row is a specialist there too — the answer legacy gave an employee nobody ticked.
//
// ONLY A NEW SEAT IS CHECKED. Somebody already in that SAME slot of that SAME row before the save —
// seated before this rule, or before somebody changed his flags on «متطلبات الطاقم» — passes, as a
// row keeps a type that was archived after it was chosen and a person HR marked absent after he was
// planned. The planner can still save the row's other changes, and takes him out when he chooses;
// the board marks the seat. Moving him to another slot, or onto another row, is a new seat.
import {
  ErrorCodes,
  OPERATIONS_CREW_SLOTS,
  crewRoleOf,
  fitsCrewSlot,
  type OperationsCrewRole,
  type OperationsCrewSlot,
} from '@ecms/contracts';
import { AppError } from '../../../shared/errors';
import { operationsCrewRequirementsRepository } from './crew-requirements.repository';

/** A slot's field, on the save's rows and on the stored rows alike. */
export const CREW_SLOT_FIELD = {
  captain: 'captainEmployeeIds',
  specialist1: 'specialist1EmployeeIds',
  specialist2: 'specialist2EmployeeIds',
} as const satisfies Record<OperationsCrewSlot, string>;

/** A row of either save, as far as its slots go. */
export type CrewSlotsRow = {
  [field in (typeof CREW_SLOT_FIELD)[OperationsCrewSlot]]?: string[] | undefined;
};

/**
 * The roles of a save's people, in ONE read of the requirements. Nobody in the answer — no
 * requirements row — is a specialist (`crewRoleOf(null)`), so `roleIn` never needs a fallback of
 * its own.
 */
export const crewRolesOf = async (
  employeeIds: readonly string[],
): Promise<Map<string, OperationsCrewRole>> => {
  const rows = await operationsCrewRequirementsRepository.findByEmployees(employeeIds);
  return new Map(rows.map((row) => [String(row.employeeId), crewRoleOf(row)]));
};

export const roleIn = (roles: ReadonlyMap<string, OperationsCrewRole>, employeeId: string) =>
  roles.get(employeeId) ?? crewRoleOf(null);

/**
 * Refuse the first person a save NEWLY puts in a slot his role does not fit — a coded 422 naming
 * him (`NOT_A_CAPTAIN` in the captain's slot, `NOT_A_SPECIALIST` in a specialist's) and the row by
 * its place in the save (`ROW_INDEX`), so the board rings his chip on that row. `held(index, slot)`
 * is who sat in that slot of that row before the save: they pass unchecked (see the head).
 */
export const refuseWrongSlots = (
  rows: readonly CrewSlotsRow[],
  roles: ReadonlyMap<string, OperationsCrewRole>,
  held: (index: number, slot: OperationsCrewSlot) => readonly string[],
): void => {
  rows.forEach((row, index) => {
    for (const slot of OPERATIONS_CREW_SLOTS) {
      const already = new Set(held(index, slot));
      for (const employeeId of row[CREW_SLOT_FIELD[slot]] ?? []) {
        if (already.has(employeeId) || fitsCrewSlot(roleIn(roles, employeeId), slot)) continue;
        const asCaptain = slot === 'captain';
        throw new AppError(
          ErrorCodes.OPERATIONS_CREW_MEMBER_WRONG_SLOT,
          422,
          asCaptain
            ? `employee ${employeeId} is not a captain and cannot take a captain's slot`
            : `employee ${employeeId} is a captain only and cannot take a specialist's slot`,
          {
            details: [
              {
                field: 'employeeId',
                code: asCaptain ? 'NOT_A_CAPTAIN' : 'NOT_A_SPECIALIST',
                message: employeeId,
              },
              { field: 'rows', code: 'ROW_INDEX', message: String(index) },
            ],
          },
        );
      }
    }
  });
};
