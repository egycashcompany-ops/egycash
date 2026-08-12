// Attendance rollout (v1.1 §12): purely additive, boot-time, idempotent. Collections and indexes
// come from the models; the one seeded row is the default GENERAL shift. No backfill of
// historical attendance — the module starts from its go-live date, and this seed records nothing
// that implies data that was never captured.
import { logger } from '../../../infrastructure/logging/logger';
import { shiftService } from './shifts';

export const migrateAttendance = async (): Promise<void> => {
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
