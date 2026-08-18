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
//
// ── WHY A SLOT IS A LIST OF CELLS AND NOT A LIST OF PEOPLE ──────────────────────────────────────
// A slot now holds up to CREW_SLOT_CAPACITY people, drawn as that many cards stacked in the cell.
// The board models each CARD POSITION as its own drop target, so the row carries a fixed-length
// array with `null` holes rather than a compacted list. That is what keeps the legacy interaction
// intact at the new capacity: one card is one person, and dropping on a card overwrites THAT card
// — no rule is needed for "which of the two occupants does a drop displace", because the operator
// already answered it by choosing where to drop. A compacted list would have forced one.
//
// The holes are a board-editing concept and stop at the wire: `toPlanRows` compacts them away,
// because the server stores a slot's occupants and not their card positions. A row saved with a
// hole above an occupant therefore comes back with the occupant on top. That is a cosmetic
// settling of an empty cell, not a change of crew.
import {
  CREW_SLOT_CAPACITY,
  type OperationsCrewBoardRowDto,
  type OperationsCrewMemberDto,
} from '@ecms/contracts';

export const CREW_SLOTS = ['captain', 'specialist1', 'specialist2'] as const;
export type CrewSlot = (typeof CREW_SLOTS)[number];

/** The card positions inside one slot: `[0, 1]` at capacity 2. */
export const SLOT_POSITIONS: readonly number[] = Array.from(
  { length: CREW_SLOT_CAPACITY },
  (_, index) => index,
);

/** One slot as the board edits it: exactly CREW_SLOT_CAPACITY cells, empty ones `null`. */
export type SlotCells = (string | null)[];

/** One vehicle's editable crew, as the board holds it before saving. */
export interface BoardRow {
  vehicleId: string;
  vehicleCode: string;
  captainEmployeeIds: SlotCells;
  specialist1EmployeeIds: SlotCells;
  specialist2EmployeeIds: SlotCells;
  direction: string | null;
  plannedTime: string | null;
  notes: string | null;
}

type SlotField = 'captainEmployeeIds' | 'specialist1EmployeeIds' | 'specialist2EmployeeIds';

const SLOT_FIELD: Record<CrewSlot, SlotField> = {
  captain: 'captainEmployeeIds',
  specialist1: 'specialist1EmployeeIds',
  specialist2: 'specialist2EmployeeIds',
};

/** A stored slot → its cells, padded to capacity and truncated if the server ever sent more. */
const toCells = (ids: readonly string[] | undefined): SlotCells =>
  SLOT_POSITIONS.map((position) => ids?.[position] ?? null);

/** The server's board → the editable value. Rows with no crew yet start empty, not absent. */
export const toBoardRows = (rows: readonly OperationsCrewBoardRowDto[]): BoardRow[] =>
  rows.map((row) => ({
    vehicleId: row.vehicleId,
    vehicleCode: row.vehicleCode,
    captainEmployeeIds: toCells(row.crew?.captainEmployeeIds),
    specialist1EmployeeIds: toCells(row.crew?.specialist1EmployeeIds),
    specialist2EmployeeIds: toCells(row.crew?.specialist2EmployeeIds),
    direction: row.crew?.direction ?? null,
    plannedTime: row.crew?.plannedTime ?? null,
    notes: row.crew?.notes ?? null,
  }));

/** One card. */
export const slotValue = (row: BoardRow, slot: CrewSlot, position: number): string | null =>
  row[SLOT_FIELD[slot]][position] ?? null;

/** A whole slot's occupants, holes removed — who is actually in that seat. */
export const slotOccupants = (row: BoardRow, slot: CrewSlot): string[] =>
  row[SLOT_FIELD[slot]].filter((id): id is string => id !== null);

/** Everyone on this vehicle, across all three slots. */
export const rowCrew = (row: BoardRow): string[] =>
  CREW_SLOTS.flatMap((slot) => slotOccupants(row, slot));

