// The ONE place IT touches Fleet (docs/12-planning/it-vehicle-checks-design.md §5, amending IT
// §3 and §9.2). The vehicle device checks («فحص أجهزة السيارة», FR-21) need Fleet's car list and
// nothing else of Fleet's.
//
// Unlike `operations/fleet-boundary.ts` and `gold/fleet-boundary.ts`, this file does NOT re-export
// the repository: it exports three READ functions built on it, so IT holds no Fleet write method
// at all — not one guarded only by a comment. An ESLint `no-restricted-imports` rule makes this
// file the only one under `modules/it/` that may import from `modules/fleet`.
//
// No function applies a data scope. The reporter's grant is IT's own `itVehicleCheck.create`, and
// the design decides (§4) that every active car is offered and may be filed on whatever the
// reporter's scope: `own` over cars would be no car at all, and a branch scope would hide the cars
// of other branches a reporter is sent to check. The dashboard's reader IS scoped — but by IT's
// own `itVehicleCheck.view`, which Fleet knows nothing of, so IT applies it to the cars this file
// hands back (vehicle-check-dashboard.ts), never Fleet.
import { MAX_PAGE_SIZE, type Paginated } from '@ecms/contracts';
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

/** One active car as the dashboard counts it: its code and its CURRENT branch. */
export interface ItVehicleOnBoard {
  id: string;
  code: string;
  /** Where the car is now — Fleet's type allows none on old records. */
  branchId: string | null;
}

/**
 * EVERY active, non-deleted car, in FLEET'S CODE ORDER — the dashboard's «سيارة نشطة» and the rows
 * of «حالة أجهزة كل سيارة» («الـ Dashboard … هتبقي عند الـ IT»). Walks `listVehicles` a full page
 * at a time, so the order is Fleet's own three-group rule and not a re-sort here; about two hundred
 * cars is two pages.
 */
export const listActiveVehiclesForCheckBoard = async (): Promise<ItVehicleOnBoard[]> => {
  const cars: ItVehicleOnBoard[] = [];
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
      cars.push({
        id: String(vehicle._id),
        code: vehicle.code,
        branchId: vehicle.branchId == null ? null : String(vehicle.branchId),
      });
    }
    totalPages = result.meta.totalPages;
    page += 1;
  } while (page <= totalPages);
  return cars;
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
