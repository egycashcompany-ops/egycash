// The licensing board (التراخيص) and its one write.
//
// The board is a JOIN, not a collection: the registry says which cars are on it, and this
// module's own rows say what has been done to them. Nothing about membership is stored here —
// see `licensing.model.ts` for why — so a car appears and disappears as an admin renames its
// licence class, with no migration and no second list to keep in step.
import {
  type FleetLicensingRowDto,
  type SetFleetLicensingMark,
} from '@ecms/contracts';
import { NotFoundError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { type FleetVehicleDoc } from '../vehicles/vehicle.model';
import { isLicensingClass } from './licensing-class';
import { fleetVehicleLicensingRepository } from './licensing.repository';
import { type FleetVehicleLicensingDoc } from './licensing.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'vehicleLicensing',
  entityId: id,
});

const PAGE = 100;

class FleetLicensingService {
  /**
   * Every car on the board, its papers beside it, sorted by code.
   *
   * Unpaginated on purpose. The board is a checklist a clerk works DOWN — «ومفيش سكرول» is the
   * standing complaint about every Fleet screen that hid rows — and it is bounded by the fleet
   * itself: the «ت» classes are a subset of a registry of a few hundred cars, not a log that
   * grows with time. A page here would also break the one thing this screen is for, which is
   * seeing at a glance which cars still owe a paper.
   */
  async board(scope: ScopeSelector): Promise<FleetLicensingRowDto[]> {
    const classes = (await fleetCatalogItemRepository.listKind('licenseClass')).filter((item) =>
      isLicensingClass(item.name.ar),
    );
    // No «ت» class at all is an ordinary empty board, not an error: a fleet that has not named
    // its licensing offices yet has nothing to show, and asking the registry for `$in: []` would
    // be a query nobody needs to run.
    if (classes.length === 0) return [];
    const classNames = new Map(classes.map((item) => [String(item._id), item.name.ar]));

    const vehicles = await this.vehiclesOfClasses([...classNames.keys()], scope);
    const marks = await fleetVehicleLicensingRepository.findForVehicles(
      vehicles.map((vehicle) => String(vehicle._id)),
    );
    const byVehicle = new Map(marks.map((row) => [String(row.vehicleId), row]));

    return vehicles.map((vehicle) => {
      const id = String(vehicle._id);
      const row: FleetVehicleLicensingDoc | undefined = byVehicle.get(id);
      return {
        vehicleId: id,
        code: vehicle.code,
        plateNumber: vehicle.plateNumber,
        chassisNumber: vehicle.chassisNumber,
        licenseClass:
          vehicle.licenseClassId === null ? null : (classNames.get(String(vehicle.licenseClassId)) ?? null),
        // A car nobody has ticked anything for has no row, and reads as four falses rather than
        // being given one — the board must be readable without writing to it.
        insuranceHandover: row?.insuranceHandover ?? false,
        insuranceReceipt: row?.insuranceReceipt ?? false,
        taxHandover: row?.taxHandover ?? false,
        taxReceipt: row?.taxReceipt ?? false,
      };
    });
  }

  /**
   * Tick or untick ONE square.
   *
   * The vehicle is checked against the BOARD, not merely against the registry: a car whose class
   * is «برقاش م» is not on this screen, and a tick for it would be a mark nobody can see, undo or
   * explain. 404 rather than 422 because from this endpoint's side the car genuinely is not there
   * — which is also what a stale tab will be told when the class was renamed under it.
   */
  async setMark(input: SetFleetLicensingMark, by: string, scope: ScopeSelector): Promise<void> {
    const vehicle = await fleetVehicleRepository.getById(input.vehicleId, scope);
    const klass =
      vehicle.licenseClassId === null
        ? null
        : await fleetCatalogItemRepository.findById(String(vehicle.licenseClassId));
    if (!isLicensingClass(klass?.name.ar)) {
      throw new NotFoundError('This vehicle is not on the licensing board');
    }

    const before = await fleetVehicleLicensingRepository.findForVehicles([input.vehicleId]);
    const was = before[0]?.[input.mark] ?? false;
    await fleetVehicleLicensingRepository.setMark(input.vehicleId, input.mark, input.value, by);
    // An unchanged square is a no-op the audit trail should not carry: a clerk clicking twice has
    // done one thing, and a log that says otherwise makes the real changes harder to find.
    if (was === input.value) return;
    await auditService.record({
      entityRef: entityRef(input.vehicleId),
      action: 'update',
      changes: [{ field: input.mark, old: was, new: input.value }],
    });
  }

  /** Every vehicle pointing at one of these classes, in code order, scope-aware. */
  private async vehiclesOfClasses(
    classIds: readonly string[],
    scope: ScopeSelector,
  ): Promise<FleetVehicleDoc[]> {
    const vehicles: FleetVehicleDoc[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await fleetVehicleRepository.listVehicles({
        filter: { licenseClassId: { $in: [...classIds] } },
        page,
        pageSize: PAGE,
        sortBy: 'code',
        scope,
      });
      vehicles.push(...batch.items);
      if (batch.items.length < PAGE) return vehicles;
    }
  }
}

export const fleetLicensingService = new FleetLicensingService();
