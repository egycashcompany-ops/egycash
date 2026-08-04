// The vehicle registry service (fleet design §2.1, §4.1). Events fire at commit points only —
// after the repository write has succeeded — and every mutation is version-aware and audited.
import {
  FleetEvents,
  type ChangeFleetVehicleStatus,
  type CreateFleetVehicle,
  type ListFleetVehiclesQuery,
  type Paginated,
  type UpdateFleetVehicle,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleTypeRepository } from '../vehicle-types/vehicle-type.repository';
import { fleetMaintenanceRepository } from '../maintenance/maintenance.repository';
import { fleetVehicleRepository, vehicleSearchFilter } from './vehicle.repository';
import { canTransitionVehicle, isVehicleWritable } from './vehicle-status';
import { FleetVehicleModel, type FleetVehicleDoc } from './vehicle.model';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'vehicle', entityId: id });

/** The audited surface — everything an admin can change, nothing derived. */
const snapshot = (doc: FleetVehicleDoc) => ({
  code: doc.code,
  typeId: String(doc.typeId),
  plateNumber: doc.plateNumber,
  chassisNumber: doc.chassisNumber,
  motorNumber: doc.motorNumber,
  joinedAt: doc.joinedAt,
  licenseExpiresAt: doc.licenseExpiresAt,
  licenseClass: doc.licenseClass,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  departmentId: doc.departmentId === null ? null : String(doc.departmentId),
  radio: doc.radio,
  status: doc.status,
  statusReason: doc.statusReason,
});

const eventPayload = (doc: FleetVehicleDoc) => ({
  vehicleId: String(doc._id),
  code: doc.code,
  typeId: String(doc.typeId),
});

class FleetVehicleService {
  private async assertTypeActive(typeId: string): Promise<void> {
    const type = await fleetVehicleTypeRepository.findActiveById(typeId);
    if (type === null) {
      throw new ValidationError([
        { field: 'body.typeId', code: 'UNKNOWN', message: 'vehicle type not found or inactive' },
      ]);
    }
  }

