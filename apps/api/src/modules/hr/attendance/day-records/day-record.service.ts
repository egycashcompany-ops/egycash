// The engine's orchestrator (v1.1 §4): gathers one employee-day's inputs, calls the pure core,
// and upserts exactly one row — idempotently, through the unique {employeeId, workDate} key.
//
// The freeze guard lives HERE and nowhere lower: a row with `frozenAt` set is never rewritten,
// no matter what arrives — a late punch import, a leave event, a manual recompute. Nothing in
// AT-1..3 sets `frozenAt`; the trigger is the Payroll Run's (AT-4, D-PR-07 Option A). The guard
// ships with the engine because an engine without it is safe only by coincidence.
import { Types } from 'mongoose';
import {
  HrAttendanceEvents,
  HrAttendanceSettingKeys,
  type AttendanceDayDto,
  type ListAttendanceDaysQuery,
  type Paginated,
  type RecomputeAttendanceDays,
} from '@ecms/contracts';
import { NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { settingsService } from '../../../../platform/settings';
import { logger } from '../../../../infrastructure/logging/logger';
import {
  addDays,
  cairoToday,
  dateOnlyIso,
  isoWeekday,
  toDateOnly,
} from '../../shared/business-date';
import { employeeRepository, type EmployeeDoc } from '../../employee-management/employees';
import { LeaveRequestModel, type LeaveRequestDoc } from '../../leave-management/leave-requests';
import { workCalendarService } from '../../work-calendar';
import { shiftRepository, type ShiftDoc } from '../shifts';
import { shiftAssignmentService } from '../assignments';
import { punchRepository } from '../punches';
import {
  deriveDay,
  shiftWindow,
  PUNCH_WINDOW_AFTER_MS,
  PUNCH_WINDOW_BEFORE_MS,
  type EnginePunch,
} from './derive-day';
import { AttendanceDayModel, type AttendanceDayDoc } from './day-record.model';
import { dayRecordRepository } from './day-record.repository';

const ORG_SUBJECT = { userId: null, branchId: null };

/** Leave that covers a day for the engine: decided-and-running, or already lived. */
const COVERING_LEAVE_STATUSES = ['approved', 'active', 'completed'] as const;

export const toAttendanceDayDto = (doc: AttendanceDayDoc): AttendanceDayDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  workDate: dateOnlyIso(doc.workDate),
  status: doc.status,
  shiftId: doc.shiftId === null ? null : String(doc.shiftId),
  firstInAt: doc.firstInAt === null ? null : doc.firstInAt.toISOString(),
  lastOutAt: doc.lastOutAt === null ? null : doc.lastOutAt.toISOString(),
  workedMinutes: doc.workedMinutes,
  lateMinutes: doc.lateMinutes,
  earlyLeaveMinutes: doc.earlyLeaveMinutes,
  overtimeMinutes: doc.overtimeMinutes,
  approvedOvertimeMinutes: doc.approvedOvertimeMinutes,
  leaveId: doc.leaveId === null ? null : String(doc.leaveId),
  flags: doc.flags,
  branchId: String(doc.branchId),
  computedAt: doc.computedAt.toISOString(),
  frozenAt: doc.frozenAt === null ? null : doc.frozenAt.toISOString(),
});

/** Employed on the date per the derived hire→exit periods; the hire date covers legacy rows. */
const employedOn = (employee: EmployeeDoc, workDate: Date): boolean => {
  if (employee.employmentPeriods.length > 0) {
    return employee.employmentPeriods.some(
      (p) =>
        toDateOnly(p.hiredAt).getTime() <= workDate.getTime() &&
        (p.exitedAt === null || toDateOnly(p.exitedAt).getTime() >= workDate.getTime()),
    );
  }
  return toDateOnly(employee.employment.startDate).getTime() <= workDate.getTime();
};

class DayRecordService {
  async list(query: ListAttendanceDaysQuery): Promise<Paginated<AttendanceDayDoc>> {
    return dayRecordRepository.listDays(query);
  }

  /** ESS: the caller's own month — own by construction (resolved from the login link). */
  async listMine(
    userId: string,
    query: Omit<ListAttendanceDaysQuery, 'employeeId' | 'branchId'>,
  ): Promise<Paginated<AttendanceDayDoc>> {
    const employee = await employeeRepository.findByUserIdSystem(userId);
    if (employee === null) throw new NotFoundError('no employee is linked to this login');
    return dayRecordRepository.listDays({ ...query, employeeId: String(employee._id) });
  }

