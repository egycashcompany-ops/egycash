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
 * Yesterday's rows of the given statuses. A FROZEN day is skipped: its period has already been
 * closed for payroll, so a notice inviting a correction would be inviting one that cannot land
 * (§4 — a frozen row never moves; corrections after a freeze flow forward as adjustments).
 */
const previousDayRows = async (
  statuses: readonly ('absent' | 'incomplete' | 'pending')[],
): Promise<AttendanceDayDoc[]> => {
  const workDate = addDays(cairoToday(), -1);
  return AttendanceDayModel.find({
    workDate,
    status: { $in: [...statuses] },
    frozenAt: null,
    isDeleted: false,
  })
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
   * INERT SINCE THE CHECK-IN RULING, ON PURPOSE — and left in place rather than deleted.
   *
   * It queries yesterday's `incomplete` rows. Nothing derives `incomplete` any more: a check-in
   * with no check-out is `checkedIn`, an attended day. So this sweep finds nothing from the day
   * after that change, except a legacy row on the first morning, and sends nothing.
   *
   * THE OBVIOUS EDIT IS THE WRONG ONE. Re-aiming it at `checkedIn` would notify 70–90% of
   * employees every morning that they had forgotten to do something nobody here does — the
   * devices say that is simply how this workforce scans. A notice that reaches almost everybody
   * every day is read by nobody, and it would bury the absence notice beside it.
   *
   * The old reason this notice existed — "an incomplete day blocks the employee's payroll
   * calculation until it is regularized" — is void: `checkedIn` counts as an attended day
   * (`attendance-quantities.ts`), so nothing is blocked and there is nothing to chase.
   *
   * It stays because the shape is still the right one for a notice we may yet want: telling
   * somebody whose days normally DO have a check-out that yesterday's was missing. That needs a
   * per-employee habit, which the 90-day medians of the attendance dashboard will provide. Until
   * then this is a no-op, said out loud here so nobody reads its silence as a bug.
   */
  async sweepMissingCheckouts(): Promise<number> {
    const rows = await previousDayRows(['incomplete']);
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

    // `pending` COUNTS AS YESTERDAY'S ABSENCE, because by now that is what it means and what
    // every screen shows for it: the date has passed with nobody arriving, and the read-time
    // resolution turns a past `pending` into `absent` for exactly that reason. The row exists in
    // that state when the day was last recomputed while it was still being lived — a branch
    // recompute in the afternoon — and the nightly pass has not reached it, which is precisely
    // the case where the person would otherwise be told nothing at all. Screen and notice have
    // to agree about the same row, or one of them is lying.
    const rows = await previousDayRows(['absent', 'pending']);
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
