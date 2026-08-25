// Daily roster planning (fleet design §4.5, FR-5/6/7; owner FL-5 points 1-7).
//
// The service holds NO availability logic of its own: a driver's assignability is exactly what
// `driverAvailabilityOn` says (point 1) and a vehicle's is exactly what the `openVisitVehicleIds`
// seam says (point 2). What the roster adds is the day's EXCLUSIVITY — one vehicle per driver,
// one row per vehicle — and it adds it transactionally, version-aware, per row (points 3/4).
// A plan save is an upsert of only the CHANGED rows (H4's fate): each sent row is the complete
// desired state of that (vehicle, date) — which is also precisely the shape a drag-and-drop
// board needs, since one drag = the rows it touched (point 7). Events fire only after commit.
import {
  FleetEvents,
  type AuditChange,
  type FleetRosterDayDto,
  type FleetRosterRowDto,
  type PlanFleetRoster,
  type PlanFleetRosterRow,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetVehicleService } from '../vehicles/vehicle.service';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { driverAvailabilityOn } from '../availability/driver-availability';
import { fleetDutyAssignmentRepository } from './duty-assignment.repository';
import { type FleetDutyAssignmentDoc } from './duty-assignment.model';
import { type FleetVehicleDoc } from '../vehicles/vehicle.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'dutyAssignment',
  entityId: id,
});

/** The pair (vehicleId, date) is identity, so the date must BE a day, not an instant. */
const utcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** The audited/compared surface of a row — the four planning facts, nothing derived. */
const snapshot = (doc: FleetDutyAssignmentDoc) => ({
  missionTypeId: doc.missionTypeId === null ? null : String(doc.missionTypeId),
  driver1EmployeeId: doc.driver1EmployeeId === null ? null : String(doc.driver1EmployeeId),
  driver2EmployeeId: doc.driver2EmployeeId === null ? null : String(doc.driver2EmployeeId),
  notes: doc.notes,
});

/** An id in the one spelling mongo uses. `null`/`undefined` pass through untouched. */
const canonical = <T extends string | null | undefined>(id: T): T =>
  typeof id === 'string' ? (id.toLowerCase() as T) : id;

const rowDrivers = (row: PlanFleetRosterRow): string[] =>
  [row.driver1EmployeeId, row.driver2EmployeeId].filter((d): d is string => d != null);

/** A row that ASSIGNS something, as opposed to one that only clears or annotates. */
const assigns = (row: PlanFleetRosterRow): boolean =>
  row.missionTypeId != null || rowDrivers(row).length > 0;

interface ChangedRow {
  vehicleId: string;
  code: string;
  missionTypeId: string | null;
  driver1EmployeeId: string | null;
  driver2EmployeeId: string | null;
}

interface PendingAudit {
  entityId: string;
  action: 'create' | 'update';
  changes: AuditChange[];
}

class FleetRosterService {
  /** The §4.5 board: scoped vehicles + the day's plan + the driver pool, split by the seam. */
  async board(date: Date, scope: ScopeSelector): Promise<FleetRosterDayDto> {
    const day = utcDay(date);
    const vehicles = await this.allActiveVehicles(scope);
    const vehicleIds = vehicles.map((v) => String(v._id));
    const [inWorkshop, assignments] = await Promise.all([
      fleetVehicleService.openVisitVehicleIds(vehicleIds, day),
      fleetDutyAssignmentRepository.findForDate(day),
    ]);
    const byVehicle = new Map(assignments.map((row) => [String(row.vehicleId), row]));
    // Taken is computed over the WHOLE day's plan, not just scoped vehicles — a driver assigned
    // to another branch's vehicle is still taken.
    const taken = fleetDutyAssignmentRepository.takenDrivers(assignments);

    const rows: FleetRosterRowDto[] = vehicles.map((vehicle) => {
      const id = String(vehicle._id);
      const assignment = byVehicle.get(id);
      const facts = assignment === undefined ? null : snapshot(assignment);
      return {
        vehicleId: id,
        code: vehicle.code,
        plateNumber: vehicle.plateNumber,
        typeId: String(vehicle.typeId),
        inMaintenance: inWorkshop.has(id),
        missionTypeId: facts?.missionTypeId ?? null,
        driver1EmployeeId: facts?.driver1EmployeeId ?? null,
        driver2EmployeeId: facts?.driver2EmployeeId ?? null,
        notes: facts?.notes ?? null,
      };
    });

    const availableDrivers: FleetRosterDayDto['availableDrivers'] = [];
    const unavailableDrivers: FleetRosterDayDto['unavailableDrivers'] = [];
    for (const profile of await this.allActiveDrivers()) {
      const employeeId = String(profile.employeeId);
      // Point 1 — the seam is the ONLY availability authority; the roster never re-derives it.
      const availability = await driverAvailabilityOn(employeeId, day);
      if (availability.available) {
        availableDrivers.push({ employeeId, assignedVehicleId: taken.get(employeeId) ?? null });
      } else {
        unavailableDrivers.push({ employeeId, reason: availability.reason ?? 'unavailable' });
      }
    }

    return { date: day.toISOString(), rows, availableDrivers, unavailableDrivers };
  }

