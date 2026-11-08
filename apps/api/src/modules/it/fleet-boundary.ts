// The ONE place IT touches Fleet (docs/12-planning/it-vehicle-checks-design.md §5, amending IT
// §3 and §9.2). The vehicle device checks («فحص أجهزة السيارة», FR-21) need Fleet's car list and
// nothing else of Fleet's.
//
// Unlike `operations/fleet-boundary.ts` and `gold/fleet-boundary.ts`, this file does NOT re-export
// the repository: it exports two READ functions built on it, so IT holds no Fleet write method at
// all — not one guarded only by a comment. An ESLint `no-restricted-imports` rule makes this file
// the only one under `modules/it/` that may import from `modules/fleet`.
//
// Neither function applies a data scope. The reporter's grant is IT's own `itVehicleCheck.create`,
// and the design decides (§4) that every active car is offered and may be filed on whatever the
// reporter's scope: `own` over cars would be no car at all, and a branch scope would hide the cars
// of other branches a reporter is sent to check.
import { type Paginated } from '@ecms/contracts';
import { fleetVehicleRepository } from '../fleet/vehicles/vehicle.repository';

/** One active car, as the form's dropdown lists it. */
export interface ItVehicleOption {
  id: string;
  code: string;
}

/** The car facts a report snapshots, plus the status IT judges. */
export interface ItVehicleForCheck {
  id: string;
  code: string;
  /** Fleet's type allows none on old records; such a car is filed with no branch. */
  branchId: string | null;
  status: string;
}

/**
 * One page of the active, non-deleted cars in FLEET'S CODE ORDER — through `listVehicles` with
 * `sortBy: 'code'`, which maps onto Fleet's own three-group rule; the generic `list()` would
 * silently sort by creation date instead.
 */
export const listActiveVehicleCodes = async (params: {
  page: number;
  pageSize: number;
}): Promise<Paginated<ItVehicleOption>> => {
  const page = await fleetVehicleRepository.listVehicles({
    filter: { status: 'active' },
    page: params.page,
    pageSize: params.pageSize,
    sortBy: 'code',
    sortDir: 'asc',
  });
  return {
    items: page.items.map((vehicle) => ({ id: String(vehicle._id), code: vehicle.code })),
    meta: page.meta,
  };
};

/** The car a report is filed on — `null` for a missing or deleted car. IT decides what a status means. */
export const findVehicleForCheck = async (id: string): Promise<ItVehicleForCheck | null> => {
  const vehicle = await fleetVehicleRepository.findById(id);
  if (vehicle === null) return null;
  return {
    id: String(vehicle._id),
    code: vehicle.code,
    branchId: vehicle.branchId == null ? null : String(vehicle.branchId),
    status: vehicle.status,
  };
};