  /**
   * Compute (or recompute) one employee-day. Returns the row, `'frozen'` when the §4 guard
   * refused, or null when the employee was not employed that day (no row — and a stale row from
   * an employment correction is removed so the answer stays exactly one or exactly none).
   */
  async computeDay(
    employeeId: string,
    workDateInput: Date,
  ): Promise<AttendanceDayDoc | 'frozen' | null> {
    const workDate = toDateOnly(workDateInput);
    const employee = await employeeRepository.findById(employeeId);
    if (employee === null) return null;

    const existing = await AttendanceDayModel.findOne({
      employeeId: employee._id,
      workDate,
      isDeleted: false,
    })
      .lean<AttendanceDayDoc>()
      .exec();
    if (existing !== null && existing.frozenAt !== null) return 'frozen';

    if (!employedOn(employee, workDate)) {
      if (existing !== null) {
        await AttendanceDayModel.deleteOne({ _id: existing._id }).exec();
      }
      return null;
    }

    // Inputs, in the order the resolution consumes them.
    const leaveDoc = await LeaveRequestModel.findOne({
      employeeId: employee._id,
      status: { $in: [...COVERING_LEAVE_STATUSES] },
      startDate: { $lte: workDate },
      endDate: { $gte: workDate },
      isDeleted: false,
    })
      .lean<LeaveRequestDoc>()
      .exec();
    const leave =
      leaveDoc === null
        ? null
        : {
            leaveId: String(leaveDoc._id),
            halfDay:
              (leaveDoc.halfDayStart && toDateOnly(leaveDoc.startDate).getTime() === workDate.getTime()) ||
              (leaveDoc.halfDayEnd && toDateOnly(leaveDoc.endDate).getTime() === workDate.getTime()),
          };

    const [holidays, weekendDays] = await Promise.all([
      workCalendarService.listHolidays(workDate, workDate),
      workCalendarService.weekendDays(),
    ]);

    const shiftId = await shiftAssignmentService.resolveShiftIdForDate(
      String(employee._id),
      workDate,
    );
    const shift: ShiftDoc | null = shiftId === null ? null : await shiftRepository.findById(shiftId);

    let punches: EnginePunch[] = [];
    if (shift !== null) {
      const { start, end } = shiftWindow(workDate, shift);
      const rows = await punchRepository.listForWindow(
        employee._id as Types.ObjectId,
        new Date(start.getTime() - PUNCH_WINDOW_BEFORE_MS),
        new Date(end.getTime() + PUNCH_WINDOW_AFTER_MS),
      );
      punches = rows.map((p) => ({
        at: p.at,
        direction: p.direction,
        source: p.source,
        branchIdAtPunch: p.branchIdAtPunch === null ? null : String(p.branchIdAtPunch),
      }));
    }

    const derived = deriveDay({
      workDate,
      employed: true,
      leave,
      holiday: holidays.length > 0,
      weekend: weekendDays.includes(isoWeekday(workDate)),
      shift,
      punches,
      employeeBranchId: String(employee.employment.branchId),
    });
    if (derived === null) return null;

    const now = new Date();
    const updated = await AttendanceDayModel.findOneAndUpdate(
      // The freeze guard rides INSIDE the atomic upsert: a row frozen between the read above and
      // this write is matched out, so the engine cannot overtake a concurrent freeze.
      { employeeId: employee._id, workDate, frozenAt: null },
      {
        $set: {
          status: derived.status,
          shiftId: shift === null ? null : shift._id,
          firstInAt: derived.firstInAt,
          lastOutAt: derived.lastOutAt,
          workedMinutes: derived.workedMinutes,
          lateMinutes: derived.lateMinutes,
          earlyLeaveMinutes: derived.earlyLeaveMinutes,
          overtimeMinutes: derived.overtimeMinutes,
          leaveId: derived.leaveId === null ? null : new Types.ObjectId(derived.leaveId),
          flags: derived.flags,
          branchId: employee.employment.branchId,
          computedAt: now,
          isDeleted: false,
        },
        $setOnInsert: {
          frozenAt: null,
          approvedOvertimeMinutes: 0,
          createdBy: null,
          updatedBy: null,
        },
      },
      { new: true, upsert: true },
    )
      .lean<AttendanceDayDoc>()
      .exec();

    await emit(HrAttendanceEvents.DayComputed, {
      employeeId: String(employee._id),
      workDate: dateOnlyIso(workDate),
      status: updated.status,
      branchId: String(updated.branchId),
    });
    if (updated.status === 'absent') {
      await emit(HrAttendanceEvents.DayAbsent, {
        employeeId: String(employee._id),
        workDate: dateOnlyIso(workDate),
        status: updated.status,
        branchId: String(updated.branchId),
      });
    }
    return updated;
  }

