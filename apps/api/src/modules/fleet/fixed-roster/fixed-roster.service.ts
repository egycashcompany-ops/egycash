// The fixed crew board and its save (الطقم الثابت).
//
// This mirrors the daily roster service's SHAPE — scoped vehicles, a driver pool, an upsert of
// only the changed rows inside one transaction, audit after commit — and deliberately differs
// in exactly the places where the daily service is reasoning about a DATE:
//
//   • no `driverAvailabilityOn`: that answers "may this driver be assigned on day D", and this
//     board has no D. What survives from that seam is its two DATELESS checks — the driver must
//     have a fleet profile and it must be active — because those are what "is a driver at all"
//     means, and they are what fills the pool. The three date-dependent verdicts (fleet
//     unavailability, HR leave, employment on the day) are simply not questions here.
//   • no FR-5 workshop refusal: its rule is "an open visit COVERING THIS DATE", and a car in
//     the workshop today still has a standing crew. The flag is reported for context only.
//
// What is NOT relaxed is exclusivity, because it was never about days: one person cannot hold
// both slots of a vehicle, and one driver belongs to one crew. Both are the same rules the
// daily plan enforces, and the second is checked against the END STATE of the whole board — a
// payload that claims a driver another row still holds is refused rather than duplicating them.
import {
  type AuditChange,
  type FleetFixedCrewRowDto,
  type FleetFixedRosterDto,
  type SaveFleetFixedRoster,
  type SaveFleetFixedCrewRow,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { type ScopeSelector } from '../../../shared/types';
import { auditService } from '../../../platform/audit';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
import { fleetVehicleRepository } from '../vehicles/vehicle.repository';
import { fleetVehicleService } from '../vehicles/vehicle.service';
import { fleetDriverProfileRepository } from '../driver-profiles/driver-profile.repository';
import { fleetCatalogItemRepository } from '../catalogs/catalog-item.repository';
import { fleetFixedCrewRepository } from './fixed-crew.repository';
import { type FleetFixedCrewDoc } from './fixed-crew.model';
import { type FleetVehicleDoc } from '../vehicles/vehicle.model';

const entityRef = (id: string) => ({
  moduleId: 'fleet',
  entityType: 'fixedCrew',
  entityId: id,
});

/**
 * The audited/compared surface of a row — the four facts it holds, nothing derived.
 *
 * Change detection is `JSON.stringify(before) === JSON.stringify(next)`, so this object's KEYS
 * and their order are the comparison. A field present here and absent from `next` (or the other
 * way round) would make every save look like a change; adding a field to one without the other
 * is the way this quietly starts rewriting untouched rows.
 */
const snapshot = (doc: FleetFixedCrewDoc) => ({
  missionTypeId: doc.missionTypeId === null ? null : String(doc.missionTypeId),
  driver1EmployeeId: doc.driver1EmployeeId === null ? null : String(doc.driver1EmployeeId),
  driver2EmployeeId: doc.driver2EmployeeId === null ? null : String(doc.driver2EmployeeId),
  notes: doc.notes,
});

/** An id in the one spelling mongo uses. `null`/`undefined` pass through untouched. */
const canonical = <T extends string | null | undefined>(id: T): T =>
  typeof id === 'string' ? (id.toLowerCase() as T) : id;

const rowDrivers = (row: SaveFleetFixedCrewRow): string[] =>
  [row.driver1EmployeeId, row.driver2EmployeeId].filter((d): d is string => d != null);

/** A row that puts somebody on a car, as opposed to one that only empties it. */
const assigns = (row: SaveFleetFixedCrewRow): boolean => rowDrivers(row).length > 0;

interface PendingAudit {
  entityId: string;
  action: 'create' | 'update';
  changes: AuditChange[];
}

class FleetFixedRosterService {
  /** The board: scoped vehicles + their standing crews + the whole driver pool, undivided. */
  async board(scope: ScopeSelector): Promise<FleetFixedRosterDto> {
    const vehicles = await this.allActiveVehicles(scope);
    const vehicleIds = vehicles.map((v) => String(v._id));
    const [inWorkshop, crews] = await Promise.all([
      // Reported, never enforced: the badge is context, and clearing or setting a crew for a car
      // that happens to be in the workshop today is a perfectly ordinary thing to do.
      fleetVehicleService.openVisitVehicleIds(vehicleIds, new Date()),
      fleetFixedCrewRepository.findAll(),
    ]);
    const byVehicle = new Map(crews.map((row) => [String(row.vehicleId), row]));
    // Taken spans the WHOLE board, not just scoped vehicles: a driver fixed to another branch's
    // car is still taken, the same way the daily roster counts them.
    const taken = fleetFixedCrewRepository.takenDrivers(crews);

    const rows: FleetFixedCrewRowDto[] = vehicles.map((vehicle) => {
      const id = String(vehicle._id);
      const crew = byVehicle.get(id);
      return {
        vehicleId: id,
        code: vehicle.code,
        plateNumber: vehicle.plateNumber,
        typeId: String(vehicle.typeId),
        inMaintenance: inWorkshop.has(id),
        missionTypeId: crew === undefined ? null : (snapshot(crew).missionTypeId ?? null),
        driver1EmployeeId: crew === undefined ? null : (snapshot(crew).driver1EmployeeId ?? null),
        driver2EmployeeId: crew === undefined ? null : (snapshot(crew).driver2EmployeeId ?? null),
        notes: crew === undefined ? null : (snapshot(crew).notes ?? null),
      };
    });

    const drivers = (await this.allActiveDrivers()).map((profile) => {
      const employeeId = String(profile.employeeId);
      return { employeeId, assignedVehicleId: taken.get(employeeId) ?? null };
    });

    return { rows, drivers };
  }

  /**
   * Save the crews — upsert per vehicle, all writes in one transaction, each version-checked
   * against the row it read. Returns how many rows actually changed; an unchanged row is a pure
   * no-op, which is what makes a one-drag save and a whole-board save the same operation.
   */
  async save(
    original: SaveFleetFixedRoster,
    by: string,
    scope: ScopeSelector,
  ): Promise<{ changedCount: number }> {
    // Settle the id SPELLING before anything compares one. The schema already does this at the
    // HTTP boundary; repeating it here is not belt-and-braces, it is the invariant this method
    // relies on: every lookup below keys off `String(doc.field)`, which mongo renders lowercase,
    // so an id spelled in uppercase would miss the "does this vehicle already have a crew" map
    // and take the INSERT branch for a row that already exists. A caller that reaches this
    // method without passing through the schema must not be able to do that.
    const input: SaveFleetFixedRoster = {
      rows: original.rows.map((row) => ({
        vehicleId: canonical(row.vehicleId) as string,
        missionTypeId: canonical(row.missionTypeId),
        driver1EmployeeId: canonical(row.driver1EmployeeId),
        driver2EmployeeId: canonical(row.driver2EmployeeId),
        notes: row.notes,
      })),
    };

    // Scope rides the vehicle lookup: a branch-scoped planner cannot touch (or probe) another
    // branch's fleet — out-of-scope reads 404 exactly as the registry's own endpoints do.
    const vehicles = new Map<string, FleetVehicleDoc>();
    for (const row of input.rows) {
      vehicles.set(row.vehicleId, await fleetVehicleRepository.getById(row.vehicleId, scope));
    }
    for (const row of input.rows.filter(assigns)) {
      const vehicle = vehicles.get(row.vehicleId);
      if (vehicle !== undefined && vehicle.status !== 'active') {
        throw new ConflictError(
          `vehicle ${vehicle.code} is ${vehicle.status} and cannot be crewed (§4.1)`,
        );
      }
    }

    // A second driver needs a first. The schema says so at the HTTP boundary; this repeats it for
    // the same reason the canonicalisation above is repeated — the invariant belongs to the
    // RECORD, and a caller reaching this method without passing through the schema must not be
    // able to write a crew whose only member sits in the second seat. Slot 1 is what every other
    // screen reads as "the driver", so such a row would show as crewless while a real person is
    // committed to it.
    for (const row of input.rows) {
      if (row.driver1EmployeeId == null && row.driver2EmployeeId != null) {
        throw new ValidationError([
          {
            field: 'body.rows.driver2EmployeeId',
            code: 'DRIVER2_WITHOUT_DRIVER1',
            message: 'a second driver needs a first — assign driver 1 before driver 2',
          },
        ]);
      }
    }

    // The dateless half of the availability seam: a fixed driver must BE a driver. Whether they
    // are free next Tuesday is a question this board does not ask.
    for (const employeeId of new Set(input.rows.flatMap(rowDrivers))) {
      const profile = await fleetDriverProfileRepository.findDriverByEmployeeId(employeeId);
      if (profile === null || !profile.isActive) {
        throw new ValidationError([
          {
            field: 'body.rows.driverEmployeeId',
            code: 'UNKNOWN',
            message: 'no active driver profile for this employee',
          },
        ]);
      }
    }

    // The mission type must BE a mission type: an id that is well-formed, live, and of this
    // kind. The daily plan checks its own the same way and against the SAME catalog — the column
    // stores a reference, so a dangling one would render as a blank cell no reader could explain,
    // and an id from another kind would render as somebody else's vocabulary. `workType`
    // (أنواع الأعمال) is exactly that other vocabulary — the workshop's — and an id from it is
    // refused here like any other wrong-kind id.
    for (const missionTypeId of new Set(
      input.rows.map((row) => row.missionTypeId).filter((id): id is string => id != null),
    )) {
      const item = await fleetCatalogItemRepository.findActiveOfKind(missionTypeId, 'missionType');
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

    const outcome = await unitOfWork(async (session) => {
      const existing = await fleetFixedCrewRepository.findAll(session);
      const byVehicle = new Map(existing.map((row) => [String(row.vehicleId), row]));

      // Exclusivity against the END STATE of the whole board: a row outside the payload still
      // holding a payload driver means the save forgot the releasing row — the client must send
      // BOTH sides of a move, which is exactly what a drag produces.
      const payloadVehicles = new Set(input.rows.map((row) => row.vehicleId));
      const payloadDrivers = new Set(input.rows.flatMap(rowDrivers));
      for (const row of existing) {
        if (payloadVehicles.has(String(row.vehicleId))) continue;
        for (const slot of [row.driver1EmployeeId, row.driver2EmployeeId]) {
          if (slot !== null && payloadDrivers.has(String(slot))) {
            const holder = await fleetVehicleRepository
              .getById(String(row.vehicleId), scope)
              .catch(() => null);
            throw new ConflictError(
              `driver ${String(slot)} already belongs to the fixed crew of vehicle ${holder?.code ?? String(row.vehicleId)}; include that vehicle's row to release them`,
            );
          }
        }
      }

      let changedCount = 0;
      const audits: PendingAudit[] = [];
      for (const row of input.rows) {
        const current = byVehicle.get(row.vehicleId);
        // Same keys, same order as `snapshot()` — see the note there.
        const next = {
          missionTypeId: row.missionTypeId ?? null,
          driver1EmployeeId: row.driver1EmployeeId ?? null,
          driver2EmployeeId: row.driver2EmployeeId ?? null,
          notes: row.notes ?? null,
        };
        const set: Partial<FleetFixedCrewDoc> = {
          missionTypeId:
            next.missionTypeId === null ? null : new Types.ObjectId(next.missionTypeId),
          driver1EmployeeId:
            next.driver1EmployeeId === null ? null : new Types.ObjectId(next.driver1EmployeeId),
          driver2EmployeeId:
            next.driver2EmployeeId === null ? null : new Types.ObjectId(next.driver2EmployeeId),
          notes: next.notes,
        };

        let doc: FleetFixedCrewDoc;
        if (current === undefined) {
          // An empty crew for a car that HAS no row is nothing — creating it would record a
          // fact that never existed.
          if (Object.values(next).every((v) => v === null)) continue;
          doc = await fleetFixedCrewRepository.create(
            { vehicleId: new Types.ObjectId(row.vehicleId), ...set },
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
          doc = await fleetFixedCrewRepository.updateById(String(current._id), set, {
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
        changedCount += 1;
      }
      return { changedCount, audits };
    });

    // Audit only after the transaction has committed, as the daily plan does.
    for (const audit of outcome.audits) {
      await auditService.record({
        entityRef: entityRef(audit.entityId),
        action: audit.action,
        changes: audit.changes,
      });
    }
    return { changedCount: outcome.changedCount };
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

export const fleetFixedRosterService = new FleetFixedRosterService();
