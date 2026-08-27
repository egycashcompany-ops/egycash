// Public surface of the Training feature. The HR manifest and the tests import from here; internal
// files are not reached across the feature boundary (ADR-003).
export {
  buildTrainingCoursesRouter,
  buildTrainingEnrollmentsRouter,
  buildTrainingNominationsRouter,
  buildTrainingRecordsRouter,
  buildTrainingSessionsRouter,
} from './training.routes';
export { trainingCourseService } from './courses/training-course.service';
export { trainingSessionService } from './sessions/training-session.service';
export { seedTrainingCourses } from './training.seed';
export { type TrainingCourseDoc } from './courses/training-course.model';
export { type TrainingSessionDoc } from './sessions/training-session.model';
export { trainingNominationService } from './nominations/training-nomination.service';
export { type TrainingNominationDoc } from './nominations/training-nomination.model';
export { type TrainingEnrollmentDoc } from './nominations/training-enrollment.model';
export { trainingRecordService } from './records/training-record.service';
export { type TrainingRecordDoc } from './records/training-record.model';
export {
  ensureTrainingCertificateCategory,
  hrTrainingCertificateAuthorizers,
} from './records/training-record.files';