  /**
   * Save a plan — upsert per (vehicle, date), FR-5/6/7 enforced server-side, all writes in one
   * transaction, each write version-checked against the row it read (point 4). Returns the
   * number of rows that actually changed; unchanged rows are pure no-ops (no write, no audit,
   * no event), which is what makes a full-board save and a one-drag save the same operation.
   */
  async plan(
    original: PlanFleetRoster,
    by: string,
    scope: ScopeSelector,
  ): Promise<{ changedCount: number }> {
    // Settle the id SPELLING before anything compares one. The schema already does this at the
    // HTTP boundary; repeating it here is not belt-and-braces, it is the invariant every lookup
    // below relies on. Each of them keys off `String(doc.field)`, which mongo renders lowercase,
    // so an id spelled in uppercase would miss the existing-row map (turning an edit into an
    // insert), miss the FR-5 workshop set (making an in-workshop vehicle assignable), and miss
    // the FR-7 occupancy set (letting one driver hold two vehicles for a date). A caller that
    // reaches this method without passing through the schema must not be able to do that.
    const input: PlanFleetRoster = {
      ...original,
      rows: original.rows.map((row) => ({
        ...row,
        vehicleId: canonical(row.vehicleId),
        missionTypeId: canonical(row.missionTypeId),
        driver1EmployeeId: canonical(row.driver1EmployeeId),
        driver2EmployeeId: canonical(row.driver2EmployeeId),
      })),
    };
    const day = utcDay(input.date);

    // Scope rides the vehicle lookup: a branch-scoped planner cannot touch (or probe) another
    // branch's fleet — out-of-scope reads 404 exactly as the registry's own endpoints do.
    const vehicles = new Map<string, FleetVehicleDoc>();
    for (const row of input.rows) {
      vehicles.set(row.vehicleId, await fleetVehicleRepository.getById(row.vehicleId, scope));
    }
    const assigningRows = input.rows.filter(assigns);
    for (const row of assigningRows) {
      const vehicle = vehicles.get(row.vehicleId);
      if (vehicle !== undefined && vehicle.status !== 'active') {
        throw new ConflictError(
          `vehicle ${vehicle.code} is ${vehicle.status} and cannot be assigned (§4.1)`,
        );
      }
    }

    // FR-5 through the seam (point 2) — clearing an in-workshop vehicle's row stays allowed.
    const inWorkshop = await fleetVehicleService.openVisitVehicleIds(
      assigningRows.map((row) => row.vehicleId),
      day,
    );
    for (const row of assigningRows) {
      if (inWorkshop.has(row.vehicleId)) {
        const vehicle = vehicles.get(row.vehicleId);
        throw new ConflictError(
          `vehicle ${vehicle?.code ?? row.vehicleId} has an open maintenance visit covering this date and is unassignable (FR-5)`,
        );
      }
    }

    // FR-6 through the seam (point 1) — one verdict per distinct driver, reason named.
    for (const employeeId of new Set(input.rows.flatMap(rowDrivers))) {
      const availability = await driverAvailabilityOn(employeeId, day);
      if (!availability.available) {
        throw new ConflictError(
          `driver ${employeeId} is unavailable on this date (${availability.reason ?? 'unknown'}) and cannot be assigned (FR-6)`,
        );
      }
    }

    if (input.rows.some((row) => row.missionTypeId != null)) {
      for (const missionTypeId of new Set(
        input.rows.map((row) => row.missionTypeId).filter((id): id is string => id != null),
      )) {
        const item = await fleetCatalogItemRepository.findActiveOfKind(
          missionTypeId,
          'missionType',
        );
        if (item === null) {
          throw new ValidationError([
            {
              field: 'body.rows.missionTypeId',
              code: 'UNKNOWN',
              message: 'mission type not found or inactive',
            },
          ]);
        }
      }
    }

    const outcome = await unitOfWork(async (session) => {
      const existing = await fleetDutyAssignmentRepository.findForDate(day, session);
      const byVehicle = new Map(existing.map((row) => [String(row.vehicleId), row]));

      // FR-7's driver half, checked against the END STATE of the whole day: a row outside the
      // payload still holding a payload driver means the plan forgot the releasing row — the
      // client must send BOTH sides of a move, exactly what a drag produces.
      const payloadVehicles = new Set(input.rows.map((row) => row.vehicleId));
      const payloadDrivers = new Set(input.rows.flatMap(rowDrivers));
      for (const row of existing) {
        if (payloadVehicles.has(String(row.vehicleId))) continue;
        for (const slot of [row.driver1EmployeeId, row.driver2EmployeeId]) {
          if (slot !== null && payloadDrivers.has(String(slot))) {
            const holder = vehicles.get(String(row.vehicleId));
            throw new ConflictError(
              `driver ${String(slot)} already holds this date's assignment on vehicle ${holder?.code ?? String(row.vehicleId)} (FR-7); include that vehicle's row to release them`,
            );
          }
        }
      }

      const changed: ChangedRow[] = [];
      const audits: PendingAudit[] = [];
      for (const row of input.rows) {
        const current = byVehicle.get(row.vehicleId);
        const next = {
          missionTypeId: row.missionTypeId ?? null,
          driver1EmployeeId: row.driver1EmployeeId ?? null,
          driver2EmployeeId: row.driver2EmployeeId ?? null,
          notes: row.notes ?? null,
        };
        const set: Partial<FleetDutyAssignmentDoc> = {
          missionTypeId:
            next.missionTypeId === null ? null : new Types.ObjectId(next.missionTypeId),
          driver1EmployeeId:
            next.driver1EmployeeId === null ? null : new Types.ObjectId(next.driver1EmployeeId),
          driver2EmployeeId:
            next.driver2EmployeeId === null ? null : new Types.ObjectId(next.driver2EmployeeId),
          notes: next.notes,
        };

        let doc: FleetDutyAssignmentDoc;
        if (current === undefined) {
          // An empty plan for a vehicle that HAS no row is nothing — creating it would record
          // a fact that never existed.
          if (Object.values(next).every((v) => v === null)) continue;
          doc = await fleetDutyAssignmentRepository.create(
            { vehicleId: new Types.ObjectId(row.vehicleId), date: day, ...set },
            { by, session },
          );
          audits.push({
            entityId: String(doc._id),
            action: 'create',
            changes: diffChanges({}, snapshot(doc)),
          });
        } else {
          const before = snapshot(current);
          if (JSON.stringify(before) === JSON.stringify(next)) continue;
          doc = await fleetDutyAssignmentRepository.updateById(String(current._id), set, {
            by,
            version: current.__v,
            session,
          });
          audits.push({
            entityId: String(doc._id),
            action: 'update',
            changes: diffChanges(before, snapshot(doc)),
          });
        }
        changed.push({
          vehicleId: row.vehicleId,
          code: vehicles.get(row.vehicleId)?.code ?? row.vehicleId,
          ...next,
        });
      }
      return { changed, audits };
    });

    // Point 6 — audit + events only after the transaction has committed.
    for (const audit of outcome.audits) {
      await auditService.record({
        entityRef: entityRef(audit.entityId),
        action: audit.action,
        changes: audit.changes,
      });
    }
    for (const row of outcome.changed) {
      await emit(FleetEvents.AssignmentChanged, {
        vehicleId: row.vehicleId,
        code: row.code,
        date: day,
        missionTypeId: row.missionTypeId,
        driver1EmployeeId: row.driver1EmployeeId,
        driver2EmployeeId: row.driver2EmployeeId,
      });
    }
    await emit(FleetEvents.RosterPlanned, { date: day, changedCount: outcome.changed.length });
    return { changedCount: outcome.changed.length };
  }

  private async allActiveVehicles(scope: ScopeSelector): Promise<FleetVehicleDoc[]> {
    const vehicles: FleetVehicleDoc[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await fleetVehicleRepository.listVehicles({
        filter: { status: 'active' },
        page,
        pageSize: 100,
        sortBy: 'code',
        scope,
      });
      vehicles.push(...batch.items);
      if (batch.items.length < 100) return vehicles;
    }
  }

  private async allActiveDrivers() {
    const drivers = [];
    for (let page = 1; ; page += 1) {
      const batch = await fleetDriverProfileRepository.listDrivers({
        filter: { isActive: true },
        page,
        pageSize: 100,
      });
      drivers.push(...batch.items);
      if (batch.items.length < 100) return drivers;
    }
  }
}

export const fleetRosterService = new FleetRosterService();
