// Workshop visits (fleet design §4.2). Single-document writes; events fire after the write has
// committed, per the FL-2/FL-3 discipline and owner FL-4 point 6.
import {
  FleetEvents,
  type CheckInFleetMaintenance,
  type CheckOutFleetMaintenance,
  type ListFleetMaintenanceQuery,
  type Paginated,
  type UpdateFleetMaintenance,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { isVehicleWritable } from '../vehicles/vehicle-status';
import { fleetMaintenanceRepository } from './maintenance.repository';
import { type FleetMaintenanceVisitDoc } from './maintenance.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'maintenanceVisit',
  entityId: id,
});

const snapshot = (doc: FleetMaintenanceVisitDoc) => ({
  vehicleId: String(doc.vehicleId),
  inDate: doc.inDate,
  outDate: doc.outDate,
  workshopId: String(doc.workshopId),
  workTypeId: String(doc.workTypeId),
  spareParts: doc.spareParts,
  odometerAtService: doc.odometerAtService,
  notes: doc.notes,
});

const eventPayload = (doc: FleetMaintenanceVisitDoc, code: string) => ({
  visitId: String(doc._id),
  vehicleId: String(doc.vehicleId),
  code,
  workshopId: String(doc.workshopId),
  workTypeId: String(doc.workTypeId),
  odometerAtService: doc.odometerAtService,
});

class FleetMaintenanceService {
  private async assertCatalogRef(
    id: string,
    kind: 'workshop' | 'workType',
    field: string,
  ): Promise<void> {
    const item = await fleetCatalogItemRepository.findActiveOfKind(id, kind);
    if (item === null) {
      throw new ValidationError([
        { field: `body.${field}`, code: 'UNKNOWN', message: `${kind} not found or inactive` },
      ]);
    }
  }

  async checkIn(input: CheckInFleetMaintenance, by: string): Promise<FleetMaintenanceVisitDoc> {
    const vehicle = await fleetVehicleRepository.getById(input.vehicleId);
    if (!isVehicleWritable(vehicle.status)) {
      throw new ConflictError('a disposed vehicle cannot enter a workshop');
    }
    await this.assertCatalogRef(input.workshopId, 'workshop', 'workshopId');
    await this.assertCatalogRef(input.workTypeId, 'workType', 'workTypeId');
    // FR-4 — the unique partial index is the authority; the pre-check names the conflict.
    const open = await fleetMaintenanceRepository.findOpen(input.vehicleId);
    if (open !== null) {
      throw new ConflictError(`vehicle ${vehicle.code} is already in a workshop (FR-4)`);
    }

    const doc = await fleetMaintenanceRepository.create(
      {
        vehicleId: new Types.ObjectId(input.vehicleId),
        inDate: input.inDate,
        outDate: null,
        workshopId: new Types.ObjectId(input.workshopId),
        workTypeId: new Types.ObjectId(input.workTypeId),
        spareParts: input.spareParts,
        odometerAtService: input.odometerAtService,
        takenInByEmployeeId:
          input.takenInByEmployeeId == null ? null : new Types.ObjectId(input.takenInByEmployeeId),
        takenOutByEmployeeId: null,
        notes: input.notes ?? null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(FleetEvents.MaintenanceCheckedIn, eventPayload(doc, vehicle.code));
    return doc;
  }

  async checkOut(
    id: string,
    input: CheckOutFleetMaintenance,
    by: string,
  ): Promise<FleetMaintenanceVisitDoc> {
    const before = await fleetMaintenanceRepository.getById(id);
    if (before.outDate !== null) throw new ConflictError('this visit is already closed');
    if (input.outDate < before.inDate) {
      throw new ValidationError([
        { field: 'body.outDate', code: 'INVALID', message: 'check-out cannot precede check-in' },
      ]);
    }
    const updated = await fleetMaintenanceRepository.updateById(
      id,
      {
        outDate: input.outDate,
        takenOutByEmployeeId:
          input.takenOutByEmployeeId == null
            ? null
            : new Types.ObjectId(input.takenOutByEmployeeId),
      },
      { by, version: input.version },
    );
    const vehicle = await fleetVehicleRepository.getById(String(before.vehicleId));
    await auditService.record({
      entityRef: entityRef(id),
      action: 'checkOut',
      changes: [{ field: 'outDate', old: null, new: updated.outDate }],
    });
    await emit(FleetEvents.MaintenanceCheckedOut, eventPayload(updated, vehicle.code));
    return updated;
  }

  /** Legacy `deleted_dock=5` — undo a mistaken check-out. Refused if the slot is taken again. */
  async reopen(id: string, version: number, by: string): Promise<FleetMaintenanceVisitDoc> {
    const before = await fleetMaintenanceRepository.getById(id);
    if (before.outDate === null) throw new ConflictError('this visit is already open');
    const open = await fleetMaintenanceRepository.findOpen(String(before.vehicleId));
    if (open !== null) {
      throw new ConflictError('the vehicle already has an open visit (FR-4)');
    }
    const updated = await fleetMaintenanceRepository.updateById(
      id,
      { outDate: null, takenOutByEmployeeId: null },
      { by, version },
    );
    const vehicle = await fleetVehicleRepository.getById(String(before.vehicleId));
    await auditService.record({
      entityRef: entityRef(id),
      action: 'reopen',
      changes: [{ field: 'outDate', old: before.outDate, new: null }],
    });
    await emit(FleetEvents.MaintenanceReopened, eventPayload(updated, vehicle.code));
    return updated;
  }

  async update(
    id: string,
    input: UpdateFleetMaintenance,
    by: string,
  ): Promise<FleetMaintenanceVisitDoc> {
    const before = await fleetMaintenanceRepository.getById(id);
    if (input.workshopId !== undefined) {
      await this.assertCatalogRef(input.workshopId, 'workshop', 'workshopId');
    }
    if (input.workTypeId !== undefined) {
      await this.assertCatalogRef(input.workTypeId, 'workType', 'workTypeId');
    }
    const set: Partial<FleetMaintenanceVisitDoc> = {};
    if (input.inDate !== undefined) set.inDate = input.inDate;
    if (input.workshopId !== undefined) set.workshopId = new Types.ObjectId(input.workshopId);
    if (input.workTypeId !== undefined) set.workTypeId = new Types.ObjectId(input.workTypeId);
    if (input.spareParts !== undefined) set.spareParts = input.spareParts;
    if (input.odometerAtService !== undefined) set.odometerAtService = input.odometerAtService;
    if (input.takenInByEmployeeId !== undefined) {
      set.takenInByEmployeeId =
        input.takenInByEmployeeId == null ? null : new Types.ObjectId(input.takenInByEmployeeId);
    }
    if (input.notes !== undefined) set.notes = input.notes ?? null;

    const updated = await fleetMaintenanceRepository.updateById(id, set, {
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

  async softDelete(id: string, by: string): Promise<void> {
    await fleetMaintenanceRepository.getById(id);
    await fleetMaintenanceRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  async list(query: ListFleetMaintenanceQuery): Promise<Paginated<FleetMaintenanceVisitDoc>> {
    return fleetMaintenanceRepository.listVisits({
      filter: fleetMaintenanceRepository.visitFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }
}

export const fleetMaintenanceService = new FleetMaintenanceService();
