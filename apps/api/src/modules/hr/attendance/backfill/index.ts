// Public surface of the history backfill (ADR-003 barrel).
export {
  attendanceBackfillJobHandlers,
  attendanceBackfillService,
  BACKFILL_CHUNK_JOB,
} from './attendance-backfill.service';
export { buildAttendanceBackfillsRouter } from './attendance-backfill.routes';
export {
  AttendanceBackfillChunkModel,
  AttendanceBackfillModel,
  type AttendanceBackfillChunkDoc,
  type AttendanceBackfillChunkStatus,
  type AttendanceBackfillDoc,
} from './attendance-backfill.model';
