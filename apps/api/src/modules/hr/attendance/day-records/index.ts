// Public surface of the Day Records feature (ADR-003 barrel).
export { dayRecordService, toAttendanceDayDto } from './day-record.service';
export { monthRange, toFeedRow } from './attendance-feed';
export { dayRecordRepository } from './day-record.repository';
export { buildAttendanceDaysRouter } from './day-record.routes';
export { AttendanceDayModel, type AttendanceDayDoc } from './day-record.model';
export {
  cairoInstant,
  deriveDay,
  shiftWindow,
  PUNCH_WINDOW_AFTER_MS,
  PUNCH_WINDOW_BEFORE_MS,
  type DeriveDayInput,
  type DerivedDay,
  type EnginePunch,
  type EngineShift,
} from './derive-day';
