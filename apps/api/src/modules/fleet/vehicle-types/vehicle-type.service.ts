// Vehicle types (fleet design §2.2). No domain events: the event surface (§8) deliberately has
// no `fleet.vehicleType.*` — a type edit is configuration, audited but not automatable.
import {
  type CreateFleetVehicleType,
  type Paginated,
  type PaginationQuery,
  type UpdateFleetVehicleType,
} from '@ecms/contracts';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleTypeRepository } from './vehicle-type.repository';
import { type FleetVehicleTypeDoc } from './vehicle-type.model';

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
      { name: input.name, maintenanceIntervalKm: input.maintenanceIntervalKm, isActive: true },
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
      sortableFields: ['createdAt', 'name.ar', 'maintenanceIntervalKm'],
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
    if (input.name !== undefined) set.name = input.name;
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
