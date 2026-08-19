// The operations crew roster and its requirement flags — the legacy `/requirement` screen, plus
// the pool the crew board drags from.
//
// THE ONE RULE THAT IS NOT HERE. Requirements gate nothing (approved decision, carried since PR 1):
// no method below refuses an assignment, and the crew service consults none of these flags. They
// are metadata, indicators and filters, which is precisely what they were in legacy — only
// `leader`/`isCaptain` was ever read by a server query, and even that only narrowed a picker.
//
// WHAT IS ENFORCED is reference integrity: an employee must exist and not have left, resolved
// through the platform directory seam. That is the same check the crew service makes on a slot,
// and the same the fleet driver profile makes — it is not an eligibility rule, it is the
// difference between a reference and a dangling id.
import {
  OperationsSettingKeys,
  type AttendanceDayStatus,
  type ListOperationsCrewRequirementsQuery,
  type OperationsCrewAttendanceDayDto,
  type OperationsCrewAttendanceDto,
  type OperationsCrewDirectoryDto,
  type OperationsCrewMemberDto,
  type SetOperationsCrewRequirements,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import {
  getDirectoryAttendanceDay,
  getDirectoryEmployee,
  listDirectoryEmployeesByDepartment,
} from '../../../platform/directory';
import { settingsService } from '../../../platform/settings';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsCrewAssignmentRepository } from './crew-assignment.repository';
import { operationsCrewRequirementsRepository } from './crew-requirements.repository';
import { type OperationsCrewRequirementsDoc } from './crew-requirements.model';

/**
 * HR's ten day statuses → the five buckets a planner reads. Exported so the summary and any later
 * consumer bucket identically; `incomplete` and an absent record both land in `unknown` because
 * neither is an answer.
 */
export const attendanceBucket = (
  status: AttendanceDayStatus | undefined,
): 'present' | 'absent' | 'onLeave' | 'notScheduled' | 'unknown' => {
  switch (status) {
    case 'present':
    case 'late':
    case 'earlyLeave':
    case 'lateAndEarly':
      return 'present';
    case 'absent':
      return 'absent';
    case 'onLeave':
      return 'onLeave';
    case 'weekend':
    case 'holiday':
    case 'dayOff':
      return 'notScheduled';
    default:
      return 'unknown';
  }
};

/** Organization scope: who works in Operations is one fact about the company. */
const ORG_SUBJECT = { userId: null, branchId: null };

const entityRef = (id: string) => ({
  moduleId: 'operations',
  entityType: 'crewRequirements',
  entityId: id,
});

const snapshot = (doc: OperationsCrewRequirementsDoc) => ({
  isCaptain: doc.isCaptain,
  isSpecialist: doc.isSpecialist,
  isNewJoiner: doc.isNewJoiner,
  hasWeapon: doc.hasWeapon,
  hasSignature: doc.hasSignature,
  hasLicense: doc.hasLicense,
  hasTemporaryLicense: doc.hasTemporaryLicense,
  isOpsAdmin: doc.isOpsAdmin,
  isAssignedSpecialTask: doc.isAssignedSpecialTask,
  isPriority: doc.isPriority,
  notes: doc.notes,
});

class OperationsCrewRequirementsService {
  /**
   * Upsert one employee's row — the legacy screen had no create/edit distinction, only a saved
   * checkbox line, so neither does this.
   */
  async set(
    employeeId: string,
    input: SetOperationsCrewRequirements,
    by: string,
  ): Promise<OperationsCrewRequirementsDoc> {
    const employee = await getDirectoryEmployee(employeeId);
    if (employee === null) {
      throw new ValidationError([
        { field: 'params.employeeId', code: 'UNKNOWN', message: `employee ${employeeId} not found` },
      ]);
    }
    if (employee.status === 'exited') {
      throw new ConflictError(`employee ${employeeId} has exited and cannot be operations crew`);
    }

    const existing = await operationsCrewRequirementsRepository.findByEmployee(employeeId);
    if (existing === null) {
      const doc = await operationsCrewRequirementsRepository.create(
        { employeeId: new Types.ObjectId(employeeId), ...input },
        { by },
      );
      await auditService.record({
        entityRef: entityRef(String(doc._id)),
        action: 'create',
        changes: diffChanges({}, snapshot(doc)),
      });
      return doc;
    }

    const doc = await operationsCrewRequirementsRepository.updateById(String(existing._id), input, {
      by,
      version: existing.__v,
    });
    await auditService.record({
      entityRef: entityRef(String(doc._id)),
      action: 'update',
      changes: diffChanges(snapshot(existing), snapshot(doc)),
    });
    return doc;
  }

