// Attendance rollout (v1.1 §12): purely additive, boot-time, idempotent. Collections and indexes
// come from the models; the one seeded row is the default GENERAL shift. No backfill of
// historical attendance — the module starts from its go-live date, and this seed records nothing
// that implies data that was never captured.
import { logger } from '../../../infrastructure/logging/logger';
import { rbacService } from '../../../platform/rbac';
import { shiftService } from './shifts';
import { AttendancePunchModel } from './punches/punch.model';

/**
 * What Employee Self-Service may do with attendance (§6, AT-6): read their OWN month and file a
 * regularization for it. Nothing else — no branch or organization reach, no decision key, no
 * export. The assignment itself is `own`-scoped (Leave L7), so `attendance.view` here can only
 * ever resolve to the caller's own rows.
 */
const ESS_ATTENDANCE_GRANTS = ['attendance.view', 'attendance.requestRegularization'];

/**
 * AT-D1 backfill — give punches written before the split their reader axis.
 *
 * WHY IT IS EXACT RATHER THAN A GUESS. Until AT-D1 every import stamped `branchIdAtPunch` with the
 * EMPLOYEE's branch, and `record()` defaulted it to the same value. So for every row this backfill
 * touches, the evidence field already holds the employee's branch — copying it across is not an
 * approximation, it is reading back what was written.
 *
 * THE ONE ROW SHAPE WHERE IT WOULD NOT BE: a `record()` call that passed an explicit
 * `branchIdAtPunch` override pointing somewhere other than the employee's own branch. That path
 * has no caller in the product — no screen reaches either punch write endpoint — so no such row
 * can have been created through the application. It is named here rather than hidden, because a
 * backfill that quietly might be wrong is worse than one that says where its edge is.
 *
 * ADDITIVE AND IDEMPOTENT, like everything else in this file: it writes only where the field is
 * missing, so a second boot matches nothing. It never touches `branchIdAtPunch` — a punch is
 * evidence (D9), and evidence is not restated.
 */
const backfillPunchEmployeeBranch = async (): Promise<void> => {
  const result = await AttendancePunchModel.updateMany(
    { employeeBranchId: { $in: [null, undefined] }, branchIdAtPunch: { $ne: null } },
    [{ $set: { employeeBranchId: '$branchIdAtPunch' } }],
  ).exec();
  if (result.modifiedCount > 0) {
    logger.info(
      { punches: result.modifiedCount },
      'attendance: backfilled employeeBranchId on punches written before AT-D1',
    );
  }
};

export const migrateAttendance = async (): Promise<void> => {
  await backfillPunchEmployeeBranch();

  const added = await rbacService.addSystemRoleGrants(
    'employee-self-service',
    ESS_ATTENDANCE_GRANTS,
  );
  if (added > 0) {
    logger.info({ added }, 'attendance: employee-self-service widened with the ESS attendance keys');
  }

  const general = await shiftService.ensure({
    code: 'GENERAL',
    name: { ar: 'الوردية العامة', en: 'General shift' },
    startTime: '09:00',
    endTime: '17:00',
    crossesMidnight: false,
    breakMinutes: 0,
    graceInMinutes: 30,
    graceOutMinutes: 0,
    minMinutesForFullDay: 0,
    minMinutesForHalfDay: 0,
    active: true,
    sortOrder: 0,
  });
  logger.info({ shiftId: String(general._id) }, 'attendance: GENERAL shift ensured');
};
