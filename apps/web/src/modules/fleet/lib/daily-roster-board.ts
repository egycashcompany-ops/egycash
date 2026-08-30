// The DAILY board as DATA — every rule of a drag and of a day's draft, with no DOM near it.
//
// A sibling of `fixed-roster-board.ts`, not an import from it, and deliberately so. The two
// boards answer different questions and the shapes say it: a fixed row is a fact about a VEHICLE
// (no date, no maintenance verdict), a daily row is a fact about a vehicle ON A DAY and carries
// `inMaintenance`, which is a rule here and merely context there. Making one module serve both
// would mean editing the fixed board's logic — the thing this change is forbidden to touch — so
// the two share the drag CONTRACT and the shape of their rules, and nothing else. The same
// decision the page already made for its slot cell, for the same reason.
//
// The rules restated here are the ones the SERVER already enforces, so the draft cannot propose a
// day the API would refuse: one person may not hold both slots of a vehicle (so a drop always
// removes them from wherever they were first), one driver holds one vehicle per date (FR-7), and
// a vehicle the workshop holds takes nobody at all (FR-5).
import { type FleetRosterRowDto } from '@ecms/contracts';

export type DutySlot = 'driver1EmployeeId' | 'driver2EmployeeId';

export const DUTY_SLOTS: readonly DutySlot[] = ['driver1EmployeeId', 'driver2EmployeeId'];

/**
 * A second driver needs a first: slot 2 never holds somebody while slot 1 is empty.
 *
 * The same rule the standing crew carries, and for a sharper reason here —
 * `operations/crew-board` reads slot 1 as "the driver" of the day, so a day holding only a
 * second driver reaches Operations as a crewless vehicle with a real person committed to it.
 *
 * A NORMALISATION over the whole board rather than a check in one place, because three gestures
 * reach the state and gating only the obvious one leaves the others open: clearing slot 1,
 * dragging the slot-1 driver onto another vehicle (the releasing row is left holding only slot
 * 2), and the dialog writing the pair directly. Promotion is what this board already does
 * everywhere else — a driver is never silently dropped, they are moved.
 */
const seatOrder = (row: FleetRosterRowDto): FleetRosterRowDto =>
  row.driver1EmployeeId === null && row.driver2EmployeeId !== null
    ? { ...row, driver1EmployeeId: row.driver2EmployeeId, driver2EmployeeId: null }
    : row;

/** Where a driver sits on this day's draft, or `null` when they sit nowhere. */
export const findSeat = (
  rows: readonly FleetRosterRowDto[],
  employeeId: string,
): { vehicleId: string; slot: DutySlot } | null => {
  for (const row of rows) {
    for (const slot of DUTY_SLOTS) {
      if (row[slot] === employeeId) return { vehicleId: row.vehicleId, slot };
    }
  }
  return null;
};

/**
 * Seat `employeeId` in one slot of one vehicle for this day, and leave the draft consistent.
 *
 * Three shapes, exactly as the fixed board has them, because the gesture means the same thing on
 * both:
 *
 *  • Onto the OTHER SLOT OF THE SAME CAR — a SWAP. The crew is right, the seats were the wrong
 *    way round; both people stay on the car.
 *  • Onto ANOTHER CAR — a move. The first car releases them, the second takes them, and whoever
 *    held the destination slot goes back to the pool. A swap ACROSS cars would rewrite a third
 *    party's day, which is more than the gesture promises.
 *  • Onto the slot they already hold — nothing, and the draft comes back equal, so no change is
 *    pending and nothing is sent.
 *
 * A vehicle IN MAINTENANCE takes nobody (FR-5). The draft returns unchanged rather than throwing:
 * the cell is not a drop target in the first place, so reaching here means a caller that skipped
 * the UI, and the honest answer to that is "the board did not move".
 */
export const assignDriver = (
  rows: readonly FleetRosterRowDto[],
  vehicleId: string,
  slot: DutySlot,
  employeeId: string,
): FleetRosterRowDto[] => {
  const target = rows.find((row) => row.vehicleId === vehicleId);
  if (target === undefined || target.inMaintenance) return [...rows];
  const seat = findSeat(rows, employeeId);
  const swapWithin = seat !== null && seat.vehicleId === vehicleId && seat.slot !== slot;
  return rows.map((row) => {
    // Any OTHER car releases them — that is what makes one driver, one vehicle per date true.
    if (row.vehicleId !== vehicleId) {
      const releases =
        row.driver1EmployeeId === employeeId || row.driver2EmployeeId === employeeId;
      // A vehicle with nothing to do with this drag comes back UNTOUCHED. `seatOrder` is a
      // normalisation, and run over the whole board it rewrites rows the user never edited —
      // which puts them in the save payload, where the server re-validates them against rules
      // they were not written under. Worse here than on the fixed board: `rowsToSave` would then
      // MATERIALISE those rows too, turning a stray promotion into a stored duty assignment.
      // Normalise what the gesture touches, and nothing else.
      if (!releases) return row;
      // A vehicle that gives up its FIRST driver this way is left holding only a second, so it
      // is re-seated rather than left in a state the server refuses.
      return seatOrder({
        ...row,
        driver1EmployeeId: row.driver1EmployeeId === employeeId ? null : row.driver1EmployeeId,
        driver2EmployeeId: row.driver2EmployeeId === employeeId ? null : row.driver2EmployeeId,
      });
    }
    const displaced = row[slot];
    const next: FleetRosterRowDto = { ...row, [slot]: employeeId };
    if (swapWithin && seat !== null) next[seat.slot] = displaced;
    // Seating somebody in slot 2 of a vehicle with no slot-1 driver seats them in slot 1. The
    // cell refuses that drop before it reaches here; this makes the rule hold for the dialog too.
    return seatOrder(next);
  });
};

