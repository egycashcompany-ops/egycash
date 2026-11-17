// The operations crew roster and its requirement flags — the legacy `/requirement` screen, plus
// the pool the crew board drags from.
//
// THE ONE RULE THAT IS NOT HERE. Requirements gate nothing (approved decision, carried since PR 1):
// no method below refuses an assignment. They are metadata, indicators and filters, which is
// precisely what they were in legacy — only `leader`/`isCaptain` was ever read by a server query,
// and even that only narrowed a picker.
// ROUND 23 — except the two ROLE flags, for the crew saves: «ممنوع ان اعين قائد مكان اخصائى والعكس
// الا فى حالة انه قائد اخصائى». `crew-roles.ts` reads «قائد» and «أخصائي» to refuse a new seat the
// role does not fit; this service still refuses nothing, and the other eight flags gate nothing.
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
  type OperationsCrewAvailability,
  type OperationsCrewDirectoryDto,
  type OperationsCrewMemberDto,
  type SetOperationsCrewRequirements,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { auditService } from '../../../platform/audit';
import {
  approvedLeaveEmployeeIds,
  getDirectoryAttendanceDay,
  getDirectoryEmployee,
  listDirectoryEmployeesByDepartment,
} from '../../../platform/directory';
import { jobTitleRepository } from '../../../platform/organization';
import { settingsService } from '../../../platform/settings';
import { diffChanges } from '../../../shared/utils/diff';
import { operationsDayService, utcDay } from '../days/day.service';
import { operationsCrewAssignmentRepository } from './crew-assignment.repository';
import { crewMembers } from './crew-slots';
import { operationsCrewRequirementsRepository } from './crew-requirements.repository';
import { resolveCrewDepartmentIds } from './crew-departments';
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
    // `noSchedule` sits with these deliberately. An employee with no shift and no default pattern
    // derives it where they used to derive `dayOff`, and the board's question — can I count on
    // this person today — has the same answer either way. Letting it fall through to `default`
    // would quietly move every unscheduled employee into `unknown`.
    case 'weekend':
    case 'holiday':
    case 'dayOff':
    case 'noSchedule':
      return 'notScheduled';
    default:
      return 'unknown';
  }
};

/**
 * ROUND 22 — is this member AWAY on the day? «وعاوز لو القائد غايب يظهر تحت الكل بقى فى الاخر يبقى
 * باللون الباهت ومقدرش احطه على العربيه و كذلك الاخصائيين».
 *
 * HR's day record answers when HR has one, bucketed exactly as the attendance page counts it, so
 * the two screens cannot call one person two things. When HR has NOT computed the day — the nightly
 * sweep computes yesterday, so that is every future day, the board's own tomorrow included — the
 * only fact HR already holds about it is an approved or active leave, and that answers 'onLeave'.
 * Nothing else is «away»: a weekend, «incomplete» and no record are null, because an unknown is not
 * an absence and must never keep somebody off a van.
 */
export const crewAvailabilityFrom = (
  record: { status: AttendanceDayStatus } | undefined,
  onApprovedLeave: boolean,
): OperationsCrewAvailability | null => {
  if (record !== undefined) {
    const bucket = attendanceBucket(record.status);
    return bucket === 'absent' || bucket === 'onLeave' ? bucket : null;
  }
  return onApprovedLeave ? 'onLeave' : null;
};

/**
 * Who of these people is away on the day — only the away ones are keys. ONE attendance read and ONE
 * leave read for the whole list, both batched through the directory seam, never a read per person.
 *
 * The pool (`directory`) and the save (`operationsCrewService.plan`) both ask HERE, so the board can
 * never show someone placeable whom the save then refuses, or the other way round.
 */
