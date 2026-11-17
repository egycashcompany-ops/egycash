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
  CREW_SLOT_CAPACITY,
  type OperationsCrewMemberDto,
  type OperationsStandingCrewBoardDto,
  type OperationsStandingCrewRowDto,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import { SLOT_POSITIONS, slotOccupants, type BoardRow, type SlotCells } from './crew-board';
import {
  crewShortfall,
  placeMember,
  planChanges,
  rebaseDraft,
  rowPeople,
  seatOf,
  type CrewSlot,
  type PlanRow,
} from './crew-plan';
import { byVehicleCode, type VehicleChoice } from './crew-vehicles';

/** A stored slot → its cells, padded to capacity. Same rule as the daily board's `toCells`. */
const toCells = (ids: readonly string[] | undefined): SlotCells =>
  SLOT_POSITIONS.map((position) => ids?.[position] ?? null);

export const toStandingRows = (rows: readonly OperationsStandingCrewRowDto[]): BoardRow[] =>
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
 *
 * Round 27: the page no longer calls this — it edits the board's rows, and reconciles with
 * `rebaseStandingDraft` below, which keeps this promise for a row the planner TOUCHED too.
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

// ── Round 27 — the standing crew on the board's own rows ────────────────────────────────────────────
//
// THE OWNER: «عاوزك تخلى شاشة الطاقم الثابت نفس شكل لوحة التشغيل بقى فاهم». The screen is now the
// board's twin, so it edits the board's own row (`PlanRow`, `lib/crew-plan.ts`): a slot is ONE drop
// target holding up to CREW_SLOT_CAPACITY people, a drop appends and a full slot refuses (the
// board's `resolveDrop`), the save compares rows by `sameRow`. The card-position model above
// (`BoardRow`) is still what the payload is written from — `toStandingPayloadRows` is unchanged —
// so the wire the server reads does not move by a byte.
//
// What a standing row is, as a board row:
//   · its key is the van's — `van:<vehicleId>` — as the board keys a van's row;
//   · it is NOT on a day's roster (`onRoster: false`): the board's bin then REMOVES it rather than
//     emptying it — exactly «a vehicle can LEAVE the cash-transfer fleet»;
//   · `crewId` is the stored standing row's id (null for a vehicle added here and not yet saved),
//     which is how «حفظ» tells a vehicle taken out (`planChanges`' removed ids) from one never in;
//   · no drivers, no type, no colour, no notes — facts of a DAY, which this list has none of.

/** The server's standing rows → the board's rows, in the server's order (by code). */
export const toStandingPlanRows = (
  rows: readonly OperationsStandingCrewRowDto[] | undefined,
): PlanRow[] =>
  (rows ?? []).map((row) => ({
    key: `van:${row.vehicleId}`,
    vehicleId: row.vehicleId,
    vehicleCode: row.vehicleCode,
    onRoster: false,
    crewId: row.id,
    drivers: [],
    slots: {
      captain: row.captainEmployeeIds.slice(0, CREW_SLOT_CAPACITY),
      specialist1: row.specialist1EmployeeIds.slice(0, CREW_SLOT_CAPACITY),
      specialist2: row.specialist2EmployeeIds.slice(0, CREW_SLOT_CAPACITY),
    },
    direction: row.direction,
    plannedTime: row.plannedTime,
    shiftTypeId: null,
    rowColour: null,
    notes: null,
  }));

/** A board row → the card-position row the payload is written from (`toStandingPayloadRows`). */
export const standingBoardRow = (row: PlanRow): BoardRow => ({
  vehicleId: row.vehicleId ?? row.key,
  vehicleCode: row.vehicleCode ?? '',
  missionTypeId: null,
  captainEmployeeIds: toCells(row.slots.captain),
  specialist1EmployeeIds: toCells(row.slots.specialist1),
  specialist2EmployeeIds: toCells(row.slots.specialist2),
  direction: row.direction,
  plannedTime: row.plannedTime,
  notes: null,
});

/**
 * What «حفظ» sends, worked out by the board's own rule (`planChanges`): the rows to PUT — changed,
 * or added here (an empty one too: «in the fleet, nobody on it yet» is the fact the entity keeps) —
 * and the vehicles to DELETE, each a stored row no row on screen is any more. The PUT's body is
 * `toStandingPayloadRows`' — the same wire as before.
 */