  /** Remove someone from the operations roster. Soft — the audit trail keeps what they were. */
  async findByEmployee(employeeId: string): Promise<OperationsCrewRequirementsDoc | null> {
    return operationsCrewRequirementsRepository.findByEmployee(employeeId);
  }

  /**
   * THE CREW BOARD'S POOL for a given day: everyone on the roster, with their flags, their HR
   * identity resolved through the seam, and — the part the board actually needs — which vehicle
   * they ALREADY hold that day.
   *
   * That last field is the server's answer to the question legacy answered in the browser
   * (tashghela.ejs:1332 greyed out a taken card). It matters that it is a server fact here,
   * because the SAME rule is enforced server-side as Q11: if the pool and the enforcement could
   * disagree, an operator would be shown a card the save then rejects.
   *
   * Exited employees are dropped rather than shown greyed: legacy's pool query filtered on
   * `work_status: 1` (contad_app.js:2296), so someone who has left simply is not offered.
   */
  async directory(date: Date | undefined, query?: { search?: string }): Promise<OperationsCrewDirectoryDto> {
    const day = utcDay(date ?? new Date());
    const rows = await operationsCrewRequirementsRepository.findAll();

    // Who is already crewed that day — one read, then a map, rather than a query per member.
    const dayDoc = await operationsDayService.findByDate(day);
    const taken = new Map<string, string>();
    if (dayDoc !== null) {
      const assignments = await operationsCrewAssignmentRepository.findForDay(dayDoc._id);
      for (const [employeeId, vehicleId] of operationsCrewAssignmentRepository.takenCrew(
        assignments,
      )) {
        taken.set(employeeId, vehicleId);
      }
    }

    // WHO IS OPERATIONS CREW — the org chart, not a list Operations keeps.
    //
    // Legacy asked exactly this of the department (contad_app.js:2296) and ECMS had replaced it
    // with a roster you added people to. A second list of who works here is a list that goes
    // stale: a new hire stayed invisible to Operations until somebody remembered them, and a
    // leaver stayed on it until somebody remembered again.
    //
    // The requirements row is no longer MEMBERSHIP. It is what Operations knows ABOUT a member —
    // the flags — created the first time somebody sets one. A member with no row yet is a real
    // member with nothing recorded, which is why `requirements` is nullable in the DTO.
    const departmentIds = await settingsService.resolve<string[]>(
      OperationsSettingKeys.CrewDepartmentIds,
      ORG_SUBJECT,
    );
    const byEmployee = new Map(rows.map((row) => [String(row.employeeId), row]));

    const roster =
      departmentIds.length > 0
        ? await listDirectoryEmployeesByDepartment(departmentIds)
        : // UNCONFIGURED: fall back to whoever already holds a row — the behaviour before this
          // setting existed. Adding by hand is gone, so an empty roster would be unfillable.
          (
            await Promise.all(rows.map((row) => getDirectoryEmployee(String(row.employeeId))))
          ).filter((employee): employee is NonNullable<typeof employee> => employee !== null);

    const search = query?.search?.trim().toLowerCase() ?? '';
    const members: OperationsCrewMemberDto[] = [];
    for (const employee of roster) {
      // Somebody who has left is not offered, whichever way they were found.
      if (employee.status === 'exited') continue;
      if (
        search !== '' &&
        !employee.fullNameAr.toLowerCase().includes(search) &&
        !employee.code.toLowerCase().includes(search)
      ) {
        continue;
      }

      const row = byEmployee.get(employee.employeeId);
      members.push({
        employeeId: employee.employeeId,
        code: employee.code,
        fullNameAr: employee.fullNameAr,
        status: employee.status,
        // Null means "nothing recorded yet", NOT "carries nothing" — the card says so, and the
        // first flag anybody sets creates the row.
        requirements: row === undefined ? null : toRequirementsDto(row),
        assignedVehicleId: taken.get(employee.employeeId) ?? null,
      });
    }

    // Captains first, then by code — the legacy pool sorted by `employee_id` (:2296) and grouped
    // captains visually. Ordering is a server fact so every client shows the same pool.
    members.sort(
      (a, b) =>
        Number(b.requirements?.isCaptain ?? false) - Number(a.requirements?.isCaptain ?? false) ||
        a.code.localeCompare(b.code),
    );

    return { date: day.toISOString(), members, rosterIsDerived: departmentIds.length > 0 };
  }

