// Public surface of the Regularizations feature (ADR-003 barrel).
export {
  regularizationService,
  toRegularizationDto,
  type RegularizationCallerFlags,
} from './regularization.service';
export { buildAttendanceRegularizationsRouter } from './regularization.routes';
export { regularizationRepository } from './regularization.repository';
export {
  AttendanceRegularizationModel,
  type AttendanceRegularizationDoc,
} from './regularization.model';
export { decisionProblem, nextStatus, stepOf } from './regularization-rules';
