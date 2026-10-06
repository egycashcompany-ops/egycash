// Vehicle types (fleet design §2.2). No domain events: the event surface (§8) deliberately has
// no `fleet.vehicleType.*` — a type edit is configuration, audited but not automatable.
import {
  type CreateFleetVehicleType,
  type OrderFleetVehicleTypes,
  type Paginated,
  type PaginationQuery,
  type UpdateFleetVehicleType,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleTypeRepository } from './vehicle-type.repository';
import { type FleetVehicleTypeDoc } from './vehicle-type.model';
import { withEnglishName } from '../catalogs/catalog-english';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'vehicleType',
  entityId: id,
});

const snapshot = (doc: FleetVehicleTypeDoc) => ({
  name: doc.name,
  maintenanceIntervalKm: doc.maintenanceIntervalKm,
  isActive: doc.isActive,
});

class FleetVehicleTypeService {
  async create(input: CreateFleetVehicleType, by: string): Promise<FleetVehicleTypeDoc> {
    const existing = await fleetVehicleTypeRepository.findByNameAr(input.name.ar);
    if (existing !== null) {
      throw new ConflictError(`Vehicle type "${input.name.ar}" already exists`);
    }
    const doc = await fleetVehicleTypeRepository.create(
      {
        // An English half that still carries Arabic is translated on the way in, as a catalog's is.
        name: withEnglishName(input.name),
        maintenanceIntervalKm: input.maintenanceIntervalKm,
        isActive: true,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    return doc;
  }

  async list(query: PaginationQuery): Promise<Paginated<FleetVehicleTypeDoc>> {
    return fleetVehicleTypeRepository.list({
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // No order asked for: the makes as ARRANGED on «قوائم الحركة», then by name for any not yet
      // placed — so every make picker and filter reads the order the reader set.
      ...(query.sortBy === undefined
        ? {
            sorts: [
              { by: 'sortOrder', dir: 'asc' as const },
              { by: 'name.ar', dir: 'asc' as const },
            ],
          }
        : {}),
      sortableFields: ['createdAt', 'name.ar', 'maintenanceIntervalKm', 'sortOrder'],
    });
  }

  /**
   * «قوائم الحركه اكيد هيرتب برضو الماركات» — save the makes' order. The ids named come first, in
   * the order given; any make not named keeps its place after them.
   */
  async order(input: OrderFleetVehicleTypes, by: string): Promise<void> {
    const all = await fleetVehicleTypeRepository.listAll();
    const byId = new Map(all.map((type) => [String(type._id), type]));
    const stranger = input.ids.find((id) => !byId.has(id));
    if (stranger !== undefined) throw new ConflictError(`${stranger} is not a make`);
    const current = [...all].sort(
      (a, b) =>
        (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
        a.name.ar.localeCompare(b.name.ar, 'ar'),
    );
    const named = new Set(input.ids);
    const ordered = [
      ...input.ids.map((id) => byId.get(id) as FleetVehicleTypeDoc),
      ...current.filter((type) => !named.has(String(type._id))),
    ];
    await fleetVehicleTypeRepository.writeOrder(
      ordered.map((type) => type._id),
      by,
    );
    const first = ordered[0];
    if (first === undefined) return;
    await auditService.record({
      entityRef: entityRef(String(first._id)),
      action: 'update',
      changes: [
        {
          field: 'order.vehicleTypes',
          old: current.map((type) => type.name.ar),
          new: ordered.map((type) => type.name.ar),
        },
      ],
    });
  }

  async getById(id: string): Promise<FleetVehicleTypeDoc> {
    return fleetVehicleTypeRepository.getById(id);
  }

  async update(
    id: string,
    input: UpdateFleetVehicleType,
    by: string,
  ): Promise<FleetVehicleTypeDoc> {
    const before = await fleetVehicleTypeRepository.getById(id);
    const set: Partial<FleetVehicleTypeDoc> = {};
    if (input.name !== undefined) set.name = withEnglishName(input.name);
    if (input.maintenanceIntervalKm !== undefined) {
      set.maintenanceIntervalKm = input.maintenanceIntervalKm;
    }
    if (input.isActive !== undefined) set.isActive = input.isActive;
    const updated = await fleetVehicleTypeRepository.updateById(id, set, {
      by,
      version: input.version,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
  }
}

export const fleetVehicleTypeService = new FleetVehicleTypeService();
