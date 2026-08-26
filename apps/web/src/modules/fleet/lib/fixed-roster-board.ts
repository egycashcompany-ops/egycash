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
 * Put `employeeId` in one slot of one vehicle, and leave the board consistent.
 *
 * Three shapes, and the difference between them is what "intuitive" means here:
 *
 *  • Onto the OTHER SLOT OF THE SAME CAR — a SWAP. Whoever was in the destination takes the
 *    dragged driver's old slot; if it was empty, the old slot simply empties. Both people stay
 *    on the crew they were already on, which is what the gesture looks like it should do, and
 *    it is why moving between slots does not mean clearing one first.
 *  • Onto ANOTHER CAR — a move. The first car releases them, the second takes them, and anyone
 *    already in that destination slot is displaced back to the pool. A swap ACROSS cars would
 *    quietly rewrite a third party's crew, which is a bigger change than the gesture promises.
 *  • Onto the slot they already hold — nothing. The board comes back equal, so no change is
 *    pending and nothing is sent.
 *
 * The invariants hold in all three: a driver appears at most once per vehicle, belongs to at
 * most one crew, and never vanishes from the board — they are either seated or back in the pool.
 */
export const assignDriver = (
  rows: readonly FleetFixedCrewRowDto[],
  vehicleId: string,
  slot: CrewSlot,
  employeeId: string,
): FleetFixedCrewRowDto[] => {
  const seat = findSeat(rows, employeeId);
  const swapWithin = seat !== null && seat.vehicleId === vehicleId && seat.slot !== slot;
  return rows.map((row) => {
    // Any OTHER car releases them — that is what makes one driver, one crew true.
    if (row.vehicleId !== vehicleId) {
      return {
        ...row,
        driver1EmployeeId: row.driver1EmployeeId === employeeId ? null : row.driver1EmployeeId,
        driver2EmployeeId: row.driver2EmployeeId === employeeId ? null : row.driver2EmployeeId,
      };
    }
    // The destination car. Whoever sat in the target slot is displaced.
    const displaced = row[slot];
    const next: FleetFixedCrewRowDto = { ...row, [slot]: employeeId };
    // A move between this car's own two slots hands the old slot to the displaced person —
    // a swap when the destination was taken, an ordinary move when it was empty.
    if (swapWithin && seat !== null) next[seat.slot] = displaced;
    return next;
  });
};

/**
 * The pool: every active driver the server sent, MINUS everyone the DRAFT already seats.
 *
 * Derived from the draft rather than from the server's own `assignedVehicleId`, because the pool
 * has to answer the board as it stands right now: a drag that has not been saved yet must still
 * take its driver out of the list, and clearing a slot must put them back, with no round trip in
 * between. Deriving it also makes the three awkward cases fall out for free — a move between
 * vehicles never flickers the driver back into the pool, and a slot change cannot duplicate a
 * card, because membership is computed from the seats, not adjusted step by step.
 *
 * The server's array is never mutated; this returns a new one.
 */
export const availableDrivers = <T extends { employeeId: string }>(
  all: readonly T[],
  draft: readonly FleetFixedCrewRowDto[],
): T[] => {
  const seated = new Set<string>();
  for (const row of draft) {
    for (const slot of CREW_SLOTS) {
      const id = row[slot];
      if (id !== null) seated.add(id);
    }
  }
  return all.filter((driver) => !seated.has(driver.employeeId));
};

/**
 * Apply the edit dialog's four values to one vehicle, on the same terms a drag gets.
 *
 * The dialog can seat a driver who is currently on ANOTHER car, and that has to mean what
 * dragging them means: the other car releases them. So this does not write the row directly —
 * it routes each chosen driver through `assignDriver`, which owns the exclusivity rules, and
 * only then writes the fields no drag can touch. One rule, two entry points.
 *
 * Order matters. Slot 1 is placed first, then slot 2, so seating the same person in both is
 * impossible by construction rather than by a check: the second placement would displace the
 * first, which is why the dialog refuses that pair before ever calling this.
 */
export const applyEdit = (
  rows: readonly FleetFixedCrewRowDto[],
  vehicleId: string,
  edit: {
    missionTypeId: string | null;
    driver1EmployeeId: string | null;
    driver2EmployeeId: string | null;
    notes: string | null;
  },
): FleetFixedCrewRowDto[] => {
  let next: FleetFixedCrewRowDto[] = [...rows];
  for (const slot of CREW_SLOTS) {
    const chosen = edit[slot];
    next =
      chosen === null
        ? clearSlot(next, vehicleId, slot)
        : assignDriver(next, vehicleId, slot, chosen);
  }
  return next.map((row) =>
    row.vehicleId === vehicleId
      ? { ...row, missionTypeId: edit.missionTypeId, notes: edit.notes }
      : row,
  );
};

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
export interface FixedCrewPayloadRow {
  vehicleId: string;
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
}

/** The four editable facts of a row — what "changed" is measured over, and what is sent. */
const editable = (row: FleetFixedCrewRowDto): Omit<FixedCrewPayloadRow, 'vehicleId'> => ({
  missionTypeId: row.missionTypeId,
  driver1EmployeeId: row.driver1EmployeeId,
  driver2EmployeeId: row.driver2EmployeeId,
  notes: row.notes,
});

/** Does this row say anything at all? A row holding nothing was never worth creating. */
const holdsSomething = (row: FleetFixedCrewRowDto): boolean =>
  Object.values(editable(row)).some((v) => v !== null);

export const changedRows = (
  saved: readonly FleetFixedCrewRowDto[],
  draft: readonly FleetFixedCrewRowDto[],
): FixedCrewPayloadRow[] => {
  const before = new Map(saved.map((row) => [row.vehicleId, row]));
  return draft
    .filter((row) => {
      const was = before.get(row.vehicleId);
      // A row the saved board never had counts as changed only if it actually says something.
      if (was === undefined) return holdsSomething(row);
      // Compared over all four editable facts, so a work type or a note edited alone still
      // travels — the modal can change any one of them without touching a driver.
      return JSON.stringify(editable(was)) !== JSON.stringify(editable(row));
    })
    .map((row) => ({ vehicleId: row.vehicleId, ...editable(row) }));
};

/** Is there anything to save? The unsaved-changes banner and the save button both ask this. */
export const isDirty = (
  saved: readonly FleetFixedCrewRowDto[],
  draft: readonly FleetFixedCrewRowDto[],
): boolean => changedRows(saved, draft).length > 0;
