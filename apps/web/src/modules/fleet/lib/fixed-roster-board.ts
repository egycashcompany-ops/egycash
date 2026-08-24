// The fixed-crew board as DATA — every rule of a drag, with no DOM anywhere near it.
//
// Drag-and-drop is an interaction; what a drop MEANS is arithmetic, and the arithmetic is where
// a board goes wrong: a driver silently ending up on two cars, a move that releases nobody, a
// save that sends the receiving row and forgets the row it took from. None of that is visible
// from a rendered card, and the web suite has no DOM to click one with — so the rules live here,
// as pure functions over rows, and the components below only call them.
//
// The two rules are the ones the server already enforces, restated so the UI cannot propose a
// board the API would refuse: one person may not hold both slots of a vehicle, and one driver
// belongs to one crew. A drop therefore always REMOVES the driver from wherever they were —
// including the other slot of the same car — before placing them.
import { type FleetFixedCrewRowDto } from '@ecms/contracts';

export type CrewSlot = 'driver1EmployeeId' | 'driver2EmployeeId';

export const CREW_SLOTS: readonly CrewSlot[] = ['driver1EmployeeId', 'driver2EmployeeId'];

/** Where a driver currently sits, or `null` when they sit nowhere. */
export const findSeat = (
  rows: readonly FleetFixedCrewRowDto[],
  employeeId: string,
): { vehicleId: string; slot: CrewSlot } | null => {
  for (const row of rows) {
    for (const slot of CREW_SLOTS) {
      if (row[slot] === employeeId) return { vehicleId: row.vehicleId, slot };
    }
  }
  return null;
};

/**
 * Put `employeeId` in one slot of one vehicle, and take them out of everywhere else.
 *
 * "Everywhere else" is the whole point. Dropping the same person into the second slot of the car
 * they already lead is a MOVE between slots, not a duplication; dropping them onto another car
 * releases the first. Either way the board that comes back is one the server will accept, and
 * both touched rows differ from the saved board, so both travel on the next save.
 */
export const assignDriver = (
  rows: readonly FleetFixedCrewRowDto[],
  vehicleId: string,
  slot: CrewSlot,
  employeeId: string,
): FleetFixedCrewRowDto[] =>
  rows.map((row) => {
    const cleared: FleetFixedCrewRowDto = {
      ...row,
      driver1EmployeeId: row.driver1EmployeeId === employeeId ? null : row.driver1EmployeeId,
      driver2EmployeeId: row.driver2EmployeeId === employeeId ? null : row.driver2EmployeeId,
    };
    return row.vehicleId === vehicleId ? { ...cleared, [slot]: employeeId } : cleared;
  });

/** Empty one slot. The other slot, and every other row, is left exactly as it was. */
export const clearSlot = (
  rows: readonly FleetFixedCrewRowDto[],
  vehicleId: string,
  slot: CrewSlot,
): FleetFixedCrewRowDto[] =>
  rows.map((row) => (row.vehicleId === vehicleId ? { ...row, [slot]: null } : row));

/**
 * The rows whose CREW differs from the saved board — the save payload, and nothing more.
 *
 * A move changes two rows and sends two, which is what lets the server check exclusivity against
 * the end state instead of guessing. A row whose crew is untouched is not sent at all: an
 * unchanged row is a no-op server-side, and sending the whole fleet to move one person would
 * make every save look like a rewrite in the audit trail.
 */
export const changedRows = (
  saved: readonly FleetFixedCrewRowDto[],
  draft: readonly FleetFixedCrewRowDto[],
): { vehicleId: string; driver1EmployeeId: string | null; driver2EmployeeId: string | null }[] => {
  const before = new Map(saved.map((row) => [row.vehicleId, row]));
  return draft
    .filter((row) => {
      const was = before.get(row.vehicleId);
      // A row the saved board never had counts as changed only if it actually holds somebody.
      if (was === undefined)
        return row.driver1EmployeeId !== null || row.driver2EmployeeId !== null;
      return (
        was.driver1EmployeeId !== row.driver1EmployeeId ||
        was.driver2EmployeeId !== row.driver2EmployeeId
      );
    })
    .map((row) => ({
      vehicleId: row.vehicleId,
      driver1EmployeeId: row.driver1EmployeeId,
      driver2EmployeeId: row.driver2EmployeeId,
    }));
};

/** Is there anything to save? The unsaved-changes banner and the save button both ask this. */
export const isDirty = (
  saved: readonly FleetFixedCrewRowDto[],
  draft: readonly FleetFixedCrewRowDto[],
): boolean => changedRows(saved, draft).length > 0;
