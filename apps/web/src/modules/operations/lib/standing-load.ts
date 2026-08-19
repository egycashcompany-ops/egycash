// The toggle that puts the standing crew on the day's board — as pure state transitions.
//
// "Toggle Switch ... الـ Default بتاعه انه مش متفعل والسيارات فاضية .. لو اتفعل يحمل الأطقم الثابته
//  على السيارات المتاحه" — off by default with the vehicles empty; on, it loads the standing crews
// onto the available vehicles.
//
// IT EDITS THE DRAFT, IT DOES NOT WRITE. That is what makes a toggle a toggle: the board has always
// been edited locally and saved explicitly — "a drag is not a write" — and a control that wrote to
// the server could not be switched back off. Loading, reviewing and then saving is one gesture the
// operator already knows.
//
// TWO RULES DECIDE WHAT GETS FILLED.
//
//   1. ONLY AN EMPTY VEHICLE. A vehicle that already carries anybody — saved this morning or just
//      dragged by hand — is left exactly as it is. The toggle can never overwrite visible work,
//      which is also what makes turning it off safe: it only ever clears what it put there.
//
//   2. NOBODY TWICE. A standing crew member already on the board stays where they are and is not
//      copied onto a second vehicle. Q11 (one person, one vehicle per operating day) is a domain
//      rule the save would refuse, so the board must not offer a plan that breaks it.
//
// AND A VEHICLE THAT IS NOT ON TODAY'S BOARD IS NOT A FAILURE. "لو فى طاقم على سيارة والسيارة مش
// متاحه سيب الطاقم بدون تحميله على سيارة" — the board lists only the vehicles Fleet rostered for
// the date, so a standing crew whose van is in the yard today has nowhere to go. Its people are
// left in the pool, free to be dragged onto whatever IS out, rather than forced somewhere wrong or
// silently swallowed. `unavailableVehicleIds` is what lets the screen say so.
import { CREW_SLOTS, SLOT_POSITIONS, rowCrew, type BoardRow, type SlotCells } from './crew-board';

/** One standing row, reduced to what the load needs. */
export interface StandingCrewSource {
  vehicleId: string;
  captainEmployeeIds: string[];
  specialist1EmployeeIds: string[];
  specialist2EmployeeIds: string[];
}

export interface StandingLoad {
  rows: BoardRow[];
  /** Vehicles this load filled — exactly what switching the toggle off clears again. */
  filledVehicleIds: string[];
  /** Standing crews whose vehicle is not on today's board. Their people stay in the pool. */
  unavailableVehicleIds: string[];
}

const SOURCE_OF = {
  captain: 'captainEmployeeIds',
  specialist1: 'specialist1EmployeeIds',
  specialist2: 'specialist2EmployeeIds',
} as const;

const FIELD_OF = {
  captain: 'captainEmployeeIds',
  specialist1: 'specialist1EmployeeIds',
  specialist2: 'specialist2EmployeeIds',
} as const;

const cells = (ids: readonly string[]): SlotCells =>
  SLOT_POSITIONS.map((position) => ids[position] ?? null);

export const loadStandingCrew = (
  rows: readonly BoardRow[],
  standing: readonly StandingCrewSource[],
): StandingLoad => {
  const byVehicle = new Map(standing.map((row) => [row.vehicleId, row]));
  const onBoard = new Set(rows.flatMap(rowCrew));
  const filledVehicleIds: string[] = [];

  // Board order, not standing order: the result must not depend on the order rows happen to come
  // back in, and two vehicles competing for the same person resolve the same way every time.
  const next = rows.map((row) => {
    const source = byVehicle.get(row.vehicleId);
    if (source === undefined) return { ...row };
    if (rowCrew(row).length > 0) return { ...row }; // rule 1 — never overwrite

    const taken: Record<(typeof CREW_SLOTS)[number], string[]> = {
      captain: [],
      specialist1: [],
      specialist2: [],
    };
    for (const slot of CREW_SLOTS) {
      for (const employeeId of source[SOURCE_OF[slot]]) {
        if (onBoard.has(employeeId)) continue; // rule 2 — nobody twice
        taken[slot].push(employeeId);
        onBoard.add(employeeId);
      }
    }

    const placed = CREW_SLOTS.reduce((n, slot) => n + taken[slot].length, 0);
    if (placed === 0) return { ...row };
    filledVehicleIds.push(row.vehicleId);
    return {
      ...row,
      captainEmployeeIds: cells(taken.captain),
      specialist1EmployeeIds: cells(taken.specialist1),
      specialist2EmployeeIds: cells(taken.specialist2),
    };
  });

  const boardVehicles = new Set(rows.map((row) => row.vehicleId));
  const unavailableVehicleIds = standing
    .filter((row) => !boardVehicles.has(row.vehicleId))
    // A standing row with nobody on it has no crew to strand, so it is not worth reporting.
    .filter(
      (row) =>
        row.captainEmployeeIds.length +
          row.specialist1EmployeeIds.length +
          row.specialist2EmployeeIds.length >
        0,
    )
    .map((row) => row.vehicleId);

  return { rows: next, filledVehicleIds, unavailableVehicleIds };
};

/**
 * Switch the toggle back off — empty exactly the vehicles the load filled.
 *
 * It clears those rows rather than restoring a snapshot of what they held before. A snapshot taken
 * at load time goes stale the moment the operator drags anything, and putting it back would undo
 * edits made AFTER the toggle went on. Clearing only what the toggle filled leaves every other
 * decision on the board untouched.
 */
export const clearStandingCrew = (
  rows: readonly BoardRow[],
  filledVehicleIds: readonly string[],
): BoardRow[] => {
  const filled = new Set(filledVehicleIds);
  return rows.map((row) => {
    if (!filled.has(row.vehicleId)) return { ...row };
    const next = { ...row };
    for (const slot of CREW_SLOTS) next[FIELD_OF[slot]] = cells([]);
    return next;
  });
};
