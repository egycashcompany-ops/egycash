// The standing crew (الطاقم الثابت) — the permanent answer to "who normally crews this vehicle".
//
// NEW CAPABILITY, no legacy counterpart to hold parity with: legacy's board started empty every
// day (contad_app.js:2305-2311). What this slice IS bound by is the daily board's own rules, and
// deliberately so — this row is the template a day is seeded from, so every rule the day enforces
// must already hold here or the seed could author a plan the day would refuse.
//
// THE RULES, and where each comes from:
//   · Slots are optional and there is no minimum crew — the daily rule (`row.spe1 || ""`, :2419).
//   · A slot holds up to CREW_SLOT_CAPACITY people — the same ceiling, for the reason above.
//   · Cross-slot and intra-slot uniqueness — the daily rules, restated in the payload schema.
//   · ONE PERSON, ONE VEHICLE across the whole standing crew — Q11's day-independent shadow.
//     Not decoration: a standing crew that puts someone on two vehicles produces a seed that
//     breaks Q11 the moment both vehicles are rostered the same day, so the descent could never be
//     trusted. Checked here against the END STATE of the whole standing crew, exactly as the daily
//     board checks Q11 against the end state of the whole day.
//   · Employees are validated to EXIST and not be exited, through the platform directory seam —
//     reference integrity for the normalized ids, and nothing more. NO attendance gate and NO
//     requirement-flag gate, unchanged from every other crew surface (approved decisions 1 and 2).
//   · A vehicle must exist in the Fleet registry — but NOT be on a duty roster. Being rostered is
//     a per-DAY fact and this row has no day; demanding it would make the permanent crew of a
//     vehicle un-editable on any day Fleet had not yet rostered it.
//
// Removal is EXPLICIT and separate from saving. An absent row means "unchanged", never "deleted":
// the board sends only changed rows, so inferring deletion from absence would empty the fleet the
// first time someone saved a single edit.
import {
  MAX_PAGE_SIZE,
  OperationsEvents,
  type OperationsStandingCrewBoardDto,
  type OperationsStandingCrewRowDto,
  type SetOperationsStandingCrew,
  type SetOperationsStandingCrewRow,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { logger } from '../../../infrastructure/logging/logger';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployee } from '../../../platform/directory';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
// §9.4 (frozen fleet design): Operations reads the Fleet registry and never writes it.
import { fleetVehicleRepository } from '../fleet-boundary';
import { slotIds } from '../crew/crew-slots';
import { operationsStandingCrewRepository } from './standing-crew.repository';
import { type OperationsStandingCrewDoc } from './standing-crew.model';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'standingCrew',
  entityId: id,
});

/** The audited/compared surface — the crew facts, nothing derived. */
const snapshot = (doc: OperationsStandingCrewDoc) => ({
  captainEmployeeIds: slotIds(doc.captainEmployeeIds),
  specialist1EmployeeIds: slotIds(doc.specialist1EmployeeIds),
  specialist2EmployeeIds: slotIds(doc.specialist2EmployeeIds),
  direction: doc.direction,
  plannedTime: doc.plannedTime,
});

/** Everyone a payload row puts on the vehicle, across all three slots. */
const rowCrew = (row: SetOperationsStandingCrewRow): string[] => [
  ...(row.captainEmployeeIds ?? []),
  ...(row.specialist1EmployeeIds ?? []),
  ...(row.specialist2EmployeeIds ?? []),
];

/** Everyone a STORED row puts on the vehicle — the same flattening, from the other side. */
const storedCrew = (doc: OperationsStandingCrewDoc): string[] => [
  ...slotIds(doc.captainEmployeeIds),
  ...slotIds(doc.specialist1EmployeeIds),
  ...slotIds(doc.specialist2EmployeeIds),
];