export const standingSave = (
  rows: readonly PlanRow[],
  serverRows: readonly PlanRow[],
): {
  put: ReturnType<typeof toStandingPayloadRows>;
  removeVehicleIds: string[];
  count: number;
} => {
  const changes = planChanges(rows, serverRows);
  const removed = new Set(changes.removedCrewIds);
  const removeVehicleIds = serverRows
    .filter((row) => row.crewId !== null && removed.has(row.crewId) && row.vehicleId !== null)
    .map((row) => row.vehicleId as string);
  const put = toStandingPayloadRows(putRowsOf(changes).map(standingBoardRow));
  return { put, removeVehicleIds, count: put.length + removeVehicleIds.length };
};

/** The changed rows the PUT carries, in its order — every one has a vehicle on this list. */
const putRowsOf = (changes: ReturnType<typeof planChanges>): PlanRow[] =>
  changes.changed.filter((row) => row.vehicleId !== null);

/**
 * The rows «حفظ»'s PUT is written from, in the PUT's own order. A refusal that names a row names it
 * by its place in the PUT (`ROW_INDEX` — Round 23's «not his role's slot»), so the board's
 * `planRefusal` reads it against THESE rows and the page rings the person on that row.
 */
export const standingPutRows = (
  rows: readonly PlanRow[],
  serverRows: readonly PlanRow[],
): PlanRow[] => putRowsOf(planChanges(rows, serverRows));

/**
 * A vehicle's DELETE answered «not found»: another desk took it out after this list was read. The
 * end state «حفظ» asked for is already the server's (its `remove` says so: the second caller of a
 * race gets a NotFoundError for «the same end state») — so it is DONE, not a failure.
 */
export const isAlreadyRemoved = (failure: unknown): boolean =>
  failure instanceof ApiError && failure.status === 404;

/** How «حفظ» ended, and which vehicles were found already taken out on the way. */
export type StandingSaveOutcome = { alreadyGone: string[] } & (
  | { kind: 'saved' }
  | { kind: 'removeFailed'; vehicleId: string; failure: unknown }
  | { kind: 'putFailed'; failure: unknown }
);

/**
 * «حفظ»'s requests, in their order: each vehicle taken out (one DELETE each) — a person freed from
 * one of them may sit on another vehicle in the PUT, and the server checks one person, one vehicle
 * against the whole list — then the changed rows in ONE PUT (none when nothing but removals).
 *
 * A DELETE refused for any other reason stops the save there: the PUT behind it is not sent, and
 * what is left is exactly what is still to save. One answered «not found» does NOT stop it
 * (`isAlreadyRemoved`) — the screen would otherwise send that DELETE again on every press, fail
 * again, and never save the rest of the draft (Round 27 verification: a vehicle removed at another
 * desk left «حفظ» stuck until a reload threw the draft away).
 */
export const sendStandingSave = async (
  plan: { removeVehicleIds: readonly string[]; put: readonly unknown[] },
  send: { remove: (vehicleId: string) => Promise<unknown>; put: () => Promise<unknown> },
): Promise<StandingSaveOutcome> => {
  const alreadyGone: string[] = [];
  for (const vehicleId of plan.removeVehicleIds) {
    try {
      await send.remove(vehicleId);
    } catch (failure) {
      if (!isAlreadyRemoved(failure)) {
        return { kind: 'removeFailed', vehicleId, failure, alreadyGone };
      }
      alreadyGone.push(vehicleId);
    }
  }
  if (plan.put.length > 0) {
    try {
      await send.put();
    } catch (failure) {
      return { kind: 'putFailed', failure, alreadyGone };
    }
  }
  return { kind: 'saved', alreadyGone };
};

/**
 * The vehicles «حفظ» took out of the fleet before it STOPPED — saved on the server, whatever came
 * after. The DELETEs go first (`sendStandingSave`), so a PUT refused behind them, or a DELETE refused
 * after others went through, leaves vehicles already out that the planner must be TOLD of: the
 * re-read drops them from the table and from «تراجع», and «تعذّر الحفظ» alone reads as «nothing
 * was saved» (Round 27 review). A vehicle found already gone (404) is out too. Nothing when saved.
 */
export const removedBeforeStop = (
  plan: { removeVehicleIds: readonly string[] },
  outcome: StandingSaveOutcome,
): string[] => {
  if (outcome.kind === 'saved') return [];
  if (outcome.kind === 'putFailed') return [...plan.removeVehicleIds];
  const at = plan.removeVehicleIds.indexOf(outcome.vehicleId);
  return at <= 0 ? [] : plan.removeVehicleIds.slice(0, at);
};