  /**
   * The day's attendance BESIDE the roster — read-only, and gating nothing.
   *
   * It reuses `directory()` rather than re-reading the roster, so "who is Operations crew" has one
   * answer in the system. Every member of the roster appears, including the ones attendance has no
   * record for: an absent screen row is a fact a planner needs, and silently omitting the unknowns
   * would make the page look complete when it is not.
   *
   * Legacy never asked this question for cash-transfer crew at all (discovery §10.2). Showing it
   * is the new part; refusing to act on it is the part that stays legacy-faithful.
   */
  async attendance(date: Date): Promise<OperationsCrewAttendanceDayDto> {
    const day = utcDay(date);
    const { members: roster } = await this.directory(day);
    const attendance = await getDirectoryAttendanceDay(
      roster.map((m) => m.employeeId),
      day,
    );

    const members: OperationsCrewAttendanceDto[] = roster.map((member) => {
      const row = attendance.get(member.employeeId);
      return {
        employeeId: member.employeeId,
        code: member.code,
        fullNameAr: member.fullNameAr,
        attendance: row === undefined ? null : { status: row.status, onLeave: row.onLeave },
        assignedVehicleId: member.assignedVehicleId,
      };
    });

    // Counted here, once, so the header and the rows cannot tell different stories. Every bucket
    // is explicit and the default is `unknown`, so a status added to HR later shows up as
    // unaccounted-for rather than being silently counted as somebody being at work.
    const summary = {
      total: members.length,
      present: 0,
      absent: 0,
      onLeave: 0,
      notScheduled: 0,
      unknown: 0,
    };
    for (const member of members) {
      summary[attendanceBucket(member.attendance?.status)] += 1;
    }

    return { date: day.toISOString(), members, summary };
  }

  async list(query: ListOperationsCrewRequirementsQuery) {
    const filter: Record<string, unknown> = {};
    if (query.isCaptain !== undefined) filter.isCaptain = query.isCaptain;
    if (query.isSpecialist !== undefined) filter.isSpecialist = query.isSpecialist;
    return operationsCrewRequirementsRepository.listRequirements({
      filter,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });
  }
}

export const toRequirementsDto = (doc: OperationsCrewRequirementsDoc) => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  isCaptain: doc.isCaptain,
  isSpecialist: doc.isSpecialist,
  hasWeapon: doc.hasWeapon,
  hasSignature: doc.hasSignature,
  hasLicense: doc.hasLicense,
  hasTemporaryLicense: doc.hasTemporaryLicense,
  isOpsAdmin: doc.isOpsAdmin,
  isNewJoiner: doc.isNewJoiner,
  isAssignedSpecialTask: doc.isAssignedSpecialTask,
  isPriority: doc.isPriority,
  notes: doc.notes,
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const operationsCrewRequirementsService = new OperationsCrewRequirementsService();