/**
 * Empty one slot of one vehicle. Every other row is left exactly as it was.
 *
 * Clearing slot 1 of a crew that still has a second driver PROMOTES that driver rather than
 * leaving the vehicle holding only a second man — see `seatOrder`.
 */
export const clearSlot = (
  rows: readonly FleetRosterRowDto[],
  vehicleId: string,
  slot: DutySlot,
): FleetRosterRowDto[] =>
  rows.map((row) => (row.vehicleId === vehicleId ? seatOrder({ ...row, [slot]: null }) : row));

/**
 * Point one vehicle's day at a mission type, or at none.
 *
 * A separate operation from the crew because it is a separate fact: a dispatcher changes what a
 * car is DOING far more often than who is on it, and the cell that edits it must not have to
 * route through the driver rules to say so.
 */
export const setMission = (
  rows: readonly FleetRosterRowDto[],
  vehicleId: string,
  missionTypeId: string | null,
): FleetRosterRowDto[] =>
  rows.map((row) => (row.vehicleId === vehicleId ? { ...row, missionTypeId } : row));

/**
 * Apply the edit dialog's four values to one vehicle, on the same terms a drag gets.
 *
 * The dialog can seat a driver who currently holds ANOTHER vehicle for this date, and that must
 * mean what dragging them means: the other vehicle releases them. So this does not write the row
 * directly — it routes each chosen driver through `assignDriver`, which owns FR-5 and FR-7, and
 * only then writes the two fields no drag can touch. One rule, two entry points; the dialog used
 * to carry a second copy of the release arithmetic and could drift from the board's.
 *
 * Order matters. Slot 1 is placed first, then slot 2, so seating the same person in both is
 * impossible by construction rather than by a check — the second placement would displace the
 * first, which is why the dialog refuses that pair before ever calling this.
 */
export const applyEdit = (
  rows: readonly FleetRosterRowDto[],
  vehicleId: string,
  edit: {
    missionTypeId: string | null;
    driver1EmployeeId: string | null;
    driver2EmployeeId: string | null;
    notes: string | null;
  },
): FleetRosterRowDto[] => {
  let next: FleetRosterRowDto[] = [...rows];
  for (const slot of DUTY_SLOTS) {
    const chosen = edit[slot];
    next =
      chosen === null
        ? clearSlot(next, vehicleId, slot)
        : assignDriver(next, vehicleId, slot, chosen);
  }
  return next.map((r) =>
    r.vehicleId === vehicleId ? { ...r, missionTypeId: edit.missionTypeId, notes: edit.notes } : r,
  );
};

/**
 * The pool: every driver the server judged AVAILABLE on this date, minus everyone the DRAFT seats.
 *
 * Derived from the draft, never from the server's own `assignedVehicleId`, because the pool has to
 * answer the board as it stands right now — before any save. A drag takes its driver out of the
 * list immediately, clearing a slot puts them back immediately, and a move between vehicles never
 * flickers them through the pool in between, because membership is COMPUTED from the seats rather
 * than adjusted step by step.
 *
 * The UNAVAILABLE half never reaches this function. Those drivers are not in `all`: the server
 * split them out by `driverAvailabilityOn(date)` and they are rendered from their own list, with
 * their own reason, and are not draggable. Filtering them here as well would be a second opinion
 * about availability, which is exactly what this module must not have.
 *
 * The server's array is never mutated; this returns a new one.
 */
export const availableDrivers = <T extends { employeeId: string }>(
  all: readonly T[],
  draft: readonly FleetRosterRowDto[],
): T[] => {
  const seated = new Set<string>();
  for (const row of draft) {
    for (const slot of DUTY_SLOTS) {
      const id = row[slot];
      if (id !== null) seated.add(id);
    }
  }
  return all.filter((driver) => !seated.has(driver.employeeId));
};

/** The row shape the plan endpoint upserts — the payload, and nothing more. */
export interface DutyPayloadRow {
  vehicleId: string;
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
  notes: string | null;
}

