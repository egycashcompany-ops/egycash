// Who can carry a secured load, as the dispatch screen has to offer it.
//
// The vault screen picks ONE crew row and ONE captain, because that is what the two acts take: a
// delivery leg has exactly one captain (`operations_shipment_assignments.captainEmployeeId` is a
// required scalar — one leg, one person answerable for it), while the crew row it rides may now
// carry two.
//
// Two captains on a vehicle therefore produce TWO options, not one option with a hidden choice.
// The alternative — offer the vehicle and silently take the first captain — would have made the
// screen quietly pick which of two people is answerable for a van full of cash, which is exactly
// the kind of decision a UI must not make on an operator's behalf.
import { type OperationsCrewBoardRowDto } from '@ecms/contracts';

export interface DispatchCrewOption {
  /** `crewAssignmentId:captainEmployeeId` — stable, and enough to reconstruct both halves. */
  key: string;
  crewAssignmentId: string;
  captainEmployeeId: string;
  vehicleId: string;
  vehicleCode: string;
}

/**
 * One option per (crew row, captain). Rows with NO captain are dropped: a delivery leg needs a
 * captain, so a captainless vehicle is not dispatchable — the same filter the screen has always
 * applied, now expressed as "produces no options" instead of "fails the null check".
 */
export const dispatchCrewOptions = (
  rows: readonly OperationsCrewBoardRowDto[],
): DispatchCrewOption[] =>
  rows.flatMap((row) =>
    (row.crew?.captainEmployeeIds ?? []).map((captainEmployeeId) => ({
      key: `${row.crew?.id ?? ''}:${captainEmployeeId}`,
      crewAssignmentId: row.crew?.id ?? '',
      captainEmployeeId,
      vehicleId: row.vehicleId,
      vehicleCode: row.vehicleCode,
    })),
  );

export const findDispatchOption = (
  options: readonly DispatchCrewOption[],
  key: string,
): DispatchCrewOption | undefined => options.find((option) => option.key === key);
