// Public surface of the Training feature. The HR manifest and the tests import from here; internal
// files are not reached across the feature boundary (ADR-003).
export { buildTrainingCoursesRouter, buildTrainingSessionsRouter } from './training.routes';
export { trainingCourseService } from './courses/training-course.service';
export { trainingSessionService } from './sessions/training-session.service';
export { seedTrainingCourses } from './training.seed';
export { type TrainingCourseDoc } from './courses/training-course.model';
export { type TrainingSessionDoc } from './sessions/training-session.model';