/** Every card on the board that currently holds this employee. */
export const slotsHolding = (
  rows: readonly BoardRow[],
  employeeId: string,
): { vehicleId: string; slot: CrewSlot; position: number }[] =>
  rows.flatMap((row) =>
    CREW_SLOTS.flatMap((slot) =>
      SLOT_POSITIONS.filter((position) => slotValue(row, slot, position) === employeeId).map(
        (position) => ({ vehicleId: row.vehicleId, slot, position }),
      ),
    ),
  );

/**
 * Drop `employeeId` onto one card.
 *
 * Two things happen at once, and both are deliberate:
 *   1. the member is REMOVED from every card they already held, board-wide (Q11 — one vehicle per
 *      day, and no one twice in a slot), so the result is always a valid end state rather than one
 *      the server will reject;
 *   2. whoever was on the target card is displaced back to the pool, because a card holds one
 *      person. Legacy's drop overwrote in the same way.
 */
export const assignToSlot = (
  rows: readonly BoardRow[],
  vehicleId: string,
  slot: CrewSlot,
  position: number,
  employeeId: string,
): BoardRow[] =>
  rows.map((row) => {
    const next = { ...row };
    // Clear this member wherever they were, including a different card on this same row.
    for (const other of CREW_SLOTS) {
      const field = SLOT_FIELD[other];
      next[field] = next[field].map((id) => (id === employeeId ? null : id));
    }
    if (row.vehicleId === vehicleId) {
      const field = SLOT_FIELD[slot];
      next[field] = next[field].map((id, index) => (index === position ? employeeId : id));
    }
    return next;
  });

/**
 * Take a member off the board entirely — what dropping them back on the pool means.
 *
 * The page used to spell this out inline with a nested ternary over the three field names. That
 * was survivable while a slot was one field; at two cards per slot it would have been a second,
 * divergent implementation of `assignToSlot`'s clearing half.
 */
export const removeFromBoard = (
  rows: readonly BoardRow[],
  employeeId: string,
): BoardRow[] =>
  rows.map((row) => {
    const next = { ...row };
    for (const slot of CREW_SLOTS) {
      const field = SLOT_FIELD[slot];
      next[field] = next[field].map((id) => (id === employeeId ? null : id));
    }
    return next;
  });

export const clearSlot = (
  rows: readonly BoardRow[],
  vehicleId: string,
  slot: CrewSlot,
  position: number,
): BoardRow[] =>
  rows.map((row) => {
    if (row.vehicleId !== vehicleId) return { ...row };
    const field = SLOT_FIELD[slot];
    return {
      ...row,
      [field]: row[field].map((id, index) => (index === position ? null : id)),
    };
  });

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
  const used = new Set(rows.flatMap(rowCrew));
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
 *
 * Slots compare on their OCCUPANTS, not their cells: moving the only captain from the lower card
 * to the upper one changes no crew, and marking that row changed would send a write the server
 * would correctly recognise as nothing and discard — after taking a version bump for it.
 */
const sameOccupants = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export const changedRows = (
  next: readonly BoardRow[],
  original: readonly BoardRow[],
): BoardRow[] => {
  const before = new Map(original.map((row) => [row.vehicleId, row]));
  return next.filter((row) => {
    const was = before.get(row.vehicleId);
    if (was === undefined) return true;
    return (
      CREW_SLOTS.some((slot) => !sameOccupants(slotOccupants(was, slot), slotOccupants(row, slot))) ||
      was.direction !== row.direction ||
      was.plannedTime !== row.plannedTime ||
      was.notes !== row.notes
    );
  });
};

/**
 * The payload the crew-board endpoint takes. Sent as the COMPLETE plan for the changed rows —
 * the service upserts per (day, vehicle), so a row's absence means "leave it alone", not "clear
 * it". Clearing is expressed by sending the row with empty slots.
 */
export const toPlanRows = (rows: readonly BoardRow[]) =>
  rows.map((row) => ({
    vehicleId: row.vehicleId,
    captainEmployeeIds: slotOccupants(row, 'captain'),
    specialist1EmployeeIds: slotOccupants(row, 'specialist1'),
    specialist2EmployeeIds: slotOccupants(row, 'specialist2'),
    direction: row.direction,
    plannedTime: row.plannedTime,
    notes: row.notes,
  }));
