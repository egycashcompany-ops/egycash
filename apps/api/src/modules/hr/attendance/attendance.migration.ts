// Attendance rollout (v1.1 §12): purely additive, boot-time, idempotent. Collections and indexes
// come from the models; the one seeded row is the default GENERAL shift. No backfill of
// historical attendance — the module starts from its go-live date, and this seed records nothing
// that implies data that was never captured.
import { logger } from '../../../infrastructure/logging/logger';
import { rbacService } from '../../../platform/rbac';
import { shiftService } from './shifts';

/**
 * What Employee Self-Service may do with attendance (§6, AT-6): read their OWN month and file a
 * regularization for it. Nothing else — no branch or organization reach, no decision key, no
 * export. The assignment itself is `own`-scoped (Leave L7), so `attendance.view` here can only
 * ever resolve to the caller's own rows.
 */
const ESS_ATTENDANCE_GRANTS = ['attendance.view', 'attendance.requestRegularization'];

export const migrateAttendance = async (): Promise<void> => {
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
