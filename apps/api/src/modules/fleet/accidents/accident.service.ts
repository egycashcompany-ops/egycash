// Accidents (fleet design §4.6, FR-10). Single-document writes: repository write → audit →
// event, the FL-2 commit-point pattern. Status flips both ways — the legacy toggled freely and
// the design keeps that — but a no-op flip is refused, so every published event is a real change.
// Recording is allowed against ANY registered vehicle including a disposed one: an accident is
// historical paperwork about the day it happened, not a new operational fact about the car.
import {
  FleetEvents,
  type CreateFleetAccident,
  type ListFleetAccidentsQuery,
  type Paginated,
  type SetFleetAccidentStatus,
  type UpdateFleetAccident,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetAccidentRepository } from './accident.repository';
import { type FleetAccidentDoc } from './accident.model';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'accident', entityId: id });

const snapshot = (doc: FleetAccidentDoc) => ({
  vehicleId: String(doc.vehicleId),
  occurredAt: doc.occurredAt,
  culprit: doc.culprit,
  statement: doc.statement,
  companyCost: doc.companyCost,
  amountCollected: doc.amountCollected,
  paidAmount: doc.paidAmount,
  status: doc.status,
  notes: doc.notes,
});

const eventPayload = (doc: FleetAccidentDoc, code: string) => ({
  accidentId: String(doc._id),
  vehicleId: String(doc.vehicleId),
  code,
  companyCost: doc.companyCost,
  amountCollected: doc.amountCollected,
  paidAmount: doc.paidAmount,
});

class FleetAccidentService {
  async create(input: CreateFleetAccident, by: string): Promise<FleetAccidentDoc> {
    const vehicle = await fleetVehicleRepository.getById(input.vehicleId);
    const doc = await fleetAccidentRepository.create(
      {
        vehicleId: new Types.ObjectId(input.vehicleId),
        occurredAt: input.occurredAt,
        culprit: input.culprit,
        statement: input.statement,
        companyCost: input.companyCost,
        amountCollected: input.amountCollected,
        paidAmount: input.paidAmount,
        status: 'open',
        notes: input.notes ?? null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(FleetEvents.AccidentRecorded, eventPayload(doc, vehicle.code));
    return doc;
  }

  async list(query: ListFleetAccidentsQuery): Promise<Paginated<FleetAccidentDoc>> {
    return fleetAccidentRepository.listAccidents({
      filter: fleetAccidentRepository.accidentFilter(query),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  /** Facts edit — audited, version-aware, publishes nothing (§8 lists no accident.updated). */
  async update(id: string, input: UpdateFleetAccident, by: string): Promise<FleetAccidentDoc> {
    const before = await fleetAccidentRepository.getById(id);
    const set: Partial<FleetAccidentDoc> = {};
    if (input.vehicleId !== undefined) {
      await fleetVehicleRepository.getById(input.vehicleId);
      set.vehicleId = new Types.ObjectId(input.vehicleId);
    }
    if (input.occurredAt !== undefined) set.occurredAt = input.occurredAt;
    if (input.culprit !== undefined) set.culprit = input.culprit;
    if (input.statement !== undefined) set.statement = input.statement;
    if (input.companyCost !== undefined) set.companyCost = input.companyCost;
    if (input.amountCollected !== undefined) set.amountCollected = input.amountCollected;
    if (input.paidAmount !== undefined) set.paidAmount = input.paidAmount;
    if (input.notes !== undefined) set.notes = input.notes ?? null;

    const updated = await fleetAccidentRepository.updateById(id, set, {
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

  /** FR-10 — open↔closed, both directions, each audited and published; a no-op is refused. */
  async setStatus(
    id: string,
    input: SetFleetAccidentStatus,
    by: string,
  ): Promise<FleetAccidentDoc> {
    const before = await fleetAccidentRepository.getById(id);
    if (before.status === input.status) {
      throw new ConflictError(`the accident is already ${input.status} (FR-10 refuses no-ops)`);
    }
    const updated = await fleetAccidentRepository.updateById(
      id,
      { status: input.status },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'statusChange',
      changes: [{ field: 'status', old: before.status, new: updated.status }],
    });
    const vehicle = await fleetVehicleRepository.getById(String(updated.vehicleId));
    await emit(
      input.status === 'closed' ? FleetEvents.AccidentClosed : FleetEvents.AccidentReopened,
      eventPayload(updated, vehicle.code),
    );
    return updated;
  }

  async softDelete(id: string, by: string): Promise<void> {
    await fleetAccidentRepository.getById(id);
    await fleetAccidentRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }
}

export const fleetAccidentService = new FleetAccidentService();