  async create(input: CreateFleetVehicle, by: string): Promise<FleetVehicleDoc> {
    await this.assertTypeActive(input.typeId);
    // The unique partial indexes are the authority (FR-1); the pre-check exists only to name the
    // colliding field in the 409 instead of surfacing a raw duplicate-key error.
    const existing = await fleetVehicleRepository.findByCode(input.code);
    if (existing !== null) throw new ConflictError(`vehicle code "${input.code}" already exists`);

    const doc = await fleetVehicleRepository.create(
      {
        code: input.code,
        typeId: new Types.ObjectId(input.typeId),
        plateNumber: input.plateNumber,
        chassisNumber: input.chassisNumber,
        motorNumber: input.motorNumber,
        joinedAt: input.joinedAt,
        licenseExpiresAt: input.licenseExpiresAt,
        licenseClass: input.licenseClass ?? null,
        branchId: input.branchId == null ? null : new Types.ObjectId(input.branchId),
        departmentId: input.departmentId == null ? null : new Types.ObjectId(input.departmentId),
        radio: { issi: input.radio.issi ?? null, motorolaSn: input.radio.motorolaSn ?? null },
        status: 'active',
        statusReason: null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(FleetEvents.VehicleCreated, eventPayload(doc));
    return doc;
  }

  async list(
    query: ListFleetVehiclesQuery,
    scope: ScopeSelector,
  ): Promise<Paginated<FleetVehicleDoc>> {
    const clauses: FilterQuery<FleetVehicleDoc>[] = [];
    if (query.status !== undefined) clauses.push({ status: query.status });
    if (query.typeId !== undefined) clauses.push({ typeId: new Types.ObjectId(query.typeId) });
    if (query.branchId !== undefined) {
      clauses.push({ branchId: { $in: query.branchId.map((id) => new Types.ObjectId(id)) } });
    }
    if (query.licenseExpiresBefore !== undefined) {
      clauses.push({ licenseExpiresAt: { $lte: query.licenseExpiresBefore } });
    }
    if (query.search !== undefined) clauses.push(vehicleSearchFilter(query.search));
    const filter = clauses.length === 0 ? {} : { $and: clauses };
    return fleetVehicleRepository.listVehicles({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      scope,
    });
  }

  async getById(id: string, scope: ScopeSelector): Promise<FleetVehicleDoc> {
    return fleetVehicleRepository.getById(id, scope);
  }

  async update(
    id: string,
    input: UpdateFleetVehicle,
    by: string,
    scope: ScopeSelector,
  ): Promise<FleetVehicleDoc> {
    const before = await fleetVehicleRepository.getById(id, scope);
    if (!isVehicleWritable(before.status)) {
      throw new ConflictError('a disposed vehicle is history and cannot be edited');
    }
    if (input.typeId !== undefined) await this.assertTypeActive(input.typeId);

    const set: Partial<FleetVehicleDoc> = {};
    if (input.code !== undefined) set.code = input.code;
    if (input.typeId !== undefined) set.typeId = new Types.ObjectId(input.typeId);
    if (input.plateNumber !== undefined) set.plateNumber = input.plateNumber;
    if (input.chassisNumber !== undefined) set.chassisNumber = input.chassisNumber;
    if (input.motorNumber !== undefined) set.motorNumber = input.motorNumber;
    if (input.joinedAt !== undefined) set.joinedAt = input.joinedAt;
    if (input.licenseExpiresAt !== undefined) set.licenseExpiresAt = input.licenseExpiresAt;
    if (input.licenseClass !== undefined) set.licenseClass = input.licenseClass ?? null;
    if (input.branchId !== undefined) {
      set.branchId = input.branchId == null ? null : new Types.ObjectId(input.branchId);
    }
    if (input.departmentId !== undefined) {
      set.departmentId = input.departmentId == null ? null : new Types.ObjectId(input.departmentId);
    }
    if (input.radio !== undefined) {
      set.radio = { issi: input.radio.issi ?? null, motorolaSn: input.radio.motorolaSn ?? null };
    }

    const updated = await fleetVehicleRepository.updateById(id, set, {
      by,
      version: input.version,
      scope,
    });
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    await emit(FleetEvents.VehicleUpdated, eventPayload(updated));
    return updated;
  }

  async changeStatus(
    id: string,
    input: ChangeFleetVehicleStatus,
    by: string,
    scope: ScopeSelector,
  ): Promise<FleetVehicleDoc> {
    const before = await fleetVehicleRepository.getById(id, scope);
    if (!canTransitionVehicle(before.status, input.status)) {
      throw new ConflictError(
        `a ${before.status} vehicle cannot become ${input.status} (§4.1: disposed is terminal, no-ops are refused)`,
      );
    }
    const updated = await fleetVehicleRepository.updateById(
      id,
      // Returning to `active` clears the reason — the reason belongs to the absence, not the car.
      {
        status: input.status,
        statusReason: input.status === 'active' ? null : (input.reason ?? null),
      },
      { by, version: input.version, scope },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [
        { field: 'status', old: before.status, new: updated.status },
        { field: 'statusReason', old: before.statusReason, new: updated.statusReason },
      ],
    });
    await emit(FleetEvents.VehicleStatusChanged, {
      vehicleId: String(updated._id),
      code: updated.code,
      from: before.status,
      to: updated.status,
      reason: updated.statusReason,
    });
    return updated;
  }

  async softDelete(id: string, by: string, scope: ScopeSelector): Promise<void> {
    await fleetVehicleRepository.getById(id, scope);
    await fleetVehicleRepository.softDeleteById(id, { by, scope });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  /**
   * DERIVED `inWorkshop` (FR-12) — real since FL-4: vehicles with an open maintenance visit.
   * The single source of a vehicle's assignability (owner FL-5 point 2): FL-5's roster asks
   * this seam with the plan date (FR-5) instead of re-deriving workshop state anywhere else.
   */
  async openVisitVehicleIds(
    vehicleIds: readonly string[],
    coveringDate?: Date,
  ): Promise<ReadonlySet<string>> {
    return fleetMaintenanceRepository.openVisitVehicleIds(vehicleIds, coveringDate);
  }
}

export { FleetVehicleModel };
export const fleetVehicleService = new FleetVehicleService();
