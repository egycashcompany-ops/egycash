// Violations + grievances (fleet design §4.7, FR-9). One collection, two shapes, and the shape
// decides who computes the money: a vehicle statement row NEVER accepts an amount — the server
// derives count × unitValue on create and on every edit that touches either factor — while a
// driver event row records the amount as entered. The grievance is one figure per
// (vehicle, year), upserted in place under a unique index. §8 publishes `.recorded` and
// `.grievanceApplied` only: edits and deletes are audited facts, not announcements.
import {
  FleetEvents,
  type FleetViolationRollupDto,
  type ListFleetViolationsQuery,
  type Paginated,
  type RecordFleetDriverViolation,
  type RecordFleetVehicleViolation,
  type SetFleetGrievance,
  type UpdateFleetViolation,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { fleetGrievanceRepository, fleetViolationRepository } from './violation.repository';
import { assembleRollups } from './violation-rollup';
import { type FleetGrievanceDoc, type FleetViolationDoc } from './violation.model';

const entityRef = (id: string) => ({ moduleId: 'fleet', entityType: 'violation', entityId: id });
const grievanceRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'violationGrievance',
  entityId: id,
});

const invalid = (field: string, message: string): ValidationError =>
  new ValidationError([{ field: `body.${field}`, code: 'INVALID', message }]);

const snapshot = (doc: FleetViolationDoc) => ({
  kind: doc.kind,
  vehicleId: String(doc.vehicleId),
  violationTypeId: String(doc.violationTypeId),
  amount: doc.amount,
  year: doc.year,
  count: doc.count,
  unitValue: doc.unitValue,
  date: doc.date,
  driverEmployeeId: doc.driverEmployeeId === null ? null : String(doc.driverEmployeeId),
});

const recordedPayload = (doc: FleetViolationDoc) => ({
  violationId: String(doc._id),
  kind: doc.kind,
  vehicleId: String(doc.vehicleId),
  driverEmployeeId: doc.driverEmployeeId === null ? null : String(doc.driverEmployeeId),
  year: doc.year,
  amount: doc.amount,
});

class FleetViolationService {
  private async assertViolationType(id: string): Promise<void> {
    const item = await fleetCatalogItemRepository.findActiveOfKind(id, 'violationType');
    if (item === null) {
      throw invalid('violationTypeId', 'violation type not found or inactive');
    }
  }

  /** FR-9 — the statement row: (vehicle, year, type, count, unitValue) in, amount DERIVED. */
  async recordVehicle(input: RecordFleetVehicleViolation, by: string): Promise<FleetViolationDoc> {
    await fleetVehicleRepository.getById(input.vehicleId);
    await this.assertViolationType(input.violationTypeId);
    const doc = await fleetViolationRepository.create(
      {
        kind: 'vehicle',
        vehicleId: new Types.ObjectId(input.vehicleId),
        violationTypeId: new Types.ObjectId(input.violationTypeId),
        amount: input.count * input.unitValue,
        year: input.year,
        count: input.count,
        unitValue: input.unitValue,
        date: null,
        driverEmployeeId: null,
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(FleetEvents.ViolationRecorded, recordedPayload(doc));
    return doc;
  }

  /** The per-event driver row — needs a driver PROFILE to exist (active or not: history counts). */
  async recordDriver(input: RecordFleetDriverViolation, by: string): Promise<FleetViolationDoc> {
    await fleetVehicleRepository.getById(input.vehicleId);
    await this.assertViolationType(input.violationTypeId);
    const profile = await fleetDriverProfileRepository.findDriverByEmployeeId(
      input.driverEmployeeId,
    );
    if (profile === null) {
      throw invalid('driverEmployeeId', 'no driver profile exists for this employee (FR-11)');
    }
    const doc = await fleetViolationRepository.create(
      {
        kind: 'driver',
        vehicleId: new Types.ObjectId(input.vehicleId),
        violationTypeId: new Types.ObjectId(input.violationTypeId),
        amount: input.amount,
        year: null,
        count: null,
        unitValue: null,
        date: input.date,
        driverEmployeeId: new Types.ObjectId(input.driverEmployeeId),
      },
      { by },
    );
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'create',
      changes: diffChanges({}, snapshot(doc)),
    });
    await emit(FleetEvents.ViolationRecorded, recordedPayload(doc));
    return doc;
  }

