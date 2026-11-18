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
// ROUND 28b — THE PEOPLE AND «الاتجاه», NEVER THE TIME. Asked «لما تعمل «تحميل الطاقم الثابت» على
// «لوحة التشغيلة»، بينزل الناس بس من غير الاتجاه والتوقيت … تحب الاتجاه ينزل كمان؟», the owner answered
// «اه». Asked about the direction only, so the direction only: the time (التوقيت), the notes, the
// type and the colour stay the day's. The direction follows the two rules above and two more:
//
//   3. ONLY ON A VEHICLE THE LOAD FILLS (somebody placed by rules 1 and 2), and only when that day's
//      row has NO direction. A direction on the day's row — typed by the planner, saved this
//      morning — is kept, never overwritten: the same «never overwrite visible work».
//
//   4. NEVER ONE THE DAY'S SAVE WOULD REFUSE (`standingDirectionForDay`, the server's own rule in
//      `crew/crew-direction.ts`): tidied (`normalizeOperationsDirection`); naming nothing (blank,
//      «-») → not copied; naming active areas → copied in the areas' own spelling, as the save
//      stores it; anything else is hand-typed → copied as typed, unless it is longer than
//      `OPERATIONS_DIRECTION_MAX_LENGTH`. A legacy standing row may hold such text (kept there while
//      sent unchanged); on the day it would be NEW, and «حفظ» after the load must always go through.
//      Round 28b critic — judged on the text the load WRITES (the respelling), as the save judges
//      what it is sent; and a direction that names something but is left behind is counted
//      (`directionsLeftBehind`), for the screen to say so, as it says whose seat it left empty.
//
// Off again clears that direction too — but only while the row still holds exactly what the load
// wrote (`directionsPut`). One the planner changed after the load is his, and stays.
//
// AND A VEHICLE THAT IS NOT ON TODAY'S BOARD IS NOT A FAILURE. "لو فى طاقم على سيارة والسيارة مش
// متاحه سيب الطاقم بدون تحميله على سيارة" — the board lists only the vehicles Fleet rostered for
// the date, so a standing crew whose van is in the yard today has nowhere to go. Its people are
// left in the pool, free to be dragged onto whatever IS out, rather than forced somewhere wrong or
// silently swallowed. `unavailableVehicleIds` is what lets the screen say so.
import {
  OPERATIONS_DIRECTION_MAX_LENGTH,
  canonicalOperationsDirection,
  normalizeOperationsDirection,
  operationsDirectionNamesSomething,
} from '@ecms/contracts';
import { CREW_SLOTS, SLOT_POSITIONS, rowCrew, type BoardRow, type SlotCells } from './crew-board';

/** One standing row, reduced to what the load needs. */
export interface StandingCrewSource {
  vehicleId: string;
  captainEmployeeIds: string[];
  specialist1EmployeeIds: string[];
  specialist2EmployeeIds: string[];
  /** Round 28b — the standing row's «الاتجاه», as stored there (rules 3 and 4 decide if it is copied). */
  direction: string | null;
}

