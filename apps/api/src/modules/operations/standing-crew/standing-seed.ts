// What the descent would do to one day's board — as a pure function over four facts.
//
// The standing crew, the day's Fleet roster, the crew rows the day already has, and who is
// unavailable. Nothing here reads a database or writes one, which is what lets the rule be tested
// exhaustively: the integration suite needs mongod and only runs in CI, and this is the part where
// getting it wrong would quietly overwrite a real morning's plan.
//
// THE VETO. A (day, vehicle) that already has a crew row is skipped ENTIRELY — not merged into,
// not topped up. `plan()` has no delete path, so clearing a slot stores an empty list: "nobody has
// filled this yet" and "the captain called in sick and was taken off" are byte-identical on disk.
// A field-level merge cannot tell them apart and would put the sick captain back every morning.
// Row existence is the only signal that survives, so the row is what the veto is keyed on.
//
// WHAT IT DECLINES, IT REPORTS. A seed that quietly plans four of nine vehicles and says "done"
// teaches an operator to trust a board that is missing five crews.
import {
  type OperationsCrewSeedDropReason,
  type OperationsCrewSeedSkipReason,
  type PlanOperationsCrewRow,
} from '@ecms/contracts';

/** One standing row, reduced to what the seed needs. Ids as strings — no mongoose types here. */
export interface StandingSeedSource {
  vehicleId: string;
  captainEmployeeIds: string[];
  specialist1EmployeeIds: string[];
  specialist2EmployeeIds: string[];
  direction: string | null;
  plannedTime: string | null;
}

export interface StandingSeedInput {
  /** The whole standing crew — the template. */
  standing: readonly StandingSeedSource[];
  /** Vehicle ids Fleet rostered for this date. The §9.4 anchor: only these can carry a crew. */
  rosteredVehicleIds: ReadonlySet<string>;
  /** Vehicle ids that ALREADY have a crew row on this operating day. The veto set. */
  plannedVehicleIds: ReadonlySet<string>;
  /** employeeId → the vehicle they already hold on this day (Q11), from `takenCrew`. */
  takenBy: ReadonlyMap<string, string>;
  /** Employees who cannot be assigned, and why. Absent from the map means available. */
  unavailable: ReadonlyMap<string, Extract<OperationsCrewSeedDropReason, 'exited' | 'unknown'>>;
}

export interface StandingSeedPlan {
  /** Ready to hand straight to `operationsCrewService.plan` — empty when there is nothing to do. */
  rows: PlanOperationsCrewRow[];
  skipped: { vehicleId: string; reason: OperationsCrewSeedSkipReason }[];
  dropped: { employeeId: string; vehicleId: string; reason: OperationsCrewSeedDropReason }[];
}

const SLOTS = [
  'captainEmployeeIds',
  'specialist1EmployeeIds',
  'specialist2EmployeeIds',
] as const;

export const planStandingSeed = (input: StandingSeedInput): StandingSeedPlan => {
  const rows: PlanOperationsCrewRow[] = [];
  const skipped: StandingSeedPlan['skipped'] = [];
  const dropped: StandingSeedPlan['dropped'] = [];

  for (const source of input.standing) {
    // Order matters for the REPORT, not just the logic: an operator reading "already planned"
    // learns something different from "not rostered", and the first true reason is the useful one.
    if (input.plannedVehicleIds.has(source.vehicleId)) {
      skipped.push({ vehicleId: source.vehicleId, reason: 'alreadyPlanned' });
      continue;
    }
    if (!input.rosteredVehicleIds.has(source.vehicleId)) {
      // `plan()` would refuse this with OPERATIONS_FLEET_DUTY_REQUIRED and take the whole seed down
      // with it. A vehicle sitting in the yard today is normal, not an error.
      skipped.push({ vehicleId: source.vehicleId, reason: 'notRostered' });
      continue;
    }

    const kept: Record<(typeof SLOTS)[number], string[]> = {
      captainEmployeeIds: [],
      specialist1EmployeeIds: [],
      specialist2EmployeeIds: [],
    };
    for (const slot of SLOTS) {
      for (const employeeId of source[slot]) {
        const unavailable = input.unavailable.get(employeeId);
        if (unavailable !== undefined) {
          dropped.push({ employeeId, vehicleId: source.vehicleId, reason: unavailable });
          continue;
        }
        // Q11 WINS OVER THE STANDING CREW. Somebody moved this person onto another vehicle for
        // today, by hand, after the standing crew was written; the day's plan is the more recent
        // and more specific statement, and `plan()` would refuse the whole seed over it anyway.
        const heldElsewhere = input.takenBy.get(employeeId);
        if (heldElsewhere !== undefined && heldElsewhere !== source.vehicleId) {
          dropped.push({ employeeId, vehicleId: source.vehicleId, reason: 'takenElsewhere' });
          continue;
        }
        kept[slot].push(employeeId);
      }
    }

    const total = SLOTS.reduce((n, slot) => n + kept[slot].length, 0);
    if (total === 0) {
      // Seeding a crewless row would be actively harmful, not merely useless: the row would exist,
      // and its existence is the veto — so it would block every later seed of this vehicle-day
      // while carrying nobody. Direction and time alone are not worth that.
      skipped.push({ vehicleId: source.vehicleId, reason: 'noCrewToSeed' });
      continue;
    }

    rows.push({
      vehicleId: source.vehicleId,
      captainEmployeeIds: kept.captainEmployeeIds,
      specialist1EmployeeIds: kept.specialist1EmployeeIds,
      specialist2EmployeeIds: kept.specialist2EmployeeIds,
      direction: source.direction,
      plannedTime: source.plannedTime,
      // The standing crew has no notes, and the day's row starts without one. A note belongs to
      // the day somebody writes it on.
      notes: null,
    });
  }

  return { rows, skipped, dropped };
};
