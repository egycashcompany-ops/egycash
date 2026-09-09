// Violations + grievances (fleet design §4.7, FR-9). One collection, two shapes, and the shape
// decides who computes the money: a vehicle statement row NEVER accepts an amount — the server
// derives count × unitValue on create and on every edit that touches either factor — while a
// driver event row records the amount as entered. The grievance is one figure per
// (vehicle, year), upserted in place under a unique index. §8 publishes `.recorded` and
// `.grievanceApplied` only: edits and deletes are audited facts, not announcements.
import {
  FleetEvents,
  type FleetViolationKind,
  type FleetViolationRollupDto,
  type FleetViolationSide,
  type ListFleetViolationsQuery,
  type Paginated,
  type RecordFleetDriverViolation,
  type RecordFleetDriverViolations,
  type RecordFleetVehicleViolation,
  type SetFleetGrievance,
  type SetFleetViolationCollected,
  type SetRollupCollected,
  type UpdateFleetViolation,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { drivingSeatEmployeeIds } from '../driver-profiles/driving-seat-roster';
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
  collected: doc.collected,
});

const recordedPayload = (doc: FleetViolationDoc) => ({
  violationId: String(doc._id),
  kind: doc.kind,
  vehicleId: String(doc.vehicleId),
  driverEmployeeId: doc.driverEmployeeId === null ? null : String(doc.driverEmployeeId),
  year: doc.year,
  amount: doc.amount,
});

/** A row's kind IS its ledger: a vehicle statement row is the company's, a driver row the driver's. */
const sideOf = (kind: FleetViolationKind): FleetViolationSide =>
  kind === 'vehicle' ? 'company' : 'driver';

class FleetViolationService {
  /**
   * The type exists, is live, and belongs to the ledger doing the filing.
   *
   * The side is the whole point of the two halves: «سرعة» is a driver's fine and «رسوم قضائية»
   * is the company's, and a screen that let either be filed on the other side would put money in
   * the wrong column of the rollup — where `vehicleAmount` and `driverAmount` are what the branch
   * is judged on. The forms only OFFER their own side; this is what makes that true of the data
   * rather than merely of the dropdown.
   */
  private async assertViolationType(id: string, side: FleetViolationSide): Promise<void> {
    const item = await fleetCatalogItemRepository.findActiveOfKind(id, 'violationType');
    if (item === null) {
      throw invalid('violationTypeId', 'violation type not found or inactive');
    }
    if (item.violationSide !== side) {
      throw invalid(
        'violationTypeId',
        `"${item.name.ar}" is a ${item.violationSide ?? 'unclassified'} violation type and cannot be filed as a ${side} one`,
      );
    }
  }

