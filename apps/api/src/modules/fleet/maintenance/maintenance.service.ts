// Workshop visits (fleet design §4.2). Single-document writes; events fire after the write has
// committed, per the FL-2/FL-3 discipline and owner FL-4 point 6.
import {
  FLEET_DASHBOARD_RANK_ROWS,
  FleetEvents,
  calendarDayBounds,
  compareFleetVehicleCodes,
  daysBetweenYmd,
  parseFleetSort,
  ymdOf,
  type CheckInFleetMaintenance,
  type CheckOutFleetMaintenance,
  type FleetDashboardNowWorkshopDto,
  type FleetDashboardPeriodVisitsDto,
  type FleetDashboardRecentVisitDto,
  type ListFleetMaintenanceQuery,
  type LocalizedString,
  type Paginated,
  type UpdateFleetMaintenance,
} from '@ecms/contracts';
import { Types, type FilterQuery } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { getDirectoryEmployee, getSelfDirectoryEmployee } from '../../../platform/directory';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetDealershipService } from '../dealership/dealership.service';
import {
  fleetVehicleRepository,
  intersectVehicleIds,
  vehicleSetPart,
} from '../vehicles/vehicle.repository';
import { resolveVehicleFilterIds, type VehicleFilter } from '../vehicles/vehicle-set';
import { fleetOdometerRepository } from '../odometer/odometer.repository';
import { alarmSortsFor } from './alarm-sort';
import { isVehicleWritable } from '../vehicles/vehicle-status';
import {
  fleetMaintenanceRepository,
  type FleetMaintenanceVisitRow,
} from './maintenance.repository';
import { type FleetMaintenanceVisitDoc } from './maintenance.model';
import { vehicleIdOf, vehicleIdsOf } from '../fleet.mappers';

/**
 * A page of visits plus the registry codes for exactly the vehicles ON that page — one lookup,
 * not one per row, and bounded by the page rather than by how many vehicles the registry holds.
 * The same shape the odometer list answers with.
 */
export type MaintenanceVisitPage = Paginated<FleetMaintenanceVisitRow> & {
  codes: ReadonlyMap<string, string>;
  /** The car's «التشغيل» for the same cars — «ضيف عمود فى الجدول ب نوع التشغيل». */
  operations: ReadonlyMap<string, string | null>;
  /** The car's «الفرع» for the same cars — the branch it is assigned to, not the workshop's. */
  branches: ReadonlyMap<string, string | null>;
};

/**
 * One visit with the two facts that do not live on it: the registry's code for its vehicle, and
 * the roster crew of the day it went in. A write answers with the same row shape a list does, so
 * a client never has to reconcile two versions of the same record.
 */
export interface MaintenanceVisitWithJoins {
  doc: FleetMaintenanceVisitDoc;
  vehicleCode: string | null;
  /** The car's «التشغيل» — a fact about the CAR, read with its code. */
  operationId: string | null;
  /** The car's «الفرع» (`vehicle.branchId`) — likewise the CAR's, read with its code. */
  branchId: string | null;
}

/**
 * The list's FILTER — every field of the query except the page and the order. What the dashboard's
 * reads accept, so a figure is asked exactly the question its link asks the list.
 */
export type MaintenanceFilterQuery = Omit<
  ListFleetMaintenanceQuery,
  'page' | 'pageSize' | 'sort' | 'sortBy' | 'sortDir'
>;

/** The screen-shaped vehicle filter (D9) as the list's own fields, the keys nobody asked left off. */
const listFieldsOf = (filter: VehicleFilter): MaintenanceFilterQuery => ({
  ...(filter.vehicleCodes === undefined ? {} : { vehicleCodes: [...filter.vehicleCodes] }),
  ...(filter.typeIds === undefined ? {} : { typeIds: [...filter.typeIds] }),
  ...(filter.operationIds === undefined ? {} : { operationIds: [...filter.operationIds] }),
  ...(filter.branchIds === undefined ? {} : { branchIds: [...filter.branchIds] }),
});

