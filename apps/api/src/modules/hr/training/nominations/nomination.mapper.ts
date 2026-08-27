// DTO mapping for nominations and seats. Dates are ISO strings; ids are stringified.
import { type TrainingEnrollmentDto, type TrainingNominationDto } from '@ecms/contracts';
import { type TrainingNominationDoc } from './training-nomination.model';
import { type TrainingEnrollmentDoc } from './training-enrollment.model';

export const toTrainingNominationDto = (doc: TrainingNominationDoc): TrainingNominationDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  employeeName: doc.employeeName,
  sessionId: String(doc.sessionId),
  sessionCode: doc.sessionCode,
  courseKey: doc.courseKey,
  courseNameAr: doc.courseNameAr,
  courseNameEn: doc.courseNameEn,
  sessionStartsAt: doc.sessionStartsAt.toISOString(),
  status: doc.status,
  reason: doc.reason,
  note: doc.note,
  nominatedBy: doc.nominatedBy === null ? null : String(doc.nominatedBy),
  submittedAt: doc.submittedAt === null ? null : doc.submittedAt.toISOString(),
  decidedBy: doc.decidedBy === null ? null : String(doc.decidedBy),
  decidedAt: doc.decidedAt === null ? null : doc.decidedAt.toISOString(),
  decisionNote: doc.decisionNote,
  enrollmentId: doc.enrollmentId === null ? null : String(doc.enrollmentId),
  version: doc.__v,
  createdAt: doc.createdAt.toISOString(),
  updatedAt: doc.updatedAt.toISOString(),
});

export const toTrainingEnrollmentDto = (doc: TrainingEnrollmentDoc): TrainingEnrollmentDto => ({
  id: String(doc._id),
  employeeId: String(doc.employeeId),
  employeeCode: doc.employeeCode,
  employeeName: doc.employeeName,
  sessionId: String(doc.sessionId),
  sessionCode: doc.sessionCode,
  courseKey: doc.courseKey,
  status: doc.status,
  nominationId: doc.nominationId === null ? null : String(doc.nominationId),
  note: doc.note,
  cancelledReason: doc.cancelledReason,
  enrolledAt: doc.enrolledAt.toISOString(),
  version: doc.__v,
});