  async list(query: ListFleetViolationsQuery): Promise<Paginated<FleetViolationDoc>> {
    return fleetViolationRepository.listViolations({
      filter: fleetViolationRepository.violationFilter({
        ...query,
        // A violation stores its vehicle by id and never carries the code, so the picker's codes
        // are resolved against the registry first — the same two-step accidents and maintenance
        // take. `undefined` when nothing was picked; `[]` when the codes match no car, which
        // narrows to nothing rather than dropping the filter.
        ...(query.vehicleCodes === undefined
          ? {}
          : { vehicleIds: await fleetVehicleRepository.idsByCodes(query.vehicleCodes) }),
      }),
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }

  /**
   * Shape-guarded edit: the update schema carries both shapes' fields, so the SERVICE is where
   * a vehicle row refuses driver fields (and any client-sent amount — FR-9 recomputes it) and
   * a driver row refuses statement fields. Audited; publishes nothing (§8).
   */
  async update(id: string, input: UpdateFleetViolation, by: string): Promise<FleetViolationDoc> {
    const before = await fleetViolationRepository.getById(id);
    const set: Partial<FleetViolationDoc> = {};

    if (input.violationTypeId !== undefined) {
      await this.assertViolationType(input.violationTypeId);
      set.violationTypeId = new Types.ObjectId(input.violationTypeId);
    }

    if (before.kind === 'vehicle') {
      if (input.date !== undefined || input.driverEmployeeId !== undefined) {
        throw invalid('date', 'a vehicle statement row carries a year, not an event date/driver');
      }
      if (input.amount !== undefined) {
        throw invalid('amount', 'the amount of a vehicle row is count × unitValue (FR-9)');
      }
      const count = input.count ?? before.count ?? 1;
      const unitValue = input.unitValue ?? before.unitValue ?? 0;
      if (input.count !== undefined) set.count = input.count;
      if (input.unitValue !== undefined) set.unitValue = input.unitValue;
      if (input.count !== undefined || input.unitValue !== undefined) {
        set.amount = count * unitValue;
      }
    } else {
      if (input.count !== undefined || input.unitValue !== undefined) {
        throw invalid('count', 'a driver event row has no count/unitValue — its amount is entered');
      }
      if (input.date !== undefined) set.date = input.date;
      if (input.amount !== undefined) set.amount = input.amount;
      if (input.driverEmployeeId !== undefined) {
        const profile = await fleetDriverProfileRepository.findDriverByEmployeeId(
          input.driverEmployeeId,
        );
        if (profile === null) {
          throw invalid('driverEmployeeId', 'no driver profile exists for this employee (FR-11)');
        }
        set.driverEmployeeId = new Types.ObjectId(input.driverEmployeeId);
      }
    }

    const updated = await fleetViolationRepository.updateById(id, set, {
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
    await fleetViolationRepository.getById(id);
    await fleetViolationRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  /** H9's fate — ONE figure per (vehicle, year), upserted in place, every set published. */
  async setGrievance(input: SetFleetGrievance, by: string): Promise<FleetGrievanceDoc> {
    await fleetVehicleRepository.getById(input.vehicleId);
    const existing = await fleetGrievanceRepository.findByVehicleAndYear(
      input.vehicleId,
      input.year,
    );
    let doc: FleetGrievanceDoc;
    if (existing === null) {
      doc = await fleetGrievanceRepository.create(
        {
          vehicleId: new Types.ObjectId(input.vehicleId),
          year: input.year,
          totalBeforeGrievance: input.totalBeforeGrievance,
        },
        { by },
      );
      await auditService.record({
        entityRef: grievanceRef(String(doc._id)),
        action: 'create',
        changes: [
          { field: 'totalBeforeGrievance', old: null, new: String(input.totalBeforeGrievance) },
        ],
      });
    } else {
      doc = await fleetGrievanceRepository.updateById(
        String(existing._id),
        { totalBeforeGrievance: input.totalBeforeGrievance },
        { by, version: existing.__v },
      );
      await auditService.record({
        entityRef: grievanceRef(String(doc._id)),
        action: 'update',
        changes: [
          {
            field: 'totalBeforeGrievance',
            old: String(existing.totalBeforeGrievance),
            new: String(input.totalBeforeGrievance),
          },
        ],
      });
    }
    await emit(FleetEvents.GrievanceApplied, {
      vehicleId: input.vehicleId,
      year: input.year,
      totalBeforeGrievance: input.totalBeforeGrievance,
    });
    return doc;
  }

  /** §2.9 — the annual rollup, fully derived at query time: sums + grievances + codes merged. */
  async rollup(year: number, vehicleId?: string): Promise<FleetViolationRollupDto[]> {
    const [sums, grievances] = await Promise.all([
      fleetViolationRepository.yearSums(year, vehicleId),
      fleetGrievanceRepository.forYear(year, vehicleId),
    ]);
    const ids = [
      ...new Set([...sums.map((s) => s.vehicleId), ...grievances.map((g) => String(g.vehicleId))]),
    ];
    const codes = new Map<string, string>();
    for (const id of ids) {
      const vehicle = await fleetVehicleRepository.findById(id);
      if (vehicle !== null) codes.set(id, vehicle.code);
    }
    return assembleRollups(
      year,
      sums,
      grievances.map((g) => ({
        vehicleId: String(g.vehicleId),
        totalBeforeGrievance: g.totalBeforeGrievance,
      })),
      codes,
    );
  }
}

export const fleetViolationService = new FleetViolationService();
