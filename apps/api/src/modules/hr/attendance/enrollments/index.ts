// Public surface of the enrolment map (ADR-003).
export {
  attendanceEnrollmentService,
  toAttendanceEnrollmentDto,
} from './attendance-enrollment.service';
export { attendanceEnrollmentRepository } from './attendance-enrollment.repository';
export {
  AttendanceEnrollmentModel,
  type AttendanceEnrollmentDoc,
} from './attendance-enrollment.model';
export { buildAttendanceEnrollmentsRouter } from './attendance-enrollment.routes';
