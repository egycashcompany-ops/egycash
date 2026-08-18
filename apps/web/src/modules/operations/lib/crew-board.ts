// The crew board's drag-and-drop, as pure state transitions.
//
// This file exists because of what the legacy board was. `/tashghela` implemented HTML5 drag and
// drop by hand (tashghela.ejs:1287-1370, no library) and — critically — enforced its ONE business
// rule in the browser: `alreadyUsed` (:1332) stopped an operator dropping a crew member onto a
// second vehicle, while `POST /tashghela` blind-upserted whatever it was sent (:2413). A direct
// API call could double-book anyone.
//
// That rule (Q11) is now enforced in the domain, end-state-checked. What remains here is the
// board's INTERACTION: what a drop does to the plan before it is saved. Keeping it as pure
// functions over a plain value means the interaction is tested for real — the rule, not the mouse
// — which is why none of it lives inside a component.
//
// THE ONE BEHAVIOURAL CHOICE worth stating: dropping a member who is already crewed elsewhere
// MOVES them. Legacy refused the drop. Moving is what makes the end state valid — the same end
// state the server demands — and it is what a drag gesture means. Refusing would leave the
// operator to clear the old slot by hand for no reason.
import { type OperationsCrewBoardRowDto, type OperationsCrewMemberDto } from '@ecms/contracts';

export const CREW_SLOTS = ['captain', 'specialist1', 'specialist2'] as const;
export type CrewSlot = (typeof CREW_SLOTS)[number];

/** One vehicle's editable crew, as the board holds it before saving. */
export interface BoardRow {
  vehicleId: string;
  vehicleCode: string;
  captainEmployeeId: string | null;
  specialist1EmployeeId: string | null;
  specialist2EmployeeId: string | null;
  direction: string | null;
  plannedTime: string | null;
  notes: string | null;
}

const SLOT_FIELD: Record<CrewSlot, keyof Pick<
  BoardRow,
  'captainEmployeeId' | 'specialist1EmployeeId' | 'specialist2EmployeeId'
>> = {
  captain: 'captainEmployeeId',
  specialist1: 'specialist1EmployeeId',
  specialist2: 'specialist2EmployeeId',
};

/** The server's board → the editable value. Rows with no crew yet start empty, not absent. */
export const toBoardRows = (rows: readonly OperationsCrewBoardRowDto[]): BoardRow[] =>
  rows.map((row) => ({
    vehicleId: row.vehicleId,
    vehicleCode: row.vehicleCode,
    captainEmployeeId: row.crew?.captainEmployeeId ?? null,
    specialist1EmployeeId: row.crew?.specialist1EmployeeId ?? null,
    specialist2EmployeeId: row.crew?.specialist2EmployeeId ?? null,
    direction: row.crew?.direction ?? null,
    plannedTime: row.crew?.plannedTime ?? null,
    notes: row.crew?.notes ?? null,
  }));

export const slotValue = (row: BoardRow, slot: CrewSlot): string | null => row[SLOT_FIELD[slot]];

/** Every slot on the board that currently holds this employee. */
export const slotsHolding = (
  rows: readonly BoardRow[],
  employeeId: string,
): { vehicleId: string; slot: CrewSlot }[] =>
  rows.flatMap((row) =>
    CREW_SLOTS.filter((slot) => slotValue(row, slot) === employeeId).map((slot) => ({
      vehicleId: row.vehicleId,
      slot,
    })),
  );

/**
 * Drop `employeeId` into one slot.
 *
 * Two things happen at once, and both are deliberate:
 *   1. the member is REMOVED from any slot they already held (Q11 — one vehicle per day), so the
 *      result is always a valid end state rather than one the server will reject;
 *   2. whoever was in the target slot is displaced back to the pool, because a slot holds one
 *      person. Legacy's drop overwrote in the same way.
 */
