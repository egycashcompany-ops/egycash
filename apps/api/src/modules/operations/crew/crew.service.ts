// Cash-transfer crew planning — the legacy /tashghela workflow, ported by parity.
//
// WHAT IS PARITY AND WHAT IS PROMOTED (each promotion a named register decision, never silent):
//   · The board answers for TOMORROW when no date is given — verbatim legacy behaviour
//     (contad_app.js:2239-2247 redirects to tomorrow).
//   · Crew slots are all optional; there is no minimum crew (`row.spe1 || ""`, :2419). Each slot
//     now holds up to CREW_SLOT_CAPACITY people — a NEW capability, not a restored one: legacy
//     stored three single strings (models/tash4ela.js:10-12) and drew one card per cell
//     (tashghela.ejs:914-916). Nothing legacy did was dropped; the ceiling was raised.
//   · A crew member holds ONE vehicle per operating day (Q11): the legacy check lived only in the
//     browser (tashghela.ejs:1332) while POST blind-upserted (:2413) — promoted to the domain,
//     end-state-checked exactly like the fleet roster's FR-7 driver half.
//   · Crew is planned only for a vehicle on the Fleet roster for that date — the normalized form
//     of the legacy car_lock gate (tashghela listed only car_lock'd vehicles, :2255), and the
//     frozen §9.4 anchor: the crew row references the Fleet duty row by id.
//   · Replacement is upsert-in-place per (day, vehicle), exactly the legacy findOneAndUpdate
//     upsert; unchanged rows are pure no-ops (no write, no audit, no event).
//   · APPROVED DECISION 1 (design header): absence/attendance is NOT an eligibility gate here —
//     no availability seam is consulted, unlike the fleet roster's FR-6. Deliberate.
//   · APPROVED DECISION 2: requirements flags (leader/selah/…) gate NOTHING server-side — they
//     were pool decoration and browser filters in legacy (discovery §9). No role check on any
//     slot. Employees are validated to EXIST (and not be exited) through the platform directory
//     seam — reference integrity for the normalized ids, the fleet driver-profile precedent —
//     nothing more.
//   · The day row is ensured on plan (get-or-create): legacy has no day entity, so demanding an
//     explicit create-day step before planning would invent ceremony. No day-status gate on
//     planning — legacy planning is lockless; execution slices gate on OPEN, not this one.
import {
  OperationsEvents,
  type OperationsCrewBoardDto,
  type OperationsCrewBoardRowDto,
  type PlanOperationsCrew,
  type PlanOperationsCrewRow,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { BusinessRuleError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import { getDirectoryEmployee } from '../../../platform/directory';
import { emit } from '../../../platform/kernel/event-bus';
import { unitOfWork } from '../../../platform/kernel/unit-of-work';
import { diffChanges } from '../../../shared/utils/diff';
// §9.4 (frozen fleet design): OPS reads `fleet_duty_assignments` by date and attaches its work to
// the row by id. This import IS the boundary, not a breach of it — Fleet stays the only writer.
import { fleetDutyAssignmentRepository } from '../fleet-boundary';
import { fleetVehicleRepository } from '../fleet-boundary';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsCrewAssignmentRepository } from './crew-assignment.repository';
import { type OperationsCrewAssignmentDoc } from './crew-assignment.model';
import { crewMembers, slotIds } from './crew-slots';

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'crewAssignment',
  entityId: id,
});

/** The audited/compared surface — the crew facts, nothing derived. */
const snapshot = (doc: OperationsCrewAssignmentDoc) => ({
  captainEmployeeIds: slotIds(doc.captainEmployeeIds),
  specialist1EmployeeIds: slotIds(doc.specialist1EmployeeIds),
  specialist2EmployeeIds: slotIds(doc.specialist2EmployeeIds),
  direction: doc.direction,
  plannedTime: doc.plannedTime,
  notes: doc.notes,
});

/** Everyone the payload row puts on the vehicle, across all three slots. */
const rowCrew = (row: PlanOperationsCrewRow): string[] => [
  ...(row.captainEmployeeIds ?? []),
  ...(row.specialist1EmployeeIds ?? []),
  ...(row.specialist2EmployeeIds ?? []),
];

/** A row that ASSIGNS something, as opposed to one that only clears or annotates. */
const assigns = (row: PlanOperationsCrewRow): boolean => rowCrew(row).length > 0;

