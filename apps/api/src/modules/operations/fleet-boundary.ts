// The ONE place Operations touches Fleet — the frozen §9.4 boundary made a single, reviewable
// import surface (fleet-module-design.md §9.4: "OPS reads `fleet_duty_assignments` by date and
// attaches work orders to `assignmentId`; mission-type catalog is Fleet-owned, OPS-readable.
// Fleet never knows what the mission did.").
//
// READ-ONLY by contract: Operations resolves duty rows and vehicle codes through these exports
// and never writes a Fleet collection. Anything Operations needs beyond a read goes through a
// Fleet-owned service, never around it.
import { fleetVehicleService } from '../fleet/vehicles/vehicle.service';

export { fleetDutyAssignmentRepository } from '../fleet/roster/duty-assignment.repository';
export { fleetVehicleRepository } from '../fleet/vehicles/vehicle.repository';

/**
 * «صيانة» on the crew board (Round 20) — which of these vehicles Fleet's workshop holds on `day`.
 *
 * A READ PORT onto Fleet's own answer, not a second derivation of it: `openVisitVehicleIds` is "the
 * single source of a vehicle's assignability" (vehicle.service.ts, owner FL-5 point 2) — the seam
 * Fleet's roster itself asks with the plan date (FR-5). A visit counts when it is open and began by
 * the end of `day`. Only this one function is exported, so Operations reads the workshop through
 * the seam and reaches nothing else of the vehicle service.
 */
export const fleetVehiclesInWorkshop = (
  vehicleIds: readonly string[],
  day: Date,
): Promise<ReadonlySet<string>> => fleetVehicleService.openVisitVehicleIds(vehicleIds, day);