  /** Recompute a window for one employee or everyone. Frozen days are counted, never touched. */
  async recompute(
    ctx: AuthContext,
    input: RecomputeAttendanceDays,
  ): Promise<{ computed: number; skippedFrozen: number }> {
    const from = toDateOnly(input.from);
    const to = toDateOnly(input.to);
    const employeeIds =
      input.employeeId !== undefined
        ? [input.employeeId]
        : await this.allComputableEmployeeIds();

    let computed = 0;
    let skippedFrozen = 0;
    for (const employeeId of employeeIds) {
      for (let d = from; d.getTime() <= to.getTime(); d = addDays(d, 1)) {
        const outcome = await this.computeDay(employeeId, d);
        if (outcome === 'frozen') skippedFrozen += 1;
        else if (outcome !== null) computed += 1;
      }
    }
    await auditService.record({
      entityRef: { moduleId: 'hr', entityType: 'attendanceDays', entityId: dateOnlyIso(from) },
      action: 'attendanceRecompute',
      changes: [
        { field: 'from', old: null, new: dateOnlyIso(from) },
        { field: 'to', old: null, new: dateOnlyIso(to) },
        { field: 'employeeId', old: null, new: input.employeeId ?? 'all' },
        { field: 'computed', old: null, new: String(computed) },
        { field: 'skippedFrozen', old: null, new: String(skippedFrozen) },
      ],
    });
    return { computed, skippedFrozen };
  }

  /** The nightly compute (§9): the previous Cairo day, at the configured hour, idempotent. */
  async computePreviousDayIfDue(): Promise<void> {
    const hour = await settingsService.resolve<number>(
      HrAttendanceSettingKeys.AutoComputeHour,
      ORG_SUBJECT,
    );
    const cairoHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Cairo',
        hour: 'numeric',
        hour12: false,
      }).format(new Date()),
    );
    if (cairoHour !== hour) return;

    const workDate = addDays(cairoToday(), -1);
    const employeeIds = await this.allComputableEmployeeIds();
    let computed = 0;
    for (const employeeId of employeeIds) {
      try {
        const outcome = await this.computeDay(employeeId, workDate);
        if (outcome !== null && outcome !== 'frozen') computed += 1;
      } catch (error) {
        // One employee's bad data must not starve the rest of the sweep.
        logger.error({ err: error, employeeId }, 'attendance: nightly compute failed for employee');
      }
    }
    logger.info({ workDate: dateOnlyIso(workDate), computed }, 'attendance: nightly compute done');
  }

  /** Event subscriber (leave started/ended, employee exited): recompute the affected span. */
  async recomputeSpanForEmployee(employeeId: string, from: Date, to: Date): Promise<void> {
    const start = toDateOnly(from);
    const end = toDateOnly(to);
    // Bounded defensively: an event carrying a year-long span must not stall the bus.
    const cap = 366;
    let steps = 0;
    for (let d = start; d.getTime() <= end.getTime() && steps < cap; d = addDays(d, 1), steps += 1) {
      try {
        await this.computeDay(employeeId, d);
      } catch (error) {
        logger.error({ err: error, employeeId }, 'attendance: event-driven recompute failed');
        return;
      }
    }
  }

  /** Everyone the engine may owe a row: the not-yet-exited, plus anyone exited (their past days). */
  private async allComputableEmployeeIds(): Promise<string[]> {
    const rows = await employeeRepository.listIdsForAttendance();
    return rows;
  }
}

export const dayRecordService = new DayRecordService();