/**
 * Another desk's answer under the draft — the board's `rebaseDraft`, with the standing crew's one
 * extra promise: A VEHICLE TAKEN OUT ON THE SERVER IS NOT BROUGHT BACK. The board's rebase keeps a
 * row the planner touched whose server row is gone («the save then says what became of it»): the
 * board's save names a saved row by its id and the server refuses one deleted. The standing PUT
 * names a row by its VEHICLE and upserts — so a touched row kept there would silently put the
 * vehicle, and its crew, back in the fleet on the next «حفظ» (Round 27 review). Such a row — it has
 * a stored row's id the new answer no longer holds — is dropped, as `mergeStandingRows` dropped it;
 * a vehicle added here and never saved (no id) stays. `standingEditsLost` names what was dropped.
 */
export const rebaseStandingDraft = (
  draft: readonly PlanRow[],
  base: readonly PlanRow[],
  next: readonly PlanRow[],
): readonly PlanRow[] => {
  const rebased = rebaseDraft(draft, base, next);
  const gone = goneOnServer(rebased, next);
  return gone.length === 0 ? rebased : rebased.filter((row) => !gone.includes(row));
};

/** The rows of the draft whose stored row the new answer no longer holds. */
const goneOnServer = (rows: readonly PlanRow[], next: readonly PlanRow[]): PlanRow[] => {
  const held = new Set(next.flatMap((row) => (row.crewId === null ? [] : [row.crewId])));
  return rows.filter((row) => row.crewId !== null && !held.has(row.crewId));
};

/**
 * The vehicles whose UNSAVED changes `rebaseStandingDraft` drops — taken out of the fleet on the
 * server while the planner held an edit of them. Said on the page, never dropped without a word. An
 * untouched vehicle taken out is simply the other desk's change showing, as on the board: not here.
 */
export const standingEditsLost = (
  draft: readonly PlanRow[],
  base: readonly PlanRow[],
  next: readonly PlanRow[],
): PlanRow[] => goneOnServer(rebaseDraft(draft, base, next), next);

/**
 * A vehicle joining the fleet from «إضافة سيارة» — at the end of the table, nobody on it yet. One the
 * server still holds (taken out here, then added back before «حفظ») keeps its stored row's id, so
 * the save sends an edit of that row rather than a removal and a new one.
 */
export const newStandingPlanRow = (
  vehicle: { vehicleId: string; vehicleCode: string },
  serverRows: readonly PlanRow[] = [],
): PlanRow => ({
  key: `van:${vehicle.vehicleId}`,
  vehicleId: vehicle.vehicleId,
  vehicleCode: vehicle.vehicleCode,
  onRoster: false,
  crewId: serverRows.find((row) => row.vehicleId === vehicle.vehicleId)?.crewId ?? null,
  drivers: [],
  slots: { captain: [], specialist1: [], specialist2: [] },
  direction: null,
  plannedTime: null,
  shiftTypeId: null,
  rowColour: null,
  notes: null,
});

/**
 * What «إضافة سيارة» offers, through the draft: the server's `available` (active, designated, in no
 * standing row), and a vehicle taken out here and not saved yet — less any vehicle a row of the
 * draft holds. By code, numbers in number order («9» before «150»), as the board's list orders them.
 */
export const standingVehicleChoices = (
  rows: readonly PlanRow[],
  serverRows: readonly PlanRow[],
  available: readonly { vehicleId: string; vehicleCode: string }[],
  designated: boolean,
): VehicleChoice[] => {
  const held = new Set(rows.flatMap((row) => (row.vehicleId === null ? [] : [row.vehicleId])));
  const takenOut = serverRows.flatMap((row) =>
    row.vehicleId === null || held.has(row.vehicleId)
      ? []
      : [{ vehicleId: row.vehicleId, vehicleCode: row.vehicleCode ?? row.vehicleId }],
  );
  const seen = new Set<string>();
  return [...available, ...takenOut]
    .filter((vehicle) => {
      if (held.has(vehicle.vehicleId) || seen.has(vehicle.vehicleId)) return false;
      seen.add(vehicle.vehicleId);
      return true;
    })
    .map((vehicle): VehicleChoice => ({
      vehicleId: vehicle.vehicleId,
      vehicleCode: vehicle.vehicleCode,
      // Narrowed to the cash-transfer operations' vehicles when that is configured; every active
      // vehicle otherwise — and the list's heading says which.
      group: designated ? 'cashTransfer' : 'other',
      onRoster: false,
      inWorkshop: false,
      drivers: [],
      vanKey: null,
      pickable: true,
    }))
    .sort(byVehicleCode);
};