export interface StandingLoad {
  rows: BoardRow[];
  /** Vehicles this load filled — exactly what switching the toggle off clears again. */
  filledVehicleIds: string[];
  /**
   * Round 28b — the direction this load wrote, by vehicle: on a vehicle it filled whose row had
   * none (rules 3 and 4). Switching off clears it only while the row still holds exactly this.
   */
  directionsPut: Record<string, string>;
  /**
   * Round 28b critic — vehicles it filled whose row had no direction, whose standing direction
   * names something the day's save would refuse (`standingDirectionForDay` null: typed by hand past
   * the ceiling — a legacy row's, or areas while their list is unknown). Left empty, and said.
   */
  directionsLeftBehind: string[];
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

/**
 * The day's save on a NEW direction, as it judges the very text it is sent — does it take it? The
 * server's `directionResolver` (`crew/crew-direction.ts`) line for line, less the «kept» case: the
 * day's row has no direction of its own where the load writes one (rule 3).
 */
const daySaveTakes = (sent: string, areaNames: readonly string[]): boolean => {
  const typed = normalizeOperationsDirection(sent);
  if (!operationsDirectionNamesSomething(typed)) return false;
  if ('direction' in canonicalOperationsDirection(typed, areaNames)) return true;
  return typed.length <= OPERATIONS_DIRECTION_MAX_LENGTH;
};

/**
 * Rule 4 — the standing direction as the day's save would store it NEW on a row, or null when that
 * save would refuse it (it is then not copied). `areaNames`: the ACTIVE operations areas, as the
 * save reads them — none known, a direction of areas is judged as typed by hand.
 *
 * Round 28b critic — the save judges the text the load SENDS, which is the respelling, not the
 * standing row's text: so the respelling is judged again before it is written. (A respelling the
 * save would read as hand-typed past the ceiling — an area whose name holds a separator, before
 * `canonicalOperationsDirection` read such runs — is not written; the standing row's own text is,
 * when the save takes that, and the save respells it itself.)
 */
export const standingDirectionForDay = (
  direction: string | null | undefined,
  areaNames: readonly string[],
): string | null => {
  if (direction == null) return null;
  const typed = normalizeOperationsDirection(direction);
  const canonical = canonicalOperationsDirection(typed, areaNames);
  for (const sent of 'direction' in canonical ? [canonical.direction, typed] : [typed]) {
    if (daySaveTakes(sent, areaNames)) return sent;
  }
  return null;
};

/**
 * Round 28b critic — did the load leave a standing direction behind on a vehicle it filled: one
 * that names something, on a row with none of its own, which the day's save would refuse
 * (`standingDirectionForDay` null)? The screen names those vans, as it names whose seat it left.
 */
const directionLeftBehind = (direction: string | null, areaNames: readonly string[]): boolean =>
  direction !== null &&
  operationsDirectionNamesSomething(normalizeOperationsDirection(direction)) &&
  standingDirectionForDay(direction, areaNames) === null;

/**
 * Switch the toggle on. `areaNames`: the ACTIVE operations areas (`standingDirectionForDay`) — the
 * board passes them; without them nothing the save refuses is copied either.
 */
export const loadStandingCrew = (
  rows: readonly BoardRow[],
  standing: readonly StandingCrewSource[],
  areaNames: readonly string[] = [],
): StandingLoad => {
  const byVehicle = new Map(standing.map((row) => [row.vehicleId, row]));
  const onBoard = new Set(rows.flatMap(rowCrew));
  const filledVehicleIds: string[] = [];
  const directionsPut: Record<string, string> = {};
  const directionsLeftBehind: string[] = [];

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
    if (placed === 0) return { ...row }; // rule 3 — not filled, so no direction either
    filledVehicleIds.push(row.vehicleId);
    // Rule 3 — the day's own direction is kept; rule 4 — never one the save would refuse.
    const direction =
      row.direction === null ? standingDirectionForDay(source.direction, areaNames) : null;
    if (direction !== null) directionsPut[row.vehicleId] = direction;
    else if (row.direction === null && directionLeftBehind(source.direction, areaNames)) {
      directionsLeftBehind.push(row.vehicleId);
    }
    return {
      ...row,
      captainEmployeeIds: cells(taken.captain),
      specialist1EmployeeIds: cells(taken.specialist1),
      specialist2EmployeeIds: cells(taken.specialist2),
      direction: direction ?? row.direction,
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

  return {
    rows: next,
    filledVehicleIds,
    directionsPut,
    directionsLeftBehind,
    unavailableVehicleIds,
  };
};

/**
 * Switch the toggle back off — empty exactly the vehicles the load filled.
 *
 * It clears those rows rather than restoring a snapshot of what they held before. A snapshot taken
 * at load time goes stale the moment the operator drags anything, and putting it back would undo
 * edits made AFTER the toggle went on. Clearing only what the toggle filled leaves every other
 * decision on the board untouched.
 *
 * Round 28b — the direction the load wrote (`directionsPut`) goes too, but only while the row still
 * holds exactly that one: a direction the planner typed over it after the load is his, and stays.
 */
export const clearStandingCrew = (
  rows: readonly BoardRow[],
  filledVehicleIds: readonly string[],
  directionsPut: Readonly<Record<string, string>> = {},
): BoardRow[] => {
  const filled = new Set(filledVehicleIds);
  return rows.map((row) => {
    if (!filled.has(row.vehicleId)) return { ...row };
    const next = { ...row };
    for (const slot of CREW_SLOTS) next[FIELD_OF[slot]] = cells([]);
    if (wroteDirection(directionsPut, row.vehicleId, row.direction)) next.direction = null;
    return next;
  });
};

/** Is `direction` still exactly what the load wrote on this row (`directionsPut`)? */
export const wroteDirection = (
  directionsPut: Readonly<Record<string, string>>,
  key: string,
  direction: string | null,
): boolean =>
  direction !== null && Object.hasOwn(directionsPut, key) && directionsPut[key] === direction;
