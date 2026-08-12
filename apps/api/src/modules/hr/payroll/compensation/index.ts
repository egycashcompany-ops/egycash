export { compensationService } from './compensation.service';
export { buildCompensationRouter } from './compensation.routes';
export {
  computeCompensation,
  periodRange,
  type CompensationInput,
  type DateSpan,
} from './compensation-rules';
export { employmentSpansOf, spanContaining } from './employment-spans';
export { quantityFor, unitOf, type FrozenAttendance } from './attendance-quantities';
export { attendanceQuantityPort, type AttendanceQuantityPort } from './attendance-quantity.port';