  /** FR-9 — the statement row: (vehicle, year, type, count, unitValue) in, amount DERIVED. */
  async recordVehicle(input: RecordFleetVehicleViolation, by: string): Promise<FleetViolationDoc> {
    await fleetVehicleRepository.getById(input.vehicleId);
    await this.assertViolationType(input.violationTypeId, 'company');
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

  /**
   * Every one of these employees holds a driving seat — one read for however many are asked about.
   *
   * `fieldOf` names the request field for whichever id failed, so a batch can point at the row.
   */
  private async assertDrivers(
    employeeIds: readonly string[],
    fieldOf: (employeeId: string) => string,
  ): Promise<void> {
    const wanted = [...new Set(employeeIds)];
    if (wanted.length === 0) return;
    const seats = new Set(await drivingSeatEmployeeIds());
    for (const employeeId of wanted) {
      if (!seats.has(employeeId)) {
        throw invalid(fieldOf(employeeId), 'this employee does not hold a driving seat (FR-11)');
      }
    }
  }

  /**
   * The per-event driver row — the subject must BE a driver.
   *
   * Being a driver is holding a DRIVING SEAT, which is what the registry, both roster boards and
   * التمامات each mean by it. This used to demand a `fleet_driver_profile` instead, and that made
   * violations the one surface in Fleet with its own definition: a driver the roster could put on
   * a car all week could not be fined for anything they did in it, and the picker had to be
   * narrowed to the enrolled subset to stop offering people the server would refuse — which is
   * how that control inherited a 100-row cap. One definition ends both.
   *
   * A fine is HISTORY, so nothing here asks whether a profile is switched on: an old fine against
   * a driver since deactivated is still a fine that happened.
   */
  async recordDriver(input: RecordFleetDriverViolation, by: string): Promise<FleetViolationDoc> {
    await fleetVehicleRepository.getById(input.vehicleId);
    await this.assertViolationType(input.violationTypeId, 'driver');
    await this.assertDrivers([input.driverEmployeeId], () => 'driverEmployeeId');
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

  /**
   * One vehicle's driver fines in one act — the drivers' bar counts them, then names them.
   *
   * All or nothing, inside a single transaction: the bar is filled in one pass and a partial
   * write would leave the reader guessing which cards took. Every row is validated BEFORE any is
   * written, so a bad driver on card six refuses the whole batch instead of storing five.
   */
  async recordDriverBatch(
    input: RecordFleetDriverViolations,
    by: string,
  ): Promise<FleetViolationDoc[]> {
    await fleetVehicleRepository.getById(input.vehicleId);
    for (const row of input.rows) await this.assertViolationType(row.violationTypeId, 'driver');
    // One seat read for the whole batch, and the field path names the ROW that failed so the form
    // can point at the card the reader has to fix.
    await this.assertDrivers(
      input.rows.map((row) => row.driverEmployeeId),
      (employeeId) =>
        `rows.${input.rows.findIndex((row) => row.driverEmployeeId === employeeId)}.driverEmployeeId`,
    );

    const docs = await unitOfWork(async (session) =>
      fleetViolationRepository.createMany(
        input.rows.map((row) => ({
          kind: 'driver' as const,
          vehicleId: new Types.ObjectId(input.vehicleId),
          violationTypeId: new Types.ObjectId(row.violationTypeId),
          amount: row.amount,
          year: null,
          count: null,
          unitValue: null,
          date: row.date,
          driverEmployeeId: new Types.ObjectId(row.driverEmployeeId),
          collected: false,
        })),
        { by, session },
      ),
    );

    for (const doc of docs) {
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: diffChanges({}, snapshot(doc)),
      });
      await emit(FleetEvents.ViolationRecorded, recordedPayload(doc));
    }
    return docs;
  }

  /**
   * Mark the money in, or put it back. Its own write for its own reason (see the contract): the
   * person who collects is not the person who corrects, and the two acts must not share a form.
   */
  /**
   * Tick or untick a WHOLE (vehicle, year), which is what the board's own tick means.
   *
   * No optimistic version here, and that is deliberate rather than an omission: the caller is not
   * correcting one row it has read, it is asserting one fact about a group — «this car's 2026 is
   * settled». A version check would make the act fail because some other row in the group moved,
   * which is not a conflict with anything this caller said.
   */
  async setCollectedForYear(input: SetRollupCollected, _by: string): Promise<number> {
    const changed = await fleetViolationRepository.setCollectedForYear(
      input.vehicleId,
      input.year,
      input.collected,
    );
    if (changed > 0) {
      await auditService.record({
        entityRef: entityRef(`${input.vehicleId}:${input.year}`),
        action: 'update',
        changes: [
          {
            field: 'collected',
            old: !input.collected,
            new: input.collected,
          },
        ],
      });
    }
    return changed;
  }

  async setCollected(
    id: string,
    input: SetFleetViolationCollected,
    by: string,
  ): Promise<FleetViolationDoc> {
    const before = await fleetViolationRepository.getById(id);
    // Clicking a tick that is already ticked is not a change. Returning the row as it stands
    // keeps the version — and the audit trail — free of entries that say nothing happened.
    if (before.collected === input.collected) return before;
    const updated = await fleetViolationRepository.updateById(
      id,
      { collected: input.collected },
      { by, version: input.version },
    );
    await auditService.record({
      entityRef: entityRef(id),
      action: 'update',
      changes: diffChanges(snapshot(before), snapshot(updated)),
    });
    return updated;
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
      await this.assertViolationType(input.violationTypeId, sideOf(before.kind));
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
        await this.assertDrivers([input.driverEmployeeId], () => 'driverEmployeeId');
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
  /** Omit `year` for the whole history — one row per (vehicle, year). */
  async rollup(year: number | undefined, vehicleId?: string): Promise<FleetViolationRollupDto[]> {
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
      sums,
      grievances.map((g) => ({
        vehicleId: String(g.vehicleId),
        year: g.year,
        totalBeforeGrievance: g.totalBeforeGrievance,
      })),
      codes,
    );
  }
}

export const fleetViolationService = new FleetViolationService();
