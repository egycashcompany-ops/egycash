// The ONE place Operations touches Fleet — the frozen §9.4 boundary made a single, reviewable
// import surface (fleet-module-design.md §9.4: "OPS reads `fleet_duty_assignments` by date and
// attaches work orders to `assignmentId`; mission-type catalog is Fleet-owned, OPS-readable.
// Fleet never knows what the mission did.").
//
// READ-ONLY by contract: Operations resolves duty rows and vehicle codes through these exports
// and never writes a Fleet collection. Anything Operations needs beyond a read goes through a
// Fleet-owned service, never around it.
import { MAX_PAGE_SIZE } from '@ecms/contracts';
import { fleetVehicleService } from '../fleet/vehicles/vehicle.service';
import { fleetVehicleRepository } from '../fleet/vehicles/vehicle.repository';

export { fleetDutyAssignmentRepository } from '../fleet/roster/duty-assignment.repository';
export { fleetVehicleRepository };

/** One car of the fleet as Operations offers it: its id and its code. */
export interface FleetVehicleOption {
  vehicleId: string;
  vehicleCode: string;
}

/**
 * Round 24 — «مكان بدون سيارة دا لما ادوس عليه يجيب كل السيارات اللى مش عليها طاقم»: EVERY ACTIVE car
 * of the fleet — Fleet's own status `active` and not deleted, so never one out of service or
 * disposed (vehicle-status.ts: Fleet's three statuses). Walks Fleet's own registry list a full page
 * at a time with no scope (the crew board is organization-wide, as the roster is), the shape
 * `it/fleet-boundary.ts` reads the same list in. A fleet is a few hundred cars: a page or three.
 */
export const fleetActiveVehicles = async (): Promise<FleetVehicleOption[]> => {
  const cars: FleetVehicleOption[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const result = await fleetVehicleRepository.listVehicles({
      filter: { status: 'active' },
      page,
      pageSize: MAX_PAGE_SIZE,
      sortBy: 'code',
      sortDir: 'asc',
    });
    for (const vehicle of result.items) {
      cars.push({ vehicleId: String(vehicle._id), vehicleCode: vehicle.code });
    }
    totalPages = result.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return cars;
};

/**
 * Round 24 — of these cars, the ones Fleet holds as ACTIVE (status `active`, not deleted), with
 * their codes: what the crew-board save asks of a van the roster does not have that day. A car
 * missing, deleted, out of service or disposed is simply absent from the answer.
 */
export const fleetActiveVehiclesByIds = async (
  vehicleIds: readonly string[],
): Promise<Map<string, string>> => {
  const cars = await fleetVehicleRepository.findByIdsSystem(vehicleIds);
  return new Map(
    cars
      .filter((car) => !car.isDeleted && car.status === 'active')
      .map((car) => [String(car._id), car.code] as const),
  );
};

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