/** The legacy default planning date: tomorrow (contad_app.js:2239-2247). */
const tomorrow = (): Date => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
};

interface ChangedRow {
  vehicleId: string;
  captainEmployeeIds: string[];
  specialist1EmployeeIds: string[];
  specialist2EmployeeIds: string[];
}

interface PendingAudit {
  entityId: string;
  action: 'create' | 'update';
  changes: ReturnType<typeof diffChanges>;
}

class OperationsCrewService {
  /** The tashghela board: the Fleet duty rows for the date joined with the cash-crew rows. */
  async board(date: Date | undefined): Promise<OperationsCrewBoardDto> {
    const day = date === undefined ? tomorrow() : utcDay(date);
    const dayDoc = await operationsDayService.findByDate(day);
    const dutyRows = await fleetDutyAssignmentRepository.findForDate(day);
    const crewRows =
      dayDoc === null ? [] : await operationsCrewAssignmentRepository.findForDay(dayDoc._id);
    const crewByVehicle = new Map(crewRows.map((row) => [String(row.vehicleId), row]));

    const rows: OperationsCrewBoardRowDto[] = [];
    for (const duty of dutyRows) {
      const vehicle = await fleetVehicleRepository.findById(String(duty.vehicleId));
      const crew = crewByVehicle.get(String(duty.vehicleId));
      rows.push({
        vehicleId: String(duty.vehicleId),
        vehicleCode: vehicle?.code ?? String(duty.vehicleId),
        fleetDutyAssignmentId: String(duty._id),
        driver1EmployeeId:
          duty.driver1EmployeeId === null ? null : String(duty.driver1EmployeeId),
        driver2EmployeeId:
          duty.driver2EmployeeId === null ? null : String(duty.driver2EmployeeId),
        missionTypeId: duty.missionTypeId === null ? null : String(duty.missionTypeId),
        // The id is spread in HERE rather than added to `snapshot`, which the audit diffs at
        // :246/:249/:259 also use — an entity's own id in its own change list is noise, since
        // `entityRef.entityId` already carries it.
        crew: crew === undefined ? null : { id: String(crew._id), ...snapshot(crew) },
      });
    }

    return {
      date: day.toISOString(),
      day:
        dayDoc === null
          ? null
          : {
              id: String(dayDoc._id),
              date: dayDoc.date.toISOString(),
              status: dayDoc.status,
              openedById: dayDoc.openedById === null ? null : String(dayDoc.openedById),
              openedAt: dayDoc.openedAt === null ? null : dayDoc.openedAt.toISOString(),
              closedById: dayDoc.closedById === null ? null : String(dayDoc.closedById),
              closedAt: dayDoc.closedAt === null ? null : dayDoc.closedAt.toISOString(),
              version: dayDoc.__v,
              createdAt: dayDoc.createdAt.toISOString(),
              updatedAt: dayDoc.updatedAt.toISOString(),
            },
      rows,
    };
  }

