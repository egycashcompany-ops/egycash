// Public surface of the Shift Assignments feature (ADR-003 barrel).
export {
  pickAssignmentForDate,
  shiftAssignmentService,
  toShiftAssignmentDto,
} from './shift-assignment.service';
export { shiftAssignmentRepository } from './shift-assignment.repository';
export { buildAttendanceAssignmentsRouter } from './shift-assignment.routes';
export { ShiftAssignmentModel, type ShiftAssignmentDoc } from './shift-assignment.model';
