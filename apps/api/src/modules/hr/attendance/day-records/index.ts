// Public surface of the Day Records feature (ADR-003 barrel).
export { dayRecordService, toAttendanceDayDto } from './day-record.service';
export { attendanceSweepService } from './attendance-sweeps';
export { monthRange, toFeedRow } from './attendance-feed';
export { dayRecordRepository } from './day-record.repository';
export { buildAttendanceDaysRouter, buildAttendanceExportRouter } from './day-record.routes';
export { AttendanceDayModel, type AttendanceDayDoc } from './day-record.model';
export {
  cairoInstant,
  deriveDay,
  punchWindowFor,
  shiftWindow,
  PUNCH_WINDOW_AFTER_MS,
  PUNCH_WINDOW_BEFORE_MS,
  type DeriveDayInput,
  type DerivedDay,
  type EnginePunch,
  type EngineShift,
} from './derive-day';
export {
  resolveDayStatus,
  type DayResolutionInput,
} from './resolve-display-status';
export {
  defaultPatternFor,
  departmentHoursMap,
  defaultPatternForBranch,
  expectationsForDate,
  type DayExpectation,
  type ExpectationSubject,
} from './expectations';
export { patternFrom, type DefaultPatternSettings } from './default-pattern';
