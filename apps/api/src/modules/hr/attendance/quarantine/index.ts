// Public surface of the device-row quarantine (ADR-003 barrel).
export {
  attendanceQuarantineJobHandlers,
  attendanceQuarantineService,
  queueQuarantineRetry,
  toQuarantineRowDto,
  RETRY_QUARANTINE_JOB,
} from './attendance-quarantine.service';
export { buildAttendanceQuarantineRouter } from './attendance-quarantine.routes';
export { holdQuarantinedRows, type HeldRow } from './attendance-quarantine.store';
export {
  AttendanceQuarantineModel,
  type AttendanceQuarantineDoc,
} from './attendance-quarantine.model';