/** The four editable facts of a day's row: what "changed" is measured over, and what is sent. */
const editable = (row: FleetRosterRowDto): Omit<DutyPayloadRow, 'vehicleId'> => ({
  missionTypeId: row.missionTypeId,
  driver1EmployeeId: row.driver1EmployeeId,
  driver2EmployeeId: row.driver2EmployeeId,
  notes: row.notes,
});

/** Does this row say anything at all about the day? */
const holdsSomething = (row: FleetRosterRowDto): boolean =>
  Object.values(editable(row)).some((v) => v !== null);

/** The rows the dispatcher actually EDITED, measured against the day the board arrived as. */
export const changedRows = (
  baseline: readonly FleetRosterRowDto[],
  draft: readonly FleetRosterRowDto[],
): DutyPayloadRow[] => {
  const before = new Map(baseline.map((row) => [row.vehicleId, row]));
  return draft
    .filter((row) => {
      const was = before.get(row.vehicleId);
      if (was === undefined) return holdsSomething(row);
      return JSON.stringify(editable(was)) !== JSON.stringify(editable(row));
    })
    .map((row) => ({ vehicleId: row.vehicleId, ...editable(row) }));
};

/**
 * The SAVE payload: what the day should hold, including what it merely inherited.
 *
 * This is the fix for a real defect, and the reason it is not simply `changedRows`.
 *
 * A row's operation can reach this screen two ways: read back from a stored
 * `fleet_duty_assignment`, or PROJECTED from the standing crew because no such row exists yet.
 * `operations/crew-board` builds its day by iterating the duty documents — so a vehicle whose
 * operation was only ever projected is not on that board AT ALL. Sending only what changed
 * therefore made "the dispatcher agreed with the standing crew" indistinguishable from "there is
 * nothing to plan", and the operation never arrived in Operations. Not changing a value is not
 * the same as not wanting it saved.
 *
 * So a row travels when EITHER:
 *
 *  • it differs from the baseline — an edit, including one that empties a row, which is how
 *    "this vehicle runs nobody today" stays expressible; or
 *  • it is not yet `planned`, holds something, and the vehicle is ASSIGNABLE that day — the
 *    projection, being made real. Once saved the row comes back `planned: true`, so it is not
 *    sent again on the next save.
 *
 * A row that is unplanned and holds NOTHING is not sent: there is no day to record for a vehicle
 * nobody has said anything about, and materialising every idle vehicle would put the whole fleet
 * on the crew board every day.
 *
 * NOR is a vehicle the workshop holds (FR-5), and that exclusion is the whole of a real bug.
 * `board()` still PROJECTS the standing mission onto an in-workshop vehicle — the mission is a
 * fact about the vehicle's standing work, so it is worth showing — while withdrawing its crew.
 * But the server counts a mission-only row as an ASSIGNMENT (`assigns()` is
 * `missionTypeId != null || drivers.length > 0`) and FR-5 refuses to store one for a vehicle
 * with an open visit covering the date. So offering to materialise that projection meant
 * proposing exactly the write the rule exists to reject, and because `plan()` throws before its
 * transaction, ONE car in the workshop failed the entire day's save.
 *
 * The rule is not relaxed and nothing is swallowed: FR-5 remains the authority, in the service,
 * unchanged. What changes is that the board stops PROPOSING a write it knows is illegal —
 * exactly as the slot cell already refuses to be a drop target for the same vehicle. An explicit
 * attempt to assign one still travels, and is still refused, because such a row is a genuine
 * EDIT and goes through the branch above.
 *
 * A move changes two rows and sends two, which is what lets the server check FR-7 against the end
 * state instead of guessing, and is why the releasing side is never forgotten.
 */
export const rowsToSave = (
  baseline: readonly FleetRosterRowDto[],
  draft: readonly FleetRosterRowDto[],
): DutyPayloadRow[] => {
  const changed = new Set(changedRows(baseline, draft).map((row) => row.vehicleId));
  return draft
    .filter(
      (row) =>
        changed.has(row.vehicleId) || (!row.planned && !row.inMaintenance && holdsSomething(row)),
    )
    .map((row) => ({ vehicleId: row.vehicleId, ...editable(row) }));
};

/**
 * Is there anything to save? The Save button and the unsaved marker both ask this.
 *
 * True on an untouched day that still carries an unmaterialised operation — which is the point:
 * the dispatcher must be able to commit the standing crew's operation to the day without having
 * to change something first to wake the button up.
 */
export const isDirty = (
  baseline: readonly FleetRosterRowDto[],
  draft: readonly FleetRosterRowDto[],
): boolean => rowsToSave(baseline, draft).length > 0;

/** Has the dispatcher edited anything? What «إلغاء» offers to throw away. */
export const hasEdits = (
  baseline: readonly FleetRosterRowDto[],
  draft: readonly FleetRosterRowDto[],
): boolean => changedRows(baseline, draft).length > 0;