/** R-17 — count desc, then the name (Arabic first), then the id, so the order is total. */
const byCountThenName = (
  a: { id: string; name: LocalizedString | null; count: number },
  b: { id: string; name: LocalizedString | null; count: number },
): number => {
  if (a.count !== b.count) return b.count - a.count;
  if (a.name === null || b.name === null) {
    if (a.name !== b.name) return a.name === null ? 1 : -1;
  } else {
    const byName = a.name.ar.localeCompare(b.name.ar, 'ar') || a.name.en.localeCompare(b.name.en);
    if (byName !== 0) return byName;
  }
  return a.id.localeCompare(b.id);
};

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'maintenanceVisit',
  entityId: id,
});

const snapshot = (doc: FleetMaintenanceVisitDoc) => ({
  vehicleId: vehicleIdOf(doc),
  inDate: doc.inDate,
  outDate: doc.outDate,
  workshopId: String(doc.workshopId),
  workTypeId: String(doc.workTypeId),
  spareParts: doc.spareParts,
  sparePartIds: (doc.sparePartIds ?? []).map(String),
  odometerAtService: doc.odometerAtService,
  exitOdometer: doc.exitOdometer ?? null,
  driverInEmployeeId: doc.driverInEmployeeId == null ? null : String(doc.driverInEmployeeId),
  driverOutEmployeeId: doc.driverOutEmployeeId == null ? null : String(doc.driverOutEmployeeId),
  notes: doc.notes,
});