export const assignToSlot = (
  rows: readonly BoardRow[],
  vehicleId: string,
  slot: CrewSlot,
  employeeId: string,
): BoardRow[] =>
  rows.map((row) => {
    const next = { ...row };
    // Clear this member wherever they were, including a different slot on this same row.
    for (const other of CREW_SLOTS) {
      if (next[SLOT_FIELD[other]] === employeeId) next[SLOT_FIELD[other]] = null;
    }
    if (row.vehicleId === vehicleId) next[SLOT_FIELD[slot]] = employeeId;
    return next;
  });

export const clearSlot = (
  rows: readonly BoardRow[],
  vehicleId: string,
  slot: CrewSlot,
): BoardRow[] =>
  rows.map((row) =>
    row.vehicleId === vehicleId ? { ...row, [SLOT_FIELD[slot]]: null } : { ...row },
  );

/** Free-text and time fields on a row — the legacy direction/time/notes columns. */
export const setRowField = (
  rows: readonly BoardRow[],
  vehicleId: string,
  field: 'direction' | 'plannedTime' | 'notes',
  value: string,
): BoardRow[] =>
  rows.map((row) =>
    row.vehicleId === vehicleId ? { ...row, [field]: value === '' ? null : value } : { ...row },
  );

/** Who is still unassigned — the pool the board drags from. */
export const availablePool = (
  members: readonly OperationsCrewMemberDto[],
  rows: readonly BoardRow[],
): OperationsCrewMemberDto[] => {
  const used = new Set(
    rows.flatMap((row) => CREW_SLOTS.map((slot) => slotValue(row, slot))).filter(
      (id): id is string => id !== null,
    ),
  );
  return members.filter((member) => !used.has(member.employeeId));
};

/**
 * The legacy pool's requirement filters (tashghela.ejs:1114-1142 — the icons doubled as filter
 * buttons). They narrow WHAT IS SHOWN and nothing else: an unfiltered member is still assignable,
 * because requirements gate nothing (approved decision).
 */
export type RequirementFilter = 'hasWeapon' | 'hasSignature' | 'hasLicense' | 'isCaptain';

export const filterPool = (
  members: readonly OperationsCrewMemberDto[],
  active: readonly RequirementFilter[],
  search: string,
): OperationsCrewMemberDto[] => {
  const needle = search.trim().toLowerCase();
  return members.filter((member) => {
    if (
      needle !== '' &&
      !member.fullNameAr.toLowerCase().includes(needle) &&
      !member.code.toLowerCase().includes(needle)
    ) {
      return false;
    }
    // AND across active filters, matching the legacy buttons' cumulative behaviour.
    return active.every((flag) => member.requirements?.[flag] === true);
  });
};

/**
 * A board row is worth saving when any of its fields differs from what the server sent. Unchanged
 * rows are dropped so the save is a no-op for them — the crew service treats an identical row as
 * no write, no audit, no event, and sending them anyway would only obscure that.
 */
export const changedRows = (
  next: readonly BoardRow[],
  original: readonly BoardRow[],
): BoardRow[] => {
  const before = new Map(original.map((row) => [row.vehicleId, row]));
  return next.filter((row) => {
    const was = before.get(row.vehicleId);
    if (was === undefined) return true;
    return (
      was.captainEmployeeId !== row.captainEmployeeId ||
      was.specialist1EmployeeId !== row.specialist1EmployeeId ||
      was.specialist2EmployeeId !== row.specialist2EmployeeId ||
      was.direction !== row.direction ||
      was.plannedTime !== row.plannedTime ||
      was.notes !== row.notes
    );
  });
};

/**
 * The payload the crew-board endpoint takes. Sent as the COMPLETE plan for the changed rows —
 * the service upserts per (day, vehicle), so a row's absence means "leave it alone", not "clear
 * it". Clearing is expressed by sending the row with null slots.
 */
export const toPlanRows = (rows: readonly BoardRow[]) =>
  rows.map((row) => ({
    vehicleId: row.vehicleId,
    captainEmployeeId: row.captainEmployeeId,
    specialist1EmployeeId: row.specialist1EmployeeId,
    specialist2EmployeeId: row.specialist2EmployeeId,
    direction: row.direction,
    plannedTime: row.plannedTime,
    notes: row.notes,
  }));