const toDto = (
  doc: OperationsStandingCrewDoc,
  vehicleCode: string,
): OperationsStandingCrewRowDto => ({
  id: String(doc._id),
  vehicleId: String(doc.vehicleId),
  vehicleCode,
  ...snapshot(doc),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

class OperationsStandingCrewService {
  /** The standing crew, plus the Fleet vehicles that could still join it. */
  async board(): Promise<OperationsStandingCrewBoardDto> {
    // Unscoped, exactly as `crew.service.ts` reads the registry for the daily board: the crew
    // surface is organization-wide, and a branch-scoped read here would hide half the fleet from
    // the person maintaining it. One page at MAX_PAGE_SIZE rather than a scan — the cash-transfer
    // fleet is tens of vehicles, and a silent truncation would show an incomplete picker, so the
    // count is asserted below rather than assumed.
    const [stored, vehiclePage] = await Promise.all([
      operationsStandingCrewRepository.findAll(),
      fleetVehicleRepository.list({ page: 1, pageSize: MAX_PAGE_SIZE }),
    ]);
    const vehicles = vehiclePage.items;
    if (vehiclePage.meta.totalItems > vehicles.length) {
      logger.warn(
        { totalItems: vehiclePage.meta.totalItems, shown: vehicles.length },
        'operations: the standing-crew picker is truncated — the fleet outgrew one page',
      );
    }

    const codeOf = new Map(vehicles.map((vehicle) => [String(vehicle._id), vehicle.code]));
    const inCrew = new Set(stored.map((row) => String(row.vehicleId)));

    const rows = stored
      // A stored row whose vehicle no longer resolves keeps its id as its label rather than
      // vanishing: a crew nobody can see is a crew nobody can fix.
      .map((row) => toDto(row, codeOf.get(String(row.vehicleId)) ?? String(row.vehicleId)))
      // Vehicle code, not insertion order: it is the identifier operators actually say out loud,
      // and it keeps the board stable across saves without storing a hand-maintained order.
      .sort((a, b) => a.vehicleCode.localeCompare(b.vehicleCode, 'ar'));

    const available = vehicles
      .filter((vehicle) => !inCrew.has(String(vehicle._id)))
      .map((vehicle) => ({ vehicleId: String(vehicle._id), vehicleCode: vehicle.code }))
      .sort((a, b) => a.vehicleCode.localeCompare(b.vehicleCode, 'ar'));

    return { rows, available };
  }

  async save(input: SetOperationsStandingCrew, by: string): Promise<{ changedCount: number }> {
    // Vehicle reference integrity, resolved OUTSIDE the transaction: Fleet owns these rows.
    // EXISTENCE only — not "is on today's roster", which is a fact this dateless row cannot have.
    for (const row of input.rows) {
      if ((await fleetVehicleRepository.findById(row.vehicleId)) === null) {
        throw new ValidationError([
          { field: 'body.rows', code: 'UNKNOWN', message: `vehicle ${row.vehicleId} not found` },
        ]);
      }
    }

    // Employee reference integrity through the directory seam. Existence and not-exited ONLY — no
    // role, department, flag or attendance check, per the approved parity decisions.
    for (const employeeId of new Set(input.rows.flatMap(rowCrew))) {
      const employee = await getDirectoryEmployee(employeeId);
      if (employee === null) {
        throw new ValidationError([
          { field: 'body.rows', code: 'UNKNOWN', message: `employee ${employeeId} not found` },
        ]);
      }
      if (employee.status === 'exited') {
        throw new ConflictError(`employee ${employeeId} has exited and cannot be assigned`);
      }
    }

    const outcome = await unitOfWork(async (session) => {
      const existing = await operationsStandingCrewRepository.findAll(session);
      const byVehicle = new Map(existing.map((row) => [String(row.vehicleId), row]));

      // One person, one vehicle — checked against the END STATE of the whole standing crew (the
      // daily board's Q11 shape). A row outside the payload still holding a payload crew member
      // means the save forgot the releasing row; the client must send BOTH sides of a move, which
      // is exactly what a drag produces.
      const payloadVehicles = new Set(input.rows.map((row) => row.vehicleId));
      const payloadCrew = new Set(input.rows.flatMap(rowCrew));
      for (const row of existing) {
        if (payloadVehicles.has(String(row.vehicleId))) continue;
        for (const occupant of storedCrew(row)) {
          if (payloadCrew.has(occupant)) {
            throw new ConflictError(
              `employee ${occupant} already holds a standing crew place on vehicle ${String(row.vehicleId)}; include that vehicle's row to release them`,
            );
          }
        }
      }

      const changed: { id: string; vehicleId: string; next: ReturnType<typeof snapshot> }[] = [];
      const audits: {
        entityId: string;
        action: 'create' | 'update';
        changes: ReturnType<typeof diffChanges>;
      }[] = [];

      for (const row of input.rows) {
        const current = byVehicle.get(row.vehicleId);
        // An omitted slot CLEARS it, the same dialect the daily board speaks. The board sends
        // whole rows; `undefined` means "nobody", never "keep what is there".
        const next = {
          captainEmployeeIds: row.captainEmployeeIds ?? [],
          specialist1EmployeeIds: row.specialist1EmployeeIds ?? [],
          specialist2EmployeeIds: row.specialist2EmployeeIds ?? [],
          direction: row.direction ?? null,
          plannedTime: row.plannedTime ?? null,
        };
        const set: Partial<OperationsStandingCrewDoc> = {
          captainEmployeeIds: next.captainEmployeeIds.map((id) => new Types.ObjectId(id)),
          specialist1EmployeeIds: next.specialist1EmployeeIds.map((id) => new Types.ObjectId(id)),
          specialist2EmployeeIds: next.specialist2EmployeeIds.map((id) => new Types.ObjectId(id)),
          direction: next.direction,
          plannedTime: next.plannedTime,
        };

        let doc: OperationsStandingCrewDoc;
        if (current === undefined) {
          // AN EMPTY ROW IS CREATED HERE, unlike on the daily board where it is skipped. There it
          // means "nothing happened"; here it means "this vehicle is in the cash-transfer fleet
          // and has no standing crew yet" — which is the fact the whole entity exists to record.
          doc = await operationsStandingCrewRepository.create(
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
          doc = await operationsStandingCrewRepository.updateById(String(current._id), set, {
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
        changed.push({ id: String(doc._id), vehicleId: row.vehicleId, next: snapshot(doc) });
      }
      return { changed, audits };
    });

    // Audit + events only after the transaction has committed (the roster convention).
    for (const audit of outcome.audits) {
      await auditService.record({
        entityRef: entityRef(audit.entityId),
        action: audit.action,
        changes: audit.changes,
      });
    }
    for (const row of outcome.changed) {
      await emit(OperationsEvents.StandingCrewChanged, {
        standingCrewId: row.id,
        vehicleId: row.vehicleId,
        removed: false,
        captainEmployeeIds: row.next.captainEmployeeIds,
        specialist1EmployeeIds: row.next.specialist1EmployeeIds,
        specialist2EmployeeIds: row.next.specialist2EmployeeIds,
      });
    }
    return { changedCount: outcome.changed.length };
  }

  /**
   * Take a vehicle out of the cash-transfer fleet.
   *
   * Soft delete, so the row stays as the record of who used to crew it — and so the partial unique
   * index lets the same vehicle be added back later without colliding with its own tombstone.
   *
   * This touches NO day. Crew already planned onto that vehicle for a day stands: those rows are
   * that day's record of who actually went out, and rewriting history because a vehicle left the
   * fleet in August would falsify March.
   */
  async remove(vehicleId: string, by: string): Promise<void> {
    const current = await operationsStandingCrewRepository.findByVehicle(vehicleId);
    if (current === null) throw new NotFoundError('standing crew not found for this vehicle');

    const before = snapshot(current);
    // No version lock: `softDeleteById` carries none anywhere in this codebase, and inventing one
    // here would be the only version-locked delete in the repository. The race it leaves — two
    // people removing the same vehicle at once — resolves to the same end state, and the second
    // caller gets a NotFoundError from the read above.
    await operationsStandingCrewRepository.softDeleteById(String(current._id), { by });
    await auditService.record({
      entityRef: entityRef(String(current._id)),
      action: 'delete',
      changes: diffChanges(before, {}),
    });
    await emit(OperationsEvents.StandingCrewChanged, {
      standingCrewId: String(current._id),
      vehicleId,
      removed: true,
      // The emptied slots, carried rather than omitted: a subscriber that only ever sees an empty
      // list cannot tell a cleared crew from a vehicle that is gone. `removed` says which.
      captainEmployeeIds: before.captainEmployeeIds,
      specialist1EmployeeIds: before.specialist1EmployeeIds,
      specialist2EmployeeIds: before.specialist2EmployeeIds,
    });
  }
}

export const operationsStandingCrewService = new OperationsStandingCrewService();