const eventPayload = (doc: FleetMaintenanceVisitDoc, code: string) => ({
  visitId: String(doc._id),
  vehicleId: vehicleIdOf(doc),
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
   * The driver must be an employee the directory actually knows.
   *
   * Existence, and nothing beyond it: whether that person may drive is a driver-profile question
   * and this endpoint deliberately does not ask it — a workshop visit records who brought the car,
   * not who was eligible to. Read through the platform directory seam, the same one the driver
   * registry and the availability overlay use; Fleet never reaches into HR's collection.
   */
  /**
   * «لو كتب ميدخلش اقل من القيمة اللى قبلها»: a counter written on a visit may not be below the
   * last odometer reading dated on or before that day. No counter, or no reading before it, is
   * nothing to compare — the counter is optional.
   */
  private async assertNotBelowLast(
    vehicleId: string,
    on: Date,
    counter: number | null,
    field: string,
  ): Promise<void> {
    if (counter === null) return;
    const { lower } = await fleetOdometerRepository.chainBounds(vehicleId, on);
    if (lower != null && counter < lower.reading) {
      throw new ValidationError([
        {
          field,
          code: 'INVALID',
          message: `the counter cannot be below the last reading before it (${lower.reading})`,
        },
      ]);
    }
  }

  private async assertDriver(employeeId: string, field: string): Promise<void> {
    if ((await getDirectoryEmployee(employeeId)) === null) {
      throw new ValidationError([{ field, code: 'UNKNOWN', message: 'employee not found' }]);
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
   * The read-side facts a visit does not carry itself — all about its CAR, read off the registry:
   * the code, «التشغيل» and «الفرع». Both drivers are stored on the document now, so nothing else
   * needs resolving.
   */
  private async withJoins(doc: FleetMaintenanceVisitDoc): Promise<MaintenanceVisitWithJoins> {
    const vehicleId = vehicleIdOf(doc);
    // A visit kept from the old book for a car the registry never had names its car itself.
    if (vehicleId === null) {
      return { doc, vehicleCode: doc.vehicleCode ?? null, operationId: null, branchId: null };
    }
    const [codes, operations, branches] = await Promise.all([
      fleetVehicleRepository.codesByIds([vehicleId]),
      fleetVehicleRepository.operationIdsByIds([vehicleId]),
      fleetVehicleRepository.branchIdsByIds([vehicleId]),
    ]);
    return {
      doc,
      vehicleCode: codes.get(vehicleId) ?? null,
      operationId: operations.get(vehicleId) ?? null,
      branchId: branches.get(vehicleId) ?? null,
    };
  }

  /**
   * The car's code for an event about an existing visit — from the registry, or from the old
   * book for a visit whose car the registry never had. Only `checkIn` may refuse a car; a visit
   * already on file is history whatever became of its car.
   */
  private async codeOf(doc: FleetMaintenanceVisitDoc): Promise<string> {
    const vehicleId = vehicleIdOf(doc);
    if (vehicleId === null) return doc.vehicleCode ?? '';
    return (await fleetVehicleRepository.getById(vehicleId)).code;
  }

  async checkIn(input: CheckInFleetMaintenance, by: string): Promise<MaintenanceVisitWithJoins> {
    const vehicle = await fleetVehicleRepository.getById(input.vehicleId);
    if (!isVehicleWritable(vehicle.status)) {
      throw new ConflictError('a disposed vehicle cannot enter a workshop');
    }
    await this.assertCatalogRef(input.workshopId, 'workshop', 'workshopId');
    await this.assertCatalogRef(input.workTypeId, 'workType', 'workTypeId');
    await this.assertSpareParts(input.sparePartIds);
    // Only when one was named: the entry driver is optional now, and asserting a driver that was
    // never given would refuse the check-in for the absence rather than for a bad value.
    if (input.driverInEmployeeId != null) {
      await this.assertDriver(input.driverInEmployeeId, 'body.driverInEmployeeId');
    }
    // FR-4 — the unique partial index is the authority; the pre-check names the conflict.
    const open = await fleetMaintenanceRepository.findOpen(input.vehicleId);
    if (open !== null) {
      throw new ConflictError(`vehicle ${vehicle.code} is already in a workshop (FR-4)`);
    }

    await this.assertNotBelowLast(
      input.vehicleId,
      input.inDate,
      input.odometerAtService ?? null,
      'body.odometerAtService',
    );

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
        odometerAtService: input.odometerAtService ?? null,
        // Who actually drove it in, when the person opening the visit knows. `null` says nobody
        // was named — never that the roster's planned driver should be assumed.
        driverInEmployeeId:
          input.driverInEmployeeId == null ? null : new Types.ObjectId(input.driverInEmployeeId),
        driverOutEmployeeId: null,
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
    await this.assertDriver(input.driverOutEmployeeId, 'body.driverOutEmployeeId');
    // The parts, if this check-out is naming them — the ordinary case, because a workshop finds
    // out what a car needs while it has it. Validated against the same live catalog the check-in
    // validates against, so neither door can store an id the other would have refused.
    if (input.sparePartIds !== undefined) await this.assertSpareParts(input.sparePartIds);
    // The car cannot leave on a lower reading than it arrived on — that is a typo, and it would
    // make the next service fall due early once this becomes the baseline.
    const exitOdometer = input.exitOdometer ?? null;
    if (
      exitOdometer !== null &&
      before.odometerAtService !== null &&
      exitOdometer < before.odometerAtService
    ) {
      throw new ValidationError([
        {
          field: 'body.exitOdometer',
          code: 'INVALID',
          message: 'the exit reading cannot be below the reading the vehicle came in on',
        },
      ]);
    }
    await this.assertNotBelowLast(
      String(before.vehicleId),
      input.outDate,
      exitOdometer,
      'body.exitOdometer',
    );
    const updated = await fleetMaintenanceRepository.updateById(
      id,
      {
        outDate: input.outDate,
        exitOdometer,
        driverOutEmployeeId: new Types.ObjectId(input.driverOutEmployeeId),
        takenOutByEmployeeId: await this.custodian(by, input.takenOutByEmployeeId),
        // ABSENT MEANS «LEAVE THE CHECK-IN LIST ALONE», and an empty array means «there were
        // none». Spreading the key only when it was sent is what keeps those two apart: a
        // check-out that always wrote the field would erase a list the check-in recorded every
        // time a caller did not resend it.
        ...(input.sparePartIds === undefined
          ? {}
          : { sparePartIds: input.sparePartIds.map((id) => new Types.ObjectId(id)) }),
      },
      { by, version: input.version },
    );
    const code = await this.codeOf(before);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'checkOut',
      changes: [{ field: 'outDate', old: null, new: updated.outDate }],
    });
    await emit(FleetEvents.MaintenanceCheckedOut, eventPayload(updated, code));
    // «العربيه اللى بتخرج من الصيانه بتظهر فى الشاشه دى» — the dealership screen's yellow rows.
    await fleetDealershipService.openForVisit(updated, by);
    return this.withJoins(updated);
  }

  /** Legacy `deleted_dock=5` — undo a mistaken check-out. Refused if the slot is taken again. */
  async reopen(id: string, version: number, by: string): Promise<MaintenanceVisitWithJoins> {
    const before = await fleetMaintenanceRepository.getById(id);
    if (before.outDate === null) throw new ConflictError('this visit is already open');
    // A visit from the old book for a car the registry never had is on no car's timeline, so
    // there is no «already open» to collide with.
    const open =
      before.vehicleId == null
        ? null
        : await fleetMaintenanceRepository.findOpen(String(before.vehicleId));
    if (open !== null) {
      throw new ConflictError('the vehicle already has an open visit (FR-4)');
    }
    const updated = await fleetMaintenanceRepository.updateById(
      id,
      // Reopening un-closes the visit, so the exit reading goes with it: a car that is back
      // in the workshop has not left, and leaving the number behind would keep feeding a baseline
      // for a service that is not finished.
      { outDate: null, exitOdometer: null, driverOutEmployeeId: null, takenOutByEmployeeId: null },
      { by, version },
    );
    const code = await this.codeOf(before);
    await auditService.record({
      entityRef: entityRef(id),
      action: 'reopen',
      changes: [{ field: 'outDate', old: before.outDate, new: null }],
    });
    await emit(FleetEvents.MaintenanceReopened, eventPayload(updated, code));
    // The car is back in the workshop: the dealership rows that still wait for an invoice go too.
    await fleetDealershipService.withdrawPendingOfVisit(id, by);
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
    if (input.driverInEmployeeId !== undefined) {
      await this.assertDriver(input.driverInEmployeeId, 'body.driverInEmployeeId');
    }
    // «سائق الخروج» — only on a CLOSED visit. An open one has not left yet; check-out sets it.
    if (input.driverOutEmployeeId !== undefined && before.outDate === null) {
      throw new ValidationError([
        {
          field: 'body.driverOutEmployeeId',
          code: 'INVALID',
          message: 'the exit driver of an open visit is set by check-out',
        },
      ]);
    }
    // Asked of HR only when this edit CHANGES it, so resaving a visit whose driver has since left
    // the directory is not refused for a driver nobody touched. Lowercased: an id is hex, and the
    // stored one always reads back lowercase.
    if (
      input.driverOutEmployeeId !== undefined &&
      input.driverOutEmployeeId.toLowerCase() !== String(before.driverOutEmployeeId ?? '')
    ) {
      await this.assertDriver(input.driverOutEmployeeId, 'body.driverOutEmployeeId');
    }
    // FR-4's `outDate ≥ inDate`, against the END STATE of the edit.
    //
    // Check-out enforces it once, at the moment it sets `outDate` — and `outDate` is deliberately
    // not editable here, so it looked settled. But `inDate` IS editable, and moving it past a
    // date that cannot move back produced a closed visit whose car left before it arrived. The
    // rule is the design's (FR-4), not a new one; it was simply only ever checked from one side.
    //
    // Merged rather than checked on the input alone, the same way the two counters below are and
    // the same way `unavailability.update` checks its own span: what matters is the pair the row
    // will HOLD, not the half this particular request happens to carry.
    const inDate = input.inDate ?? before.inDate;
    if (before.outDate !== null && inDate > before.outDate) {
      throw new ValidationError([
        {
          field: 'body.inDate',
          code: 'INVALID',
          message: 'check-in cannot follow the check-out already recorded for this visit',
        },
      ]);
    }
    // The same rule check-out enforces, against whichever of the two readings this edit leaves
    // in place: an edit that lowers the exit reading below the entry one is the same typo, and it
    // would corrupt the baseline just as quietly.
    const entry =
      input.odometerAtService === undefined ? before.odometerAtService : input.odometerAtService;
    const exit = input.exitOdometer === undefined ? before.exitOdometer : input.exitOdometer;
    if (exit != null && entry != null && exit < entry) {
      throw new ValidationError([
        {
          field: 'body.exitOdometer',
          code: 'INVALID',
          message: 'the exit reading cannot be below the reading the vehicle came in on',
        },
      ]);
    }
    // A counter this edit writes is held to the same «not below the last reading» rule.
    // Only a counter this edit CHANGES — a visit the old book left below the chain can still have
    // its other facts corrected.
    //
    // And only on a visit that HAS a car: one kept from the old book for a car the registry does
    // not have is on no chain, and `String(null)` is no vehicle id — the look-up threw on it.
    const vehicleId = before.vehicleId == null ? null : String(before.vehicleId);
    if (
      vehicleId !== null &&
      input.odometerAtService != null &&
      input.odometerAtService !== before.odometerAtService
    ) {
      await this.assertNotBelowLast(
        vehicleId,
        inDate,
        input.odometerAtService,
        'body.odometerAtService',
      );
    }
    if (
      vehicleId !== null &&
      input.exitOdometer != null &&
      input.exitOdometer !== before.exitOdometer &&
      before.outDate !== null
    ) {
      await this.assertNotBelowLast(
        vehicleId,
        before.outDate,
        input.exitOdometer,
        'body.exitOdometer',
      );
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
    if (input.odometerAtService !== undefined) {
      set.odometerAtService = input.odometerAtService ?? null;
    }
    if (input.driverInEmployeeId !== undefined) {
      set.driverInEmployeeId = new Types.ObjectId(input.driverInEmployeeId);
    }
    // `driverOutName` (the old book's spelling) is left as it is; the employee id wins on display.
    if (input.driverOutEmployeeId !== undefined) {
      set.driverOutEmployeeId = new Types.ObjectId(input.driverOutEmployeeId);
    }
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
  private async vehicleScope(query: MaintenanceFilterQuery): Promise<string[] | undefined> {
    const [byCode, bySet] = await Promise.all([
      // The live cars carrying these codes — whitespace and Latin case aside, so «كورولا 1» is a
      // stored «كورولا 1 » (`anyVehicleCode`).
      query.vehicleCodes === undefined
        ? undefined
        : fleetVehicleRepository.liveIdsByCodes(query.vehicleCodes),
      // «انا اقدر اعمل فلتر ب نوع التشغيل» — the car's operation is the registry's fact too, so it
      // narrows to vehicle ids here exactly as a code does. Both asked means BOTH hold: the cars
      // among those codes that run under one of those operations.
      // «الفرع» — the car's branch, and «النوع» — its type: the registry's facts again, resolved by
      // the vehicle set's resolvers (deleted cars included, plan D10). Every question asked must hold.
      resolveVehicleFilterIds(vehicleSetPart(query)),
    ]);
    return intersectVehicleIds(byCode, bySet);
  }

  /**
   * THE FILTER, BUILT ONCE — the vehicle scope and the driver clause folded in together, so the
   * page is cut from exactly what the reader asked for. The odometer register does the same.
   * `narrowed` says whether a vehicle clause was applied at all (R-13).
   */
  private async scopedFilter(
    query: MaintenanceFilterQuery,
  ): Promise<{ filter: FilterQuery<FleetMaintenanceVisitDoc>; narrowed: boolean }> {
    const vehicleIds = await this.vehicleScope(query);
    const filter = fleetMaintenanceRepository.withDriverFilter(
      fleetMaintenanceRepository.visitFilter({
        ...query,
        ...(vehicleIds === undefined ? {} : { vehicleIds }),
        // A visit kept from the old book on a car the registry never had matches a typed CODE —
        // but it has no operation, branch or type on file, so it cannot be one of those asked for.
        ...(query.operationIds === undefined &&
        query.branchIds === undefined &&
        query.typeIds === undefined
          ? {}
          : { vehicleCodes: undefined }),
      }),
      query.driverEmployeeIds,
    );
    return { filter, narrowed: vehicleIds !== undefined || query.vehicleId !== undefined };
  }

  private async filterFor(
    query: MaintenanceFilterQuery,
  ): Promise<FilterQuery<FleetMaintenanceVisitDoc>> {
    return (await this.scopedFilter(query)).filter;
  }

  /**
   * The registry's codes for these cars — with the old book's code for a visit without one — and
   * which of them have since been DELETED from the registry (read once, deleted cars included).
   */
  private async carNamer(vehicleIds: readonly string[]): Promise<{
    codeOf: (vehicleId: string | null, bookCode: string | null | undefined) => string;
    deleted: (vehicleId: string | null) => boolean;
  }> {
    const cars = new Map(
      (await fleetVehicleRepository.findByIdsSystem([...new Set(vehicleIds)])).map((car) => [
        String(car._id),
        car,
      ]),
    );
    return {
      codeOf: (vehicleId, bookCode) =>
        (vehicleId === null ? undefined : cars.get(vehicleId)?.code) ?? bookCode ?? '—',
      deleted: (vehicleId) => vehicleId !== null && cars.get(vehicleId)?.isDeleted === true,
    };
  }

  /**
   * T2.4, R-09 — «في الورشة الآن»: the open visits of ANY status, through the list's own filter
   * (`/fleet/maintenance?state=open` with the same vehicle filter lists exactly these), split by
   * the car's status now, with the oldest stay in Cairo days.
   *
   * A car deleted from the registry, or a visit kept from the old book without one, is counted in
   * `open` — the list shows it — and in neither status part.
   */
  async openNow(input: {
    today: string;
    filter: VehicleFilter;
  }): Promise<FleetDashboardNowWorkshopDto> {
    const facts = await fleetMaintenanceRepository.openFacts(
      await this.filterFor({ ...listFieldsOf(input.filter), open: true }),
    );
    // Every registry car with an open visit — the oldest one's among them — read once, deleted
    // ones included: their visit is on the list, so the card must still name its car.
    const cars = new Map(
      (await fleetVehicleRepository.findByIdsSystem(facts.cars.map((car) => car.vehicleId))).map(
        (car) => [String(car._id), car],
      ),
    );
    let openActive = 0;
    let openOutOfService = 0;
    for (const { vehicleId, visits } of facts.cars) {
      const car = cars.get(vehicleId);
      if (car === undefined || car.isDeleted) continue;
      if (car.status === 'active') openActive += visits;
      if (car.status === 'outOfService') openOutOfService += visits;
    }
    const oldest = facts.oldest;
    return {
      open: facts.count,
      openActive,
      openOutOfService,
      oldest:
        oldest === null
          ? null
          : {
              vehicleId: oldest.vehicleId,
              code:
                (oldest.vehicleId === null ? undefined : cars.get(oldest.vehicleId)?.code) ??
                oldest.vehicleCode ??
                '—',
              inDate: ymdOf(oldest.inDate),
              // «منذ N أيام» — Cairo today minus the check-in day; no ceiling (owner decision 4-3).
              days: daysBetweenYmd(ymdOf(oldest.inDate), input.today),
            },
    };
  }

  /**
   * T4.8, R-12 — the most recently WRITTEN visits (`createdAt` desc, `_id` desc) whose business
   * date — the check-in day, or the check-out day when later — is on or after `sinceYmd`. The
   * window is a display window: it keeps a go-live import batch from reading as «recent».
   */
  async recentWritten(input: {
    sinceYmd: string;
    limit: number;
    filter: VehicleFilter;
  }): Promise<FleetDashboardRecentVisitDto[]> {
    const docs = await fleetMaintenanceRepository.recentWritten(
      await this.filterFor(listFieldsOf(input.filter)),
      calendarDayBounds(input.sinceYmd, input.sinceYmd).from,
      input.limit,
    );
    const [{ codeOf }, names] = await Promise.all([
      this.carNamer(vehicleIdsOf(docs)),
      fleetCatalogItemRepository.namesByIds([
        ...new Set(docs.flatMap((doc) => [String(doc.workshopId), String(doc.workTypeId)])),
      ]),
    ]);
    return docs.map((doc) => {
      const vehicleId = vehicleIdOf(doc);
      const inDate = ymdOf(doc.inDate);
      const outDate = doc.outDate == null ? null : ymdOf(doc.outDate);
      return {
        visitId: String(doc._id),
        vehicleId,
        code: codeOf(vehicleId, doc.vehicleCode),
        date: outDate !== null && outDate > inDate ? outDate : inDate,
        recordedAt: doc.createdAt.toISOString(),
        workshop: names.get(String(doc.workshopId)) ?? null,
        workType: names.get(String(doc.workTypeId)) ?? null,
        open: doc.outDate == null,
      };
    });
  }

  /**
   * T6.3/T6.4 and tab 9, R-18 — the visits the list's filter matches (with `from`/`to`: those that
   * CHECKED IN in the period), in one `$facet`: the state each is in now («حتى الآن», R-22), per
   * work type, per workshop and the most-visited cars (R-17: visits desc, latest check-in desc,
   * code asc; a car deleted from the registry is not ranked). Every bar sums to `count`. Visits
   * carry no money (R-26), so none is computed.
   *
   * `unregistered` — the visits with no registry car — is reported only when no vehicle clause
   * applies; with one, they are already outside the count (R-13).
   */
  async visitBreakdown(query: MaintenanceFilterQuery): Promise<FleetDashboardPeriodVisitsDto> {
    const { filter, narrowed } = await this.scopedFilter(query);
    const facts = await fleetMaintenanceRepository.breakdown(filter);
    const [{ codeOf, deleted }, names] = await Promise.all([
      this.carNamer(
        facts.byVehicle.flatMap((row) => (row.vehicleId === null ? [] : [row.vehicleId])),
      ),
      fleetCatalogItemRepository.namesByIds([
        ...new Set([...facts.byWorkType, ...facts.byWorkshop].map((row) => row.id)),
      ]),
    ]);
    const named = (rows: readonly { id: string; count: number }[]) =>
      rows
        .map((row) => ({ id: row.id, name: names.get(row.id) ?? null, count: row.count }))
        .sort(byCountThenName);
    // A car since DELETED from the registry is not ranked: its row would open the register on its
    // code, which the register resolves through the live registry only — an empty list (§8.11).
    // Its visits are still in `count` and in every bar.
    const topVehicles = facts.byVehicle
      .filter((row) => !deleted(row.vehicleId))
      .map((row) => ({
        vehicleId: row.vehicleId,
        code: codeOf(row.vehicleId, row.vehicleCode),
        visits: row.visits,
        lastInDate: ymdOf(row.lastInDate),
      }))
      .sort(
        (a, b) =>
          b.visits - a.visits ||
          b.lastInDate.localeCompare(a.lastInDate) ||
          compareFleetVehicleCodes(a.code, b.code) ||
          (a.vehicleId ?? '').localeCompare(b.vehicleId ?? ''),
      )
      .slice(0, FLEET_DASHBOARD_RANK_ROWS);
    return {
      count: facts.count,
      closed: facts.count - facts.open,
      open: facts.open,
      byWorkType: named(facts.byWorkType),
      byWorkshop: named(facts.byWorkshop),
      topVehicles,
      unregistered: narrowed ? null : facts.unregistered,
    };
  }

  async list(query: ListFleetMaintenanceQuery): Promise<MaintenanceVisitPage> {
    const sorts = parseFleetSort(query.sort);
    // The filter and the alarm columns need nothing of each other, so neither waits for the other.
    const [filter, sortDerived] = await Promise.all([
      this.filterFor(query),
      // «منذ الخدمة» and «المتبقي» are figures about the CAR, not about the visit — computed for
      // the fleet and handed to the query as something it can order by, and only when the reader
      // has asked for one. See the odometer register, which does the same with the same helper.
      alarmSortsFor([...sorts, { by: query.sortBy ?? '' }]),
    ]);
    const page = await fleetMaintenanceRepository.listVisits({
      filter,
      // Already folded into the filter above; `listVisits` must not fold it twice.
      driverEmployeeIds: undefined,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
      // …and the rest of the reader's order behind it. `sortBy` stays the first column
      // so nothing that only speaks the pagination contract is left sorting by nothing.
      sorts,
      sortDerived,
    });
    // The page's cars, asked their codes, their operations and their branches at once.
    const onPage = vehicleIdsOf(page.items);
    const [codes, operations, branches] = await Promise.all([
      fleetVehicleRepository.codesByIds(onPage),
      fleetVehicleRepository.operationIdsByIds(onPage),
      fleetVehicleRepository.branchIdsByIds(onPage),
    ]);
    return { ...page, codes, operations, branches };
  }
}

export const fleetMaintenanceService = new FleetMaintenanceService();
