// التمامات — the operational overlay (fleet design §2.4, owner decision Q1). Events fire only
// after the write has committed: `.recorded` on create, `.ended` on cancellation. A date
// correction (update) is audited but publishes nothing — it adjusts a fact, it is not a new one.
import {
  FleetEvents,
  type CreateFleetUnavailability,
  type ListFleetUnavailabilityQuery,
  type Paginated,
  type UpdateFleetUnavailability,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { fleetUnavailabilityRepository } from './unavailability.repository';
import { type FleetUnavailabilityDoc } from './unavailability.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'driverUnavailability',
  entityId: id,
});

const snapshot = (doc: FleetUnavailabilityDoc) => ({
  employeeId: String(doc.employeeId),
  from: doc.from,
  to: doc.to,
  reason: doc.reason,
  notes: doc.notes,
});

const eventPayload = (doc: FleetUnavailabilityDoc) => ({
  employeeId: String(doc.employeeId),
  from: doc.from,
  to: doc.to,
  reason: doc.reason,
});

class FleetUnavailabilityService {
  async create(input: CreateFleetUnavailability, by: string): Promise<FleetUnavailabilityDoc> {
    // §2.4: the subject must hold a driver profile — التمامات is about the driver pool.
    const profile = await fleetDriverProfileRepository.findDriverByEmployeeId(input.employeeId);
    if (profile === null) {
      throw new ValidationError([
        {
          field: 'body.employeeId',
          code: 'UNKNOWN',
          message: 'no driver profile for this employee',
        },
      ]);
    }
    const doc = await fleetUnavailabilityRepository.create(
      {
        employeeId: new Types.ObjectId(input.employeeId),
        from: input.from,
        to: input.to,
        reason: input.reason,
        notes: input.notes ?? null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(FleetEvents.UnavailabilityRecorded, eventPayload(doc));
    return doc;
  }

  async list(query: ListFleetUnavailabilityQuery): Promise<Paginated<FleetUnavailabilityDoc>> {
    const clauses: FilterQuery<FleetUnavailabilityDoc>[] = [];
    if (query.employeeId !== undefined) {
      clauses.push({ employeeId: new Types.ObjectId(query.employeeId) });
    }
    if (query.coversDate !== undefined) {
      clauses.push(fleetUnavailabilityRepository.coversDateFilter(query.coversDate));
    }
    return fleetUnavailabilityRepository.listSpans({
      filter: clauses.length === 0 ? {} : { $and: clauses },
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  async update(
    id: string,
    input: UpdateFleetUnavailability,
    by: string,
  ): Promise<FleetUnavailabilityDoc> {
    const before = await fleetUnavailabilityRepository.getById(id);
    const set: Partial<FleetUnavailabilityDoc> = {};
    if (input.from !== undefined) set.from = input.from;
    if (input.to !== undefined) set.to = input.to;
    if (input.reason !== undefined) set.reason = input.reason;
    if (input.notes !== undefined) set.notes = input.notes ?? null;

    const from = set.from ?? before.from;
    const to = set.to ?? before.to;
    if (to < from) {
      throw new ValidationError([
        {
          field: 'body.to',
          code: 'INVALID',
          message: 'unavailability cannot end before it starts',
        },
      ]);
    }
    const updated = await fleetUnavailabilityRepository.updateById(id, set, {
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

  /** Cancellation — the unavailability ends as a fact, so `.ended` is published (post-commit). */
  async cancel(id: string, by: string): Promise<void> {
    const doc = await fleetUnavailabilityRepository.getById(id);
    await fleetUnavailabilityRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
    await emit(FleetEvents.UnavailabilityEnded, eventPayload(doc));
  }
}

export const fleetUnavailabilityService = new FleetUnavailabilityService();
