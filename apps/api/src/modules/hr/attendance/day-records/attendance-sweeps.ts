// The two daily sweeps (§9, AT-7): tell people what yesterday's derivation recorded, so a wrong
// day can be regularized while the facts are still fresh.
//
// Both are READ-ONLY over attendance. They send notices and change nothing — not the day row, not
// a punch, not a status. In particular nothing here escalates: an absence produces a notice and
// NOTHING ELSE. No disciplinary step, no flag, no counter, no record of "how many times" —
// attendance records facts, and what an organization does about a fact is a human decision taken
// somewhere else entirely.
//
// Idempotency is the platform's, not a marker of ours: every notice carries a deterministic
// `idempotencyKey` built from the notice kind, the employee and the work date, and
// `notificationsService` treats a second call for the same (recipient, key) as a no-op. So the
// sweep can run at every scheduler tick, be retried after a crash, or be invoked twice by hand,
// and the employee still sees exactly one notice per day. That is also why no state is added to
// the day record: a row that already answers "was this day absent?" should not also have to
// remember "did we mention it?".
import { HrAttendanceSettingKeys, HrAttendanceTemplates } from '@ecms/contracts';
import { logger } from '../../../../infrastructure/logging/logger';
import { notificationsService } from '../../../../platform/notifications';
import { settingsService } from '../../../../platform/settings';
import { addDays, cairoToday, dateOnlyIso } from '../../shared/business-date';
import { employeeRepository } from '../../employee-management/employees';
import { AttendanceDayModel, type AttendanceDayDoc } from './day-record.model';

const ORG_SUBJECT = { userId: null, branchId: null };

const dayRef = (id: string) => ({
  moduleId: 'hr',
  entityType: 'attendanceDay',
  entityId: id,
});

/** Deterministic per (kind, employee, day) — the whole idempotency guarantee lives in this shape. */
const noticeKey = (kind: string, doc: AttendanceDayDoc): string =>
  `hr.attendance.${kind}:${String(doc.employeeId)}:${dateOnlyIso(doc.workDate)}`;

/**
 * Yesterday's rows of one status. A FROZEN day is skipped: its period has already been closed for
 * payroll, so a notice inviting a correction would be inviting one that cannot land (§4 — a frozen
 * row never moves; corrections after a freeze flow forward as adjustments).
 */
const previousDayRows = async (status: 'absent' | 'incomplete'): Promise<AttendanceDayDoc[]> => {
  const workDate = addDays(cairoToday(), -1);
  return AttendanceDayModel.find({ workDate, status, frozenAt: null, isDeleted: false })
    .lean<AttendanceDayDoc[]>()
    .exec();
};

/** The employee's own login, when there is one — these notices are for the person themselves. */
const employeeUserId = async (doc: AttendanceDayDoc): Promise<string | null> => {
  const employee = await employeeRepository.findById(String(doc.employeeId));
  if (employee === null || employee.userId === null) return null;
  return String(employee.userId);
};

class AttendanceSweepService {
  /**
   * `incomplete` means the engine saw a check-in and no check-out (D6) — and an incomplete day
   * BLOCKS the employee's payroll calculation until it is regularized, which is exactly why the
   * person who can fix it hears about it the next morning rather than at month end.
   */
  async sweepMissingCheckouts(): Promise<number> {
    const rows = await previousDayRows('incomplete');
    let notified = 0;
    for (const doc of rows) {
      try {
        const userId = await employeeUserId(doc);
        if (userId === null) continue;
        const sent = await notificationsService.notify(
          {
            template: HrAttendanceTemplates.MissingCheckout,
            to: { userIds: [userId] },
            data: { workDate: dateOnlyIso(doc.workDate) },
            entityRef: dayRef(String(doc._id)),
          },
          { idempotencyKey: noticeKey('missingCheckout', doc) },
        );
        if (sent.length > 0) notified += 1;
      } catch (error) {
        // One employee's bad data must not starve the rest of the sweep (the nightly-compute rule).
        logger.error(
          { err: error, employeeId: String(doc.employeeId) },
          'attendance: missing-checkout notice failed for employee',
        );
      }
    }
    logger.info({ candidates: rows.length, notified }, 'attendance: missing-checkout sweep done');
    return notified;
  }

  /** The absence notice, gated by `hr.attendance.absenceNotify`. Informative only — see the header. */
  async sweepAbsenceNotices(): Promise<number> {
    const enabled = await settingsService.resolve<boolean>(
      HrAttendanceSettingKeys.AbsenceNotify,
      ORG_SUBJECT,
    );
    if (!enabled) {
      logger.info('attendance: absence notices are switched off');
      return 0;
    }

    const rows = await previousDayRows('absent');
    let notified = 0;
    for (const doc of rows) {
      try {
        const userId = await employeeUserId(doc);
        if (userId === null) continue;
        const sent = await notificationsService.notify(
          {
            template: HrAttendanceTemplates.AbsenceRecorded,
            to: { userIds: [userId] },
            data: { workDate: dateOnlyIso(doc.workDate) },
            entityRef: dayRef(String(doc._id)),
          },
          { idempotencyKey: noticeKey('absenceRecorded', doc) },
        );
        if (sent.length > 0) notified += 1;
      } catch (error) {
        logger.error(
          { err: error, employeeId: String(doc.employeeId) },
          'attendance: absence notice failed for employee',
        );
      }
    }
    logger.info({ candidates: rows.length, notified }, 'attendance: absence sweep done');
    return notified;
  }
}

export const attendanceSweepService = new AttendanceSweepService();
