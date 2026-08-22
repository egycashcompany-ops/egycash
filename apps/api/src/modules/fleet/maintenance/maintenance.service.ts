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
import { getSelfDirectoryEmployee } from '../../../platform/directory';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetDutyAssignmentRepository } from '../roster/duty-assignment.repository';
import { isVehicleWritable } from '../vehicles/vehicle-status';
import {
  fleetMaintenanceRepository,
  type FleetMaintenanceVisitRow,
} from './maintenance.repository';
import { type FleetMaintenanceVisitDoc } from './maintenance.model';

/**
 * A page of visits plus the registry codes for exactly the vehicles ON that page — one lookup,
 * not one per row, and bounded by the page rather than by how many vehicles the registry holds.
 * The same shape the odometer list answers with.
 */
export type MaintenanceVisitPage = Paginated<FleetMaintenanceVisitRow> & {
  codes: ReadonlyMap<string, string>;
};

/**
 * One visit with the two facts that do not live on it: the registry's code for its vehicle, and
 * the roster crew of the day it went in. A write answers with the same row shape a list does, so
 * a client never has to reconcile two versions of the same record.
 */
export interface MaintenanceVisitWithJoins {
  doc: FleetMaintenanceVisitDoc;
  vehicleCode: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
}

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
  sparePartIds: (doc.sparePartIds ?? []).map(String),
  odometerAtService: doc.odometerAtService,
  exitOdometer: doc.exitOdometer ?? null,
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

  /**
   * Every chosen part must be a LIVE item of the `sparePart` catalog.
   *
   * Checked here rather than trusted from the client for the same reason the workshop and the
   * work type are: an id is not a fact, and a part that has been retired should stop being
   * fittable rather than keep appearing on new visits.
   */
  private async assertSpareParts(ids: readonly string[]): Promise<void> {
    for (const [at, id] of ids.entries()) {
      const item = await fleetCatalogItemRepository.findActiveOfKind(id, 'sparePart');
      if (item === null) {
        throw new ValidationError([
          {
            field: `body.sparePartIds.${at}`,
            code: 'UNKNOWN',
            message: 'sparePart not found or inactive',
          },
        ]);
      }
    }
  }

  /**
   * Custody, from the login rather than from a field the operator fills in.
   *
   * Who handed the car over is a fact the server already knows, and asking for it again is how
   * the two disagree. The platform directory answers "which employee IS this login" — the same
   * seam Fleet already reads names through.
   *
   * `null` is a legitimate answer: a platform account (the seeded super-admin) has no employee
   * behind it. The explicit field is honoured when given, so the fact stays recordable for those
   * accounts instead of being silently lost.
   */
  private async custodian(
    byUserId: string,
    explicit: string | null | undefined,
  ): Promise<Types.ObjectId | null> {
    if (explicit != null) return new Types.ObjectId(explicit);
    const self = await getSelfDirectoryEmployee(byUserId);
    return self === null ? null : new Types.ObjectId(self.employeeId);
  }

  /**
   * The read-side facts a single visit answers with, resolved the same way the list resolves them
   * — the registry for the code, the roster for the crew of the check-in day.
   */
  private async withJoins(doc: FleetMaintenanceVisitDoc): Promise<MaintenanceVisitWithJoins> {
    const vehicleId = String(doc.vehicleId);
    const [codes, crew] = await Promise.all([
      fleetVehicleRepository.codesByIds([vehicleId]),
      fleetDutyAssignmentRepository.findForVehicleOnDate(vehicleId, doc.inDate),
    ]);
    return {
      doc,
      vehicleCode: codes.get(vehicleId) ?? null,
      driver1EmployeeId: crew?.driver1EmployeeId == null ? null : String(crew.driver1EmployeeId),
      driver2EmployeeId: crew?.driver2EmployeeId == null ? null : String(crew.driver2EmployeeId),
    };
  }

  async checkIn(input: CheckInFleetMaintenance, by: string): Promise<MaintenanceVisitWithJoins> {
    const vehicle = await fleetVehicleRepository.getById(input.vehicleId);
    if (!isVehicleWritable(vehicle.status)) {
      throw new ConflictError('a disposed vehicle cannot enter a workshop');
    }
    await this.assertCatalogRef(input.workshopId, 'workshop', 'workshopId');
    await this.assertCatalogRef(input.workTypeId, 'workType', 'workTypeId');
    await this.assertSpareParts(input.sparePartIds);
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
        sparePartIds: input.sparePartIds.map((id) => new Types.ObjectId(id)),
        // Verbatim, and only when a caller actually sent it — never derived from the catalog ids.
        spareParts: input.spareParts ?? [],
        odometerAtService: input.odometerAtService,
        takenInByEmployeeId: await this.custodian(by, input.takenInByEmployeeId),
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
    return this.withJoins(doc);
  }

  async checkOut(
    id: string,
    input: CheckOutFleetMaintenance,
    by: string,
  ): Promise<MaintenanceVisitWithJoins> {
    const before = await fleetMaintenanceRepository.getById(id);
    if (before.outDate !== null) throw new ConflictError('this visit is already closed');
    if (input.outDate < before.inDate) {
      throw new ValidationError([
        { field: 'body.outDate', code: 'INVALID', message: 'check-out cannot precede check-in' },
      ]);
    }
    // The car cannot leave on a lower reading than it arrived on — that is a typo, and it would
    // make the next service fall due early once this becomes the baseline.
    if (input.exitOdometer < before.odometerAtService) {
      throw new ValidationError([
        {
          field: 'body.exitOdometer',
          code: 'INVALID',
          message: 'the exit reading cannot be below the reading the vehicle came in on',
        },
      ]);
    }
    const updated = await fleetMaintenanceRepository.updateById(
      id,
      {
        outDate: input.outDate,
        exitOdometer: input.exitOdometer,
        takenOutByEmployeeId: await this.custodian(by, input.takenOutByEmployeeId),
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
    return this.withJoins(updated);
  }

  /** Legacy `deleted_dock=5` — undo a mistaken check-out. Refused if the slot is taken again. */
  async reopen(id: string, version: number, by: string): Promise<MaintenanceVisitWithJoins> {
    const before = await fleetMaintenanceRepository.getById(id);
    if (before.outDate === null) throw new ConflictError('this visit is already open');
    const open = await fleetMaintenanceRepository.findOpen(String(before.vehicleId));
    if (open !== null) {
      throw new ConflictError('the vehicle already has an open visit (FR-4)');
    }
    const updated = await fleetMaintenanceRepository.updateById(
      id,
      // Reopening un-closes the visit, so the exit reading goes with it: a car that is back
      // in the workshop has not left, and leaving the number behind would keep feeding a baseline
      // for a service that is not finished.
      { outDate: null, exitOdometer: null, takenOutByEmployeeId: null },
      { by, version },
    );
    const vehicle = await fleetVehicleRepository.getById(String(before.vehicleId));
    await auditService.record({
      entityRef: entityRef(id),
      action: 'reopen',
      changes: [{ field: 'outDate', old: before.outDate, new: null }],
    });
    await emit(FleetEvents.MaintenanceReopened, eventPayload(updated, vehicle.code));
    return this.withJoins(updated);
  }

  async update(
    id: string,
    input: UpdateFleetMaintenance,
    by: string,
  ): Promise<MaintenanceVisitWithJoins> {
    const before = await fleetMaintenanceRepository.getById(id);
    if (input.workshopId !== undefined) {
      await this.assertCatalogRef(input.workshopId, 'workshop', 'workshopId');
    }
    if (input.workTypeId !== undefined) {
      await this.assertCatalogRef(input.workTypeId, 'workType', 'workTypeId');
    }
    if (input.sparePartIds !== undefined) await this.assertSpareParts(input.sparePartIds);
    // The same rule check-out enforces, against whichever of the two readings this edit leaves
    // in place: an edit that lowers the exit reading below the entry one is the same typo, and it
    // would corrupt the baseline just as quietly.
    const entry = input.odometerAtService ?? before.odometerAtService;
    const exit = input.exitOdometer === undefined ? before.exitOdometer : input.exitOdometer;
    if (exit != null && exit < entry) {
      throw new ValidationError([
        {
          field: 'body.exitOdometer',
          code: 'INVALID',
          message: 'the exit reading cannot be below the reading the vehicle came in on',
        },
      ]);
    }
    const set: Partial<FleetMaintenanceVisitDoc> = {};
    if (input.inDate !== undefined) set.inDate = input.inDate;
    if (input.workshopId !== undefined) set.workshopId = new Types.ObjectId(input.workshopId);
    if (input.workTypeId !== undefined) set.workTypeId = new Types.ObjectId(input.workTypeId);
    if (input.sparePartIds !== undefined) {
      set.sparePartIds = input.sparePartIds.map((id) => new Types.ObjectId(id));
    }
    if (input.spareParts !== undefined) set.spareParts = input.spareParts;
    if (input.exitOdometer !== undefined) set.exitOdometer = input.exitOdometer ?? null;
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
    return this.withJoins(updated);
  }

  async softDelete(id: string, by: string): Promise<void> {
    await fleetMaintenanceRepository.getById(id);
    await fleetMaintenanceRepository.softDeleteById(id, { by });
    await auditService.record({ entityRef: entityRef(id), action: 'delete' });
  }

  /**
   * The one filter that names something the visit collection does not store: a vehicle CODE.
   *
   * The code lives in the registry, so it is resolved here — where the registry is reachable — and
   * the repository stays a query over its own documents. A code that matches no vehicle narrows to
   * NOTHING rather than being dropped: dropping it would answer a narrowed question with every
   * visit in the system.
   *
   * The DRIVER filter is deliberately NOT resolved here. It needs the roster row for each visit's
   * own day, which is a join, and doing it in the service would mean fetching visits, checking
   * them, and paginating what survived — a page cut from a bounded fetch, so a driver with more
   * history than that bound would silently lose the rest. It belongs in the pipeline.
   */
  private async vehicleScope(query: ListFleetMaintenanceQuery): Promise<string[] | undefined> {
    if (query.vehicleCodes === undefined) return undefined;
    const matched = await fleetVehicleRepository.list({
      filter: { code: { $in: [...query.vehicleCodes] } },
      page: 1,
      pageSize: query.vehicleCodes.length,
    });
    return matched.items.map((vehicle) => String(vehicle._id));
  }

  async list(query: ListFleetMaintenanceQuery): Promise<MaintenanceVisitPage> {
    const vehicleIds = await this.vehicleScope(query);
    const page = await fleetMaintenanceRepository.listVisits({
      filter: fleetMaintenanceRepository.visitFilter({
        ...query,
        ...(vehicleIds === undefined ? {} : { vehicleIds }),
      }),
      driverEmployeeIds: query.driverEmployeeIds,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
    const codes = await fleetVehicleRepository.codesByIds([
      ...new Set(page.items.map((item) => String(item.vehicleId))),
    ]);
    return { ...page, codes };
  }
}

export const fleetMaintenanceService = new FleetMaintenanceService();