/**
 * The roster AS THIS SCREEN READS IT: without the day's facts. The directory answers `availability`
 * (HR's absent / on leave) and `assignedVehicleId` for ONE day — the server's today when asked
 * with none. A dateless list must not fade a man absent today, nor refuse him a standing seat the
 * server would take (its save has no attendance gate): absence is a fact about a day, and the day's
 * board leaves him off when it loads this list (`standingForDay`). So both are dropped here, once,
 * and every shared piece — the pools, a slot's list, the drop's rule — sees nobody away.
 */
export const standingMember = (member: OperationsCrewMemberDto): OperationsCrewMemberDto => ({
  ...member,
  availability: null,
  assignedVehicleId: null,
});

/** A row's crew at a glance — the bar's counters (and their filter). */
export const STANDING_CREW_STATES = ['complete', 'short', 'empty'] as const;
export type StandingCrewState = (typeof STANDING_CREW_STATES)[number];

/**
 * `empty` — nobody on it yet; `short` — below the day's minimum (1 captain, 2 specialists:
 * `crewShortfall`, the board's own ⚠); `complete` — at least the minimum.
 */
export const standingCrewState = (row: PlanRow): StandingCrewState =>
  rowPeople(row).length === 0 ? 'empty' : crewShortfall(row) === null ? 'complete' : 'short';

/** The counters: every vehicle of the draft, and each state's share. */
export const standingCounts = (
  rows: readonly PlanRow[],
): { total: number } & Record<StandingCrewState, number> => {
  const counts = { total: rows.length, complete: 0, short: 0, empty: 0 };
  for (const row of rows) counts[standingCrewState(row)] += 1;
  return counts;
};

/**
 * A CAPTAIN MOVES WITH HIS CREW — the standing crew's own rule since it was built («لما أنقل قائد
 * طاقم على سيارة جديدة يسحب الأخصائيين اللى معاه», `assignCaptainWithCrew`), on the board's rows:
 * a captain seated in «قائد الطاقم» of one vehicle and put in «قائد الطاقم» of ANOTHER brings the
 * specialists who ride with him —
 *   · ALONE on his vehicle → every specialist of it (there is no other captain they could be with);
 *   · ONE OF TWO → the specialist on his own line of each specialist slot (the slot's list in the
 *     order it was filled: the first captain with the first specialist of each slot).
 * Each companion lands in the same slot of the new vehicle while it has room and he FITS it (Round
 * 23 — `fits`); one that would not fit or find room stays where he sits. Anything else — from a
 * pool, from a specialist's slot, within one vehicle — is the board's plain step (`placeMember`).
 * The captain's own place goes first: a slot that refuses him (full) moves nobody.
 */
export const placeWithCrew = (
  rows: readonly PlanRow[],
  key: string,
  slot: CrewSlot,
  employeeId: string,
  fits: (employeeId: string, slot: CrewSlot) => boolean,
): { rows: readonly PlanRow[]; companions: string[] } => {
  const seat = seatOf(rows, employeeId);
  const placed = placeMember(rows, key, slot, employeeId);
  if (placed === rows || slot !== 'captain' || seat === null || seat.slot !== 'captain') {
    return { rows: placed, companions: [] };
  }
  if (seat.key === key) return { rows: placed, companions: [] };
  const source = rows.find((row) => row.key === seat.key);
  if (source === undefined) return { rows: placed, companions: [] };
  const lone = source.slots.captain.length <= 1;
  const line = source.slots.captain.indexOf(employeeId);
  let next = placed;
  const companions: string[] = [];
  for (const each of ['specialist1', 'specialist2'] as const) {
    const riders = lone
      ? source.slots[each]
      : source.slots[each][line] === undefined
        ? []
        : [source.slots[each][line] as string];
    for (const rider of riders) {
      if (!fits(rider, each)) continue;
      const moved = placeMember(next, key, each, rider);
      if (moved !== next) companions.push(rider);
      next = moved;
    }
  }
  return { rows: next, companions };
};
