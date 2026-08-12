// Public surface of the Punches feature (ADR-003 barrel).
export {
  punchService,
  punchWindowProblem,
  toPunchDto,
  PUNCH_MAX_AGE_DAYS,
  PUNCH_MAX_FUTURE_MS,
} from './punch.service';
export { punchRepository } from './punch.repository';
export { buildAttendancePunchesRouter } from './punch.routes';
export { AttendancePunchModel, type AttendancePunchDoc } from './punch.model';