  async plan(input: PlanOperationsCrew, by: string): Promise<{ changedCount: number }> {
    const day = utcDay(input.date);

    // §9.4 anchor — every planned vehicle must hold a Fleet duty row for the date (the legacy
    // car_lock gate, normalized). Resolved OUTSIDE the transaction: Fleet owns these rows.
    const dutyRows = await fleetDutyAssignmentRepository.findForDate(day);
    const dutyByVehicle = new Map(dutyRows.map((row) => [String(row.vehicleId), row]));
    for (const row of input.rows) {
      if (!dutyByVehicle.has(row.vehicleId)) {
        throw new BusinessRuleError(
          `vehicle ${row.vehicleId} is not on the Fleet roster for this date`,
          'OPERATIONS_FLEET_DUTY_REQUIRED',
        );
      }
    }

    // Reference integrity for the normalized employee ids, through the directory seam (the fleet
    // driver-profile precedent). Existence and not-exited ONLY — no role, department, flag or
    // attendance check, per the approved parity decisions.
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

    const dayDoc = await operationsDayService.ensureForDate(day, by);

    const outcome = await unitOfWork(async (session) => {
      const existing = await operationsCrewAssignmentRepository.findForDay(dayDoc._id, session);
      const byVehicle = new Map(existing.map((row) => [String(row.vehicleId), row]));

      // Q11, checked against the END STATE of the whole day (the fleet FR-7 shape): a row
      // outside the payload still holding a payload crew member means the plan forgot the
      // releasing row — the client must send BOTH sides of a move, exactly what a drag produces.
      const payloadVehicles = new Set(input.rows.map((row) => row.vehicleId));
      const payloadCrew = new Set(input.rows.flatMap(rowCrew));
      for (const row of existing) {
        if (payloadVehicles.has(String(row.vehicleId))) continue;
        // The Q11 traversal widened with the slots — the rule did not. Reusing the repository's
        // `takenCrew` here would be wrong: it answers over a WHOLE day and this asks about one
        // untouched row, so the two stay separate implementations of the same rule.
        for (const occupant of crewMembers(row)) {
          if (payloadCrew.has(occupant)) {
            throw new ConflictError(
              `employee ${occupant} already holds this day's crew assignment on vehicle ${String(row.vehicleId)} (Q11); include that vehicle's row to release them`,
            );
          }
        }
      }

      const changed: ChangedRow[] = [];
      const audits: PendingAudit[] = [];
      for (const row of input.rows) {
        const current = byVehicle.get(row.vehicleId);
        // An omitted slot CLEARS it, unchanged from when a slot held one person: the board sends
        // whole rows, and `undefined` has always meant "nobody", never "keep what is there". A
        // partial-update dialect would be a new behaviour, and this slice is not introducing one.
        const next = {
          captainEmployeeIds: row.captainEmployeeIds ?? [],
          specialist1EmployeeIds: row.specialist1EmployeeIds ?? [],
          specialist2EmployeeIds: row.specialist2EmployeeIds ?? [],
          direction: row.direction ?? null,
          plannedTime: row.plannedTime ?? null,
          notes: row.notes ?? null,
        };
        const set: Partial<OperationsCrewAssignmentDoc> = {
          captainEmployeeIds: next.captainEmployeeIds.map((id) => new Types.ObjectId(id)),
          specialist1EmployeeIds: next.specialist1EmployeeIds.map((id) => new Types.ObjectId(id)),
          specialist2EmployeeIds: next.specialist2EmployeeIds.map((id) => new Types.ObjectId(id)),
          direction: next.direction,
          plannedTime: next.plannedTime,
          notes: next.notes,
        };

        let doc: OperationsCrewAssignmentDoc;
        if (current === undefined) {
          // An empty plan for a vehicle that HAS no row is nothing — the fleet roster rule.
          if (!assigns(row) && next.direction === null && next.plannedTime === null && next.notes === null) {
            continue;
          }
          const duty = dutyByVehicle.get(row.vehicleId);
          if (duty === undefined) continue; // unreachable: checked before the transaction
          doc = await operationsCrewAssignmentRepository.create(
            {
              operationsDayId: dayDoc._id,
              vehicleId: new Types.ObjectId(row.vehicleId),
              fleetDutyAssignmentId: duty._id,
              ...set,
            },
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
          doc = await operationsCrewAssignmentRepository.updateById(String(current._id), set, {
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
          captainEmployeeIds: next.captainEmployeeIds,
          specialist1EmployeeIds: next.specialist1EmployeeIds,
          specialist2EmployeeIds: next.specialist2EmployeeIds,
        });
      }
      return { changed, audits };
    });

    // Audit + events only after the transaction has committed (roster.service.ts:272).
    for (const audit of outcome.audits) {
      await auditService.record({
        entityRef: entityRef(audit.entityId),
        action: audit.action,
        changes: audit.changes,
      });
    }
    for (const row of outcome.changed) {
      await emit(OperationsEvents.CrewAssignmentChanged, {
        dayId: String(dayDoc._id),
        vehicleId: row.vehicleId,
        date: day,
        captainEmployeeIds: row.captainEmployeeIds,
        specialist1EmployeeIds: row.specialist1EmployeeIds,
        specialist2EmployeeIds: row.specialist2EmployeeIds,
      });
    }
    await emit(OperationsEvents.CrewPlanned, {
      dayId: String(dayDoc._id),
      date: day,
      changedCount: outcome.changed.length,
    });
    return { changedCount: outcome.changed.length };
  }
}

export const operationsCrewService = new OperationsCrewService();
