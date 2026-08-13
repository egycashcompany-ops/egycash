// Overtime approval (D5) — QUANTITY RELEASE ONLY. The engine derives `overtimeMinutes`; this is
// the decision that lets some of it reach the §15.1 feed as `approvedOvertimeMinutes`. Nothing
// here knows what a minute costs: pricing is Payroll's, where the approved figure is read as the
// QUANTITY for a `perMinute` pay item (PY-3 sets the rate, PY-4 supplies the minutes). No overtime
// premium or multiplier is built anywhere in this repository — an approved minute is worth the
// item's own rate and nothing more.
//
// The ceiling is absolute — never above the derived minutes — and it is maintained from BOTH
// sides: this service refuses to grant above the derivation, and the engine clamps a previously
// approved value down when a recompute lowers the derived number. A frozen day refuses approval
// outright: changing `approvedOvertimeMinutes` after a freeze would change the feed, and the
// feed of a frozen period never moves (corrections flow forward as adjustments).
import { type ApproveOvertime, HrAttendanceEvents } from '@ecms/contracts';
import { BusinessRuleError, NotFoundError } from '../../../../shared/errors';
import { type AuthContext } from '../../../../shared/types';
import { auditService } from '../../../../platform/audit';
import { emit } from '../../../../platform/kernel/event-bus';
import { notificationsService } from '../../../../platform/notifications';
import { HrAttendanceTemplates } from '@ecms/contracts';
import { dateOnlyIso } from '../../shared/business-date';
import { employeeRepository } from '../../employee-management/employees';
import { dayRecordRepository, type AttendanceDayDoc } from '../day-records';

const entityRef = (id: string) => ({ moduleId: 'hr', entityType: 'attendanceDay', entityId: id });

class OvertimeService {
  /** `dayId` is the day record — the aggregate the approval marks (v1.1 §3). */
  async approve(ctx: AuthContext, dayId: string, input: ApproveOvertime): Promise<AttendanceDayDoc> {
    const day = await dayRecordRepository.findById(dayId);
    if (day === null) throw new NotFoundError('attendance day not found');
    if (day.frozenAt !== null) {
      throw new BusinessRuleError(
        'this day is frozen — an overtime correction flows forward as a payroll adjustment',
      );
    }
    if (input.approvedMinutes > day.overtimeMinutes) {
      throw new BusinessRuleError(
        `approved overtime may not exceed the derived ${String(day.overtimeMinutes)} minutes`,
      );
    }

    const previous = day.approvedOvertimeMinutes;
    // The repository's write conditions re-check `frozenAt: null` INSIDE the atomic update, so a
    // freeze landing between the read above and this write loses nothing.
    const updated = await dayRecordRepository.updateById(
      dayId,
      { approvedOvertimeMinutes: input.approvedMinutes },
      { by: ctx.userId, version: input.version },
    );

    await auditService.record({
      entityRef: entityRef(dayId),
      action: 'attendanceOvertimeApproval',
      changes: [
        { field: 'workDate', old: null, new: dateOnlyIso(day.workDate) },
        { field: 'approvedOvertimeMinutes', old: String(previous), new: String(input.approvedMinutes) },
        { field: 'derivedOvertimeMinutes', old: null, new: String(day.overtimeMinutes) },
      ],
    });
    await emit(HrAttendanceEvents.OvertimeApproved, {
      employeeId: String(updated.employeeId),
      workDate: dateOnlyIso(updated.workDate),
      approvedMinutes: updated.approvedOvertimeMinutes,
      branchId: String(updated.branchId),
    });

    const employee = await employeeRepository.findById(String(updated.employeeId));
    if (employee !== null && employee.userId !== null) {
      await notificationsService
        .notify({
          template: HrAttendanceTemplates.OvertimeApproved,
          to: { userIds: [String(employee.userId)] },
          data: {
            workDate: dateOnlyIso(updated.workDate),
            minutes: String(updated.approvedOvertimeMinutes),
          },
          entityRef: entityRef(dayId),
        })
        .catch(() => undefined);
    }
    return updated;
  }
}

export const overtimeService = new OvertimeService();