export const crewAvailabilityOn = async (
  employeeIds: readonly string[],
  day: Date,
): Promise<Map<string, OperationsCrewAvailability>> => {
  const ids = [...new Set(employeeIds)];
  const away = new Map<string, OperationsCrewAvailability>();
  if (ids.length === 0) return away;
  const [records, onLeave] = await Promise.all([
    getDirectoryAttendanceDay(ids, day),
    approvedLeaveEmployeeIds(ids, day),
  ]);
  for (const employeeId of ids) {
    const availability = crewAvailabilityFrom(records.get(employeeId), onLeave.has(employeeId));
    if (availability !== null) away.set(employeeId, availability);
  }
  return away;
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
    const configuredIds = await settingsService.resolve<string[]>(
      OperationsSettingKeys.CrewDepartmentIds,
      ORG_SUBJECT,
    );
    // A saved id is a COMPANY department, not one branch's copy of it: «نقل الأموال» ticked once is
    // «نقل الأموال» in every branch that has it, a branch opened later included (crew-departments.ts).
    const departmentIds = await resolveCrewDepartmentIds(configuredIds);
    const byEmployee = new Map(rows.map((row) => [String(row.employeeId), row]));

    const roster =
      configuredIds.length > 0
        ? await listDirectoryEmployeesByDepartment(departmentIds)
        : // UNCONFIGURED: fall back to whoever already holds a row — the behaviour before this
          // setting existed. Adding by hand is gone, so an empty roster would be unfillable.
          (
            await Promise.all(rows.map((row) => getDirectoryEmployee(String(row.employeeId))))
          ).filter((employee): employee is NonNullable<typeof employee> => employee !== null);

    // «الوظيفة» (Round 19): the seats travel with the roster as ids; their names are the
    // organization catalogue's, read once for the whole roster rather than once per member. A seat
    // the catalogue no longer has is shown as none, never as an id.
    const jobTitleIds = [
      ...new Set(
        roster
          .map((employee) => employee.jobTitleId ?? null)
          .filter((id): id is string => id !== null),
      ),
    ];
    const jobTitleNames = new Map(
      (await jobTitleRepository.findByIdsSystem(jobTitleIds)).map((title) => [
        String(title._id),
        { ar: title.name.ar, en: title.name.en },
      ]),
    );
    const jobTitleOf = (id: string | null | undefined): OperationsCrewMemberDto['jobTitle'] => {
      const name = id == null ? undefined : jobTitleNames.get(id);
      return id == null || name === undefined ? null : { id, name };
    };

    const search = query?.search?.trim().toLowerCase() ?? '';
    const offered = roster.filter(
      (employee) =>
        // Somebody who has left is not offered, whichever way they were found.
        employee.status !== 'exited' &&
        (search === '' ||
          employee.fullNameAr.toLowerCase().includes(search) ||
          employee.code.toLowerCase().includes(search)),
    );
    // Round 22: who is away that day — read once for everyone offered (`crewAvailabilityOn`).
    const away = await crewAvailabilityOn(
      offered.map((employee) => employee.employeeId),
      day,
    );

    const members: OperationsCrewMemberDto[] = [];
    for (const employee of offered) {
      const row = byEmployee.get(employee.employeeId);
      members.push({
        employeeId: employee.employeeId,
        code: employee.code,
        fullNameAr: employee.fullNameAr,
        status: employee.status,
        jobTitle: jobTitleOf(employee.jobTitleId),
        // The member's card on «كشف طاقم العمليات» (Round 19b): the Fleet driver card's phone and
        // branch, as the seam already answers them for every entry — nothing extra is read.
        phone: employee.phone,
        branchId: employee.branchId,
        // Null means "nothing recorded yet", NOT "carries nothing" — the card says so, and the
        // first flag anybody sets creates the row.
        requirements: row === undefined ? null : toRequirementsDto(row),
        assignedVehicleId: taken.get(employee.employeeId) ?? null,
        // Only the bucket, under the roster's own grant like the name — never HR's punches or the
        // leave itself. Who sees what is deferred by the owner («موضوع مين يشوف ايه ومين يعمل ايه دا
        // مش دلوقتي»), so this is the least the board needs to fade a name and refuse a drop.
        availability: away.get(employee.employeeId) ?? null,
      });
    }

    // Captains first, then by code — the legacy pool sorted by `employee_id` (:2296) and grouped
    // captains visually. Ordering is a server fact so every client shows the same pool.
    members.sort(
      (a, b) =>
        Number(b.requirements?.isCaptain ?? false) - Number(a.requirements?.isCaptain ?? false) ||
        a.code.localeCompare(b.code),
    );

    return { date: day.toISOString(), members, rosterIsDerived: configuredIds.length > 0 };
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
    // Everybody on ANY of the day's rows, a row without a van included (Round 20): the pool's
    // `assignedVehicleId` names only a vehicle, and this page asks whether the person is crewed.
    const crewed = await this.crewedOn(day);
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
        isCrewed: crewed.has(member.employeeId),
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

  /** Every employee holding a slot on one of the day's live crew rows, with a van or without. */
  private async crewedOn(day: Date): Promise<Set<string>> {
    const crewed = new Set<string>();
    const dayDoc = await operationsDayService.findByDate(day);
    if (dayDoc === null) return crewed;
    for (const row of await operationsCrewAssignmentRepository.findForDay(dayDoc._id)) {
      for (const employeeId of crewMembers(row)) crewed.add(employeeId);
    }
    return crewed;
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
