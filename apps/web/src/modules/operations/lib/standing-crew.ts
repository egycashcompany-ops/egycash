// The standing crew board, expressed in the daily board's own vocabulary.
//
// Everything about HOW a crew is edited — the three slots, the stacked cards, what a drop does,
// who is left in the pool, which rows are worth saving — is already solved in `crew-board.ts` and
// is entirely date-free (nothing in that file imports or stores a date). This file is only the two
// ADAPTERS at the edges: the server's standing rows in, and the standing payload out.
//
// THE ONE FIELD THAT DIFFERS is `notes`. A daily crew row carries one; a standing row does not,
// because a note on a day's crew is about that day and a permanent note is a different thing
// nobody asked for. `BoardRow` keeps the field so the shared transitions stay one implementation,
// and `toStandingPayloadRows` drops it on the way out — the standing schema is `.strict()` and
// would reject it.
import {
  type OperationsStandingCrewBoardDto,
  type OperationsStandingCrewRowDto,
} from '@ecms/contracts';
import { SLOT_POSITIONS, slotOccupants, type BoardRow, type SlotCells } from './crew-board';

/** A stored slot → its cells, padded to capacity. Same rule as the daily board's `toCells`. */
const toCells = (ids: readonly string[] | undefined): SlotCells =>
  SLOT_POSITIONS.map((position) => ids?.[position] ?? null);

export const toStandingRows = (
  rows: readonly OperationsStandingCrewRowDto[],
): BoardRow[] =>
  rows.map((row) => ({
    vehicleId: row.vehicleId,
    vehicleCode: row.vehicleCode,
    // The standing board is DATELESS, so it has no operation: التشغيله is a fact about a vehicle
    // on a DAY and lives on the duty row. The shape is shared; this half of it is not.
    missionTypeId: null,
    captainEmployeeIds: toCells(row.captainEmployeeIds),
    specialist1EmployeeIds: toCells(row.specialist1EmployeeIds),
    specialist2EmployeeIds: toCells(row.specialist2EmployeeIds),
    direction: row.direction,
    plannedTime: row.plannedTime,
    // Always null and never rendered — see the header. It exists so one set of transitions serves
    // both boards.
    notes: null,
  }));

/**
 * The payload the standing-crew endpoint takes.
 *
 * Only CHANGED rows are sent, exactly as the daily board does, and an omitted slot CLEARS it —
 * the same dialect the service speaks on both boards. A row's ABSENCE means "unchanged", never
 * "delete this vehicle": removal is its own DELETE, because inferring it from absence would empty
 * the fleet the first time somebody saved a single edit.
 */
export const toStandingPayloadRows = (rows: readonly BoardRow[]) =>
  rows.map((row) => ({
    vehicleId: row.vehicleId,
    captainEmployeeIds: slotOccupants(row, 'captain'),
    specialist1EmployeeIds: slotOccupants(row, 'specialist1'),
    specialist2EmployeeIds: slotOccupants(row, 'specialist2'),
    direction: row.direction,
    plannedTime: row.plannedTime,
  }));

/**
 * Fold a fresh server list into the draft the operator is holding.
 *
 * The naive `setRows(serverRows)` on every refetch was wrong the moment this screen gained a
 * server action of its own: removing one vehicle refetches the list, which threw away every
 * unsaved edit on every OTHER vehicle. The operator's own click silently destroyed their work.
 *
 * The merge rule, per vehicle:
 *   · in both  → keep the LOCAL row. It is the operator's unsaved intent, and `changedRows` still
 *                compares it against the new server row, so a save sends the right diff.
 *   · server only → take it. Somebody else added it, or the operator just reloaded.
 *   · local only  → keep it, but ONLY if it was never on the server. That is a vehicle added from
 *                the picker and not yet saved. A local row whose server row has GONE was removed —
 *                by this operator or another — and must not be resurrected.
 */
export const mergeStandingRows = (
  server: readonly BoardRow[],
  local: readonly BoardRow[],
  /** The server list the draft was last reconciled against — how "gone" is told from "new". */
  previousServer: readonly BoardRow[],
): BoardRow[] => {
  const localByVehicle = new Map(local.map((row) => [row.vehicleId, row]));
  const serverVehicles = new Set(server.map((row) => row.vehicleId));
  const wasOnServer = new Set(previousServer.map((row) => row.vehicleId));

  const merged = server.map((row) => localByVehicle.get(row.vehicleId) ?? row);
  const addedLocally = local.filter(
    (row) => !serverVehicles.has(row.vehicleId) && !wasOnServer.has(row.vehicleId),
  );
  return [...merged, ...addedLocally];
};

/**
 * A vehicle just added from the picker — in the fleet, with nobody on it yet.
 *
 * An EMPTY row is meaningful here and is not a no-op: on the daily board "no crew, no annotations"
 * means nothing happened, while here it means "this vehicle is a cash-transfer vehicle and has no
 * standing crew yet". That is the fact the entity exists to record, so the row must be saveable.
 */
export const newStandingRow = (
  vehicle: OperationsStandingCrewBoardDto['available'][number],
): BoardRow => ({
  vehicleId: vehicle.vehicleId,
  vehicleCode: vehicle.vehicleCode,
  missionTypeId: null,
  captainEmployeeIds: toCells([]),
  specialist1EmployeeIds: toCells([]),
  specialist2EmployeeIds: toCells([]),
  direction: null,
  plannedTime: null,
  notes: null,
});
