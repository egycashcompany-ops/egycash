// DTO mapping for the catalogue and its sessions. Dates are ISO strings; ids are stringified.
import { type TrainingCourseDto, type TrainingSessionDto } from '@ecms/contracts';
import { seatsLeft } from './sessions/session-rules';
import { type TrainingCourseDoc } from './courses/training-course.model';
import { type TrainingSessionDoc } from './sessions/training-session.model';

export const toTrainingCourseDto = (doc: TrainingCourseDoc): TrainingCourseDto => ({
  id: String(doc._id),
  key: doc.key,
  name: doc.name,
  description: doc.description,
  defaultDurationHours: doc.defaultDurationHours,
  defaultDeliveryMode: doc.defaultDeliveryMode,
  order: doc.order,
  active: doc.active,
  version: doc.__v,
});

/**
 * A session, with its seats.
 *
 * `enrolled` IS PASSED IN rather than read here, because the enrollment collection is T3's and this
 * mapper may not reach across a feature boundary to count it. Until that phase lands every caller
 * passes 0, which is the truth: nothing can be enrolled in a session yet. The alternative — leaving
 * the field out of the DTO and adding it later — would make the screen change shape twice.
 */
export const toTrainingSessionDto = (
  doc: TrainingSessionDoc,
  enrolled: number,
): TrainingSessionDto => ({
  id: String(doc._id),
  code: doc.code,
  courseId: String(doc.courseId),
  courseKey: doc.courseKey,
  courseName: doc.courseName,
  status: doc.status,
  startsAt: doc.startsAt.toISOString(),
  endsAt: doc.endsAt.toISOString(),
  deliveryMode: doc.deliveryMode,
  location: doc.location,
  trainerName: doc.trainerName,
  capacity: doc.capacity,
  enrolledCount: enrolled,
  seatsLeft: seatsLeft(doc.capacity, enrolled),
  note: doc.note,
  branchId: doc.branchId === null ? null : String(doc.branchId),
  cancelledReason: doc.cancelledReason,
  completedAt: doc.completedAt === null ? null : doc.completedAt.toISOString(),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});
